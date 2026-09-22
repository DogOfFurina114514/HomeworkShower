-- 图片改存 Storage 桶；数据库与图片分别按预算整天清理
--
--   数据库：400 MB（免费计划每项目 500 MB，留 100 MB 给索引/膨胀/临时空间）
--   图片桶：900 MB（免费计划每项目 1 GB）
--
-- 作业图片的路径规则：<发布日期>/<随机名>.<ext>
-- 这样「按日期整天清理」时，数据库记录和桶里的图片能一一对应地一起删。

-- ============================================================
-- 1. 公共图片桶
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homework-images',
  'homework-images',
  true,
  5242880, -- 单文件 5 MB（前端会先压缩到几百 KB）
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "homework images read" on storage.objects;
create policy "homework images read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'homework-images');

-- 上传：发布者/管理员，且只能传到「当天」目录
drop policy if exists "homework images insert" on storage.objects;
create policy "homework images insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homework-images'
    and public.can_edit_now()
    and (storage.foldername(name))[1] = current_date::text
  );

-- 删除：发布者/管理员（用于清理超出预算的旧图片）
drop policy if exists "homework images delete" on storage.objects;
create policy "homework images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'homework-images' and public.can_edit_now());

-- ============================================================
-- 2. 图片占用统计 + 需要清理的日期
-- ============================================================
create or replace function public.homework_image_usage()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  select jsonb_build_object(
    'totalBytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0),
    'objectCount', count(*)
  )
  from storage.objects o
  where o.bucket_id = 'homework-images';
$$;

/**
 * 图片超出预算时，列出需要清理的日期（最旧的优先，整天整天删）。
 * 真正的删除要走 Storage API，所以这里只算日期，由前端发布时执行删除。
 */
create or replace function public.homework_image_purge_dates(p_max_bytes bigint default 943718400)
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  with per_day as (
    select split_part(o.name, '/', 1) as day,
           sum((o.metadata ->> 'size')::bigint) as bytes
    from storage.objects o
    where o.bucket_id = 'homework-images'
      and o.name like '%/%'
    group by 1
  ),
  total as (select coalesce(sum(bytes), 0) as bytes from per_day),
  running as (
    select day, bytes,
           sum(bytes) over (order by day desc) as newer_bytes
    from per_day
  )
  select coalesce(jsonb_agg(day order by day), '[]'::jsonb)
  from running, total
  where total.bytes > p_max_bytes
    and newer_bytes > p_max_bytes;
$$;

-- ============================================================
-- 3. 清理：数据库按 400 MB、返回被删掉的日期（供前端删图片）
-- ============================================================
create or replace function public.prune_old_homeworks(p_max_bytes bigint default 419430400)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_size bigint;
  v_oldest date;
  v_days integer := 0;
  v_rows integer := 0;
  v_deleted integer;
  v_removed_dates jsonb := '[]'::jsonb;
begin
  -- 只统计本应用自己的数据量：同一数据库里可能还有别的应用的表
  select coalesce(sum(row_bytes), 0) into v_size from public.homeworks;

  while v_size > p_max_bytes loop
    select min(published_on) into v_oldest from public.publish_batches;
    exit when v_oldest is null;

    delete from public.homeworks where published_on = v_oldest;
    get diagnostics v_deleted = row_count;
    v_rows := v_rows + v_deleted;
    delete from public.publish_batches where published_on = v_oldest;
    v_days := v_days + 1;
    v_removed_dates := v_removed_dates || to_jsonb(v_oldest::text);

    select coalesce(sum(row_bytes), 0) into v_size from public.homeworks;
  end loop;

  return jsonb_build_object(
    'removedDays', v_days,
    'removedHomeworks', v_rows,
    'removedDates', v_removed_dates,
    'sizeBytes', v_size,
    'maxBytes', p_max_bytes
  );
end;
$$;

-- ============================================================
-- 4. 发布：返回清理结果 + 图片需要清理的日期
-- ============================================================
create or replace function public.publish_homeworks(
  p_payload jsonb,
  p_published_on date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id bigint;
  v_subject_count integer := 0;
  v_homework_count integer := 0;
  v_bytes bigint := 0;
  v_subject jsonb;
  v_homework jsonb;
  v_index integer;
  v_content text;
  v_html text;
  v_tags text[];
  v_pruned jsonb;
begin
  if not public.is_publisher() then
    raise exception '只有发布者可以发布作业' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(coalesce(p_payload -> 'subjects', 'null'::jsonb)) <> 'array' then
    raise exception '数据格式不正确：缺少 subjects 数组' using errcode = '22023';
  end if;

  delete from public.publish_batches where published_on = p_published_on;

  insert into public.publish_batches (published_on, publisher_email)
  values (p_published_on, coalesce((select email from public.profiles where id = auth.uid()), 'service'))
  returning id into v_batch_id;

  for v_subject in select value from jsonb_array_elements(p_payload -> 'subjects') loop
    v_subject_count := v_subject_count + 1;
    v_index := 0;
    for v_homework in select value from jsonb_array_elements(coalesce(v_subject -> 'homeworks', '[]'::jsonb)) loop
      v_content := coalesce(v_homework ->> 'content', '');
      v_html := v_homework ->> 'contentHtml';
      v_tags := coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_homework -> 'tags', '[]'::jsonb))),
        '{}'
      );

      insert into public.homeworks (
        batch_id, published_on, subject, content, content_html, tags,
        due_date, due_time, expired, sort_order, row_bytes
      ) values (
        v_batch_id,
        p_published_on,
        coalesce(nullif(btrim(v_subject ->> 'subject'), ''), '其它'),
        v_content,
        v_html,
        v_tags,
        nullif(v_homework ->> 'dueDate', '')::date,
        v_homework ->> 'dueTime',
        coalesce((v_homework ->> 'expired')::boolean, false),
        v_index,
        120 + octet_length(v_content) + coalesce(octet_length(v_html), 0) + 24 * coalesce(array_length(v_tags, 1), 0)
      );

      v_bytes := v_bytes + 120 + octet_length(v_content) + coalesce(octet_length(v_html), 0);
      v_homework_count := v_homework_count + 1;
      v_index := v_index + 1;
    end loop;
  end loop;

  update public.publish_batches
     set subject_count = v_subject_count,
         homework_count = v_homework_count,
         payload_bytes = v_bytes
   where id = v_batch_id;

  v_pruned := public.prune_old_homeworks();

  return jsonb_build_object(
    'batchId', v_batch_id,
    'publishedOn', p_published_on,
    'subjectCount', v_subject_count,
    'homeworkCount', v_homework_count,
    'bytes', v_bytes,
    'pruned', v_pruned,
    'imageUsage', public.homework_image_usage(),
    'imagePurgeDates', public.homework_image_purge_dates()
  );
end;
$$;

grant execute on function public.publish_homeworks(jsonb, date) to authenticated, service_role;
grant execute on function public.homework_image_usage() to authenticated, service_role;
grant execute on function public.homework_image_purge_dates(bigint) to authenticated, service_role;
