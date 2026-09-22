-- 角色语义与权限修正
--
--   publisher 发布者：可以发布作业；也可以修改作业（仅限当天）
--   admin     管理员：不能发布，只能修改作业（仅限当天）
--   user      用户：只读
--
-- 「只能改当天」由 RLS 用 published_on = current_date 强制，任何角色都绕不过。

-- ---------- 角色判定 ----------

-- 能否发布：只有发布者
create or replace function public.is_publisher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role()
      or coalesce((select role = 'publisher' from public.profiles where id = auth.uid()), false);
$$;

-- 能否修改：发布者或管理员，且只能改当天那批
create or replace function public.can_edit_now()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role()
      or coalesce((select role in ('publisher', 'admin') from public.profiles where id = auth.uid()), false);
$$;

-- ---------- 重写策略 ----------

drop policy if exists homeworks_write on public.homeworks;
create policy homeworks_update_today on public.homeworks
  for update to authenticated
  using (public.can_edit_now() and published_on = current_date)
  with check (public.can_edit_now() and published_on = current_date);

create policy homeworks_delete_today on public.homeworks
  for delete to authenticated
  using (public.can_edit_now() and published_on = current_date);

-- 前端不允许直接插入作业：发布必须走 publish_homeworks()，以免绕过同一天的覆盖规则
drop policy if exists homeworks_insert on public.homeworks;
create policy homeworks_insert_service on public.homeworks
  for insert to authenticated
  with check (public.is_service_role());

drop policy if exists batches_write on public.publish_batches;
create policy batches_update_today on public.publish_batches
  for update to authenticated
  using (public.can_edit_now() and published_on = current_date)
  with check (public.can_edit_now() and published_on = current_date);

create policy batches_delete_today on public.publish_batches
  for delete to authenticated
  using (public.can_edit_now() and published_on = current_date);

-- 发布函数仍然只认发布者
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
    'pruned', v_pruned
  );
end;
$$;

-- ---------- 引导角色：站点所有者是发布者 ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_publishers text[] := array['wu__20111229@outlook.com'];
  v_role text := 'user';
begin
  if lower(new.email) = any (v_publishers) then
    v_role := 'publisher';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 已经注册过的账号按新规则纠正一次
update public.profiles set role = 'publisher' where lower(email) = 'wu__20111229@outlook.com';
update public.profiles set role = 'user' where role = 'admin' and lower(email) <> 'wu__20111229@outlook.com';
