-- 新建单条作业：编辑菜单里的「新建作业」用它。
-- 为什么不复用 publish_homeworks：那个会先删掉当天整批再重建，用来加一条会清空其它作业。
--
-- 权限用 can_edit_now()（发布者与管理员，且未被封禁），与「修改当天作业」一致。
create or replace function public.create_homework(
  p_subject text,
  p_content text,
  p_content_html text default null,
  p_tags text[] default '{}',
  p_due_date date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch_id bigint;
  v_id bigint;
  v_order integer;
begin
  if not public.can_edit_now() then
    raise exception '没有新建作业的权限' using errcode = '42501';
  end if;

  -- 当天还没有批次就建一个（与发布页共用同一张批次表）
  select id into v_batch_id
    from public.publish_batches
   where published_on = current_date
   limit 1;

  if v_batch_id is null then
    insert into public.publish_batches (published_on, publisher_email)
    values (current_date, coalesce((select email from public.profiles where id = auth.uid()), 'unknown'))
    returning id into v_batch_id;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_order
    from public.homeworks where batch_id = v_batch_id;

  insert into public.homeworks (
    batch_id, published_on, subject, content, content_html, tags,
    due_date, due_time, expired, sort_order, row_bytes
  ) values (
    v_batch_id, current_date,
    coalesce(nullif(btrim(p_subject), ''), '其它'),
    coalesce(p_content, ''),
    nullif(p_content_html, ''),
    coalesce(p_tags, '{}'),
    p_due_date,
    case when p_due_date is null then null else p_due_date::text || 'T00:00:00' end,
    false,
    v_order,
    120 + octet_length(coalesce(p_content, '')) + coalesce(octet_length(p_content_html), 0)
  ) returning id into v_id;

  update public.publish_batches b
     set homework_count = (select count(*) from public.homeworks where batch_id = b.id),
         subject_count = (select count(distinct subject) from public.homeworks where batch_id = b.id)
   where b.id = v_batch_id;

  return jsonb_build_object('id', v_id, 'batchId', v_batch_id, 'publishedOn', current_date);
end;
$$;

revoke all on function public.create_homework(text, text, text, text[], date) from public;
grant execute on function public.create_homework(text, text, text, text[], date) to authenticated;

-- 管理员也能发布/新建（原先是只认 publisher）
create or replace function public.is_publisher()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('publisher','admin') and not banned
  );
$$;
