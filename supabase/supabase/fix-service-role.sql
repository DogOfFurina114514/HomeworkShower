-- 修正：允许服务端密钥（service_role）绕过角色检查
-- 服务端密钥只存在于服务器/本地脚本里，不放进网页；Supabase 的约定也是它可越过 RLS。

create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

create or replace function public.is_publisher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role()
      or coalesce(
           (select role in ('publisher', 'admin') from public.profiles where id = auth.uid()),
           false
         );
$$;

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
    raise exception '只有发布者或管理员可以发布作业' using errcode = '42501';
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

grant execute on function public.publish_homeworks(jsonb, date) to authenticated, service_role;
