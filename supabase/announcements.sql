-- 公告（announcements）
--
-- 位置：主界面/时光机在「XXXX · 共 N 条作业」状态条**上方**的公告栏，每条一行。
--
-- 字段语义（与产品约定一一对应）：
--   admin_only_edit  「管理员可修改」：默认 true。
--                    true  = 发布者与管理员都能改；
--                    false = 只有发布者能改（管理员只能看）。
--                    发布者可以改这个开关 —— 包括改管理员发的公告。
--   internal         「内部」：true 时只有发布者与管理员可见，学生看不到；
--                    前端打一个「内部」标签。
--   importance       LOW / NORMAL / MODERATE / IMPORTANT。
--                    **只有发布者**能引入 IMPORTANT（新建时设为 IMPORTANT，
--                    或把非 IMPORTANT 升成 IMPORTANT）。管理员可以原样保存一条
--                    本来就是 IMPORTANT 的公告，但不能升级 —— 前端不给这个选项，
--                    后端 trigger 再校验一次。
--   pinned           置顶。排序：置顶 > 重要等级 > 最近更新。
--   never_expires    永不过期；否则必须给 expires_on，过了那天不再显示。
--
-- ⚠ 为什么这里另写一个 is_strict_publisher()：
--   现网 public.is_publisher() 的定义是 role in ('publisher','admin')
--   （早先为了让管理员也能进发布页改的），它**不是**"仅发布者"。
--   IMPORTANT 的守卫必须严格只认 publisher，用 is_publisher() 会直接放行管理员。

-- ---------- 表 ----------

create table if not exists public.announcements (
  id bigserial primary key,
  content text not null default '',
  content_html text,
  importance text not null default 'NORMAL'
    constraint announcements_importance_check
    check (importance in ('LOW', 'NORMAL', 'MODERATE', 'IMPORTANT')),
  pinned boolean not null default false,
  admin_only_edit boolean not null default true,
  internal boolean not null default false,
  never_expires boolean not null default false,
  expires_on date,
  author_email text,
  author_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 软删除：前端按这个过滤，不必为删公告开放 delete 策略
  deleted_at timestamptz,
  row_bytes integer not null default 0,
  constraint announcements_expiry_consistent
    check (never_expires or expires_on is not null)
);

create index if not exists announcements_visible_idx
  on public.announcements (pinned desc, updated_at desc)
  where deleted_at is null;

comment on table public.announcements is '公告栏内容：富文本、置顶、重要等级、内部可见、可选截止日期';

-- ---------- 角色判定 ----------

-- 严格"仅发布者"（不含管理员）
create or replace function public.is_strict_publisher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role()
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'publisher' and not banned
      );
$$;

-- 发布者/管理员：能看到内部公告
create or replace function public.can_see_internal_announcements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_now();
$$;

-- 这条公告当前用户能不能改
create or replace function public.can_edit_announcement(p_admin_only_edit boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role()
      -- 发布者始终可改（含把「管理员可修改」打开/关掉）
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'publisher' and not banned)
      -- 管理员只有在该公告标了「管理员可修改」时可改
      or (
        coalesce(p_admin_only_edit, true)
        and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not banned)
      );
$$;

-- ---------- 行级安全 ----------

alter table public.announcements enable row level security;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to anon, authenticated
  using (
    deleted_at is null
    and (not internal or public.can_see_internal_announcements())
  );

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (public.can_edit_now());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (public.can_edit_announcement(admin_only_edit))
  with check (public.can_edit_announcement(admin_only_edit));

-- 删除走软删除（update deleted_at），不开放 delete 策略。

-- ---------- IMPORTANT 等级守卫 ----------

create or replace function public.announcements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 引入 IMPORTANT 的两种情形：新建时就是，或从别的等级改成 IMPORTANT
  if new.importance = 'IMPORTANT'
     and (tg_op = 'INSERT' or old.importance is distinct from new.importance) then
    if not public.is_strict_publisher() then
      raise exception '只有发布者可以把公告设为 IMPORTANT'
        using errcode = '42501';
    end if;
  end if;

  -- 管理员没有「管理员可修改」这个选项（UI 不显示，后端也钉住）：
  -- 他们新建的公告一律 admin_only_edit = true。
  if tg_op = 'INSERT'
     and not new.admin_only_edit
     and not public.is_strict_publisher() then
    new.admin_only_edit := true;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcements_guard on public.announcements;
create trigger announcements_guard
  before insert or update on public.announcements
  for each row execute function public.announcements_guard();

-- ---------- 列表查询 ----------

-- 可见性/过期/排序收在一处，避免前后端各写一套规则写歪。
create or replace function public.list_announcements()
returns table (
  id bigint,
  content text,
  content_html text,
  importance text,
  pinned boolean,
  admin_only_edit boolean,
  internal boolean,
  never_expires boolean,
  expires_on date,
  author_email text,
  author_role text,
  created_at timestamptz,
  updated_at timestamptz,
  can_edit boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id, a.content, a.content_html, a.importance, a.pinned, a.admin_only_edit,
    a.internal, a.never_expires, a.expires_on, a.author_email, a.author_role,
    a.created_at, a.updated_at,
    public.can_edit_announcement(a.admin_only_edit) as can_edit
  from public.announcements a
  where a.deleted_at is null
    and (a.never_expires or a.expires_on is null or a.expires_on >= current_date)
    and (not a.internal or public.can_see_internal_announcements())
  order by
    a.pinned desc,
    case a.importance
      when 'IMPORTANT' then 3
      when 'MODERATE'  then 2
      when 'NORMAL'    then 1
      else 0
    end desc,
    a.updated_at desc;
$$;

comment on function public.list_announcements() is '公告栏列表：过滤已删除/已过期/无权查看的内部公告，按 置顶 > 重要等级 > 最近更新 排序';

-- ---------- 写入 ----------

create or replace function public.create_announcement(
  p_content text,
  p_content_html text default null,
  p_importance text default 'NORMAL',
  p_pinned boolean default false,
  p_admin_only_edit boolean default true,
  p_internal boolean default false,
  p_never_expires boolean default false,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_role text;
  v_email text;
begin
  if not public.can_edit_now() then
    raise exception '没有发布公告的权限' using errcode = '42501';
  end if;
  if coalesce(btrim(p_content), '') = '' and coalesce(p_content_html, '') = '' then
    raise exception '公告内容不能为空' using errcode = '22023';
  end if;
  if p_importance not in ('LOW', 'NORMAL', 'MODERATE', 'IMPORTANT') then
    raise exception '未知的重要等级' using errcode = '22023';
  end if;
  if not p_never_expires and p_expires_on is null then
    raise exception '请填写截止日期，或勾选「永不过期」' using errcode = '22023';
  end if;

  select role, email into v_role, v_email from public.profiles where id = auth.uid();

  insert into public.announcements (
    content, content_html, importance, pinned, admin_only_edit, internal,
    never_expires, expires_on, author_email, author_role, row_bytes
  ) values (
    coalesce(p_content, ''),
    nullif(p_content_html, ''),
    p_importance,
    p_pinned,
    p_admin_only_edit,
    p_internal,
    p_never_expires,
    case when p_never_expires then null else p_expires_on end,
    v_email,
    v_role,
    120 + octet_length(coalesce(p_content, '')) + coalesce(octet_length(p_content_html), 0)
  ) returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.update_announcement(
  p_id bigint,
  p_content text,
  p_content_html text default null,
  p_importance text default 'NORMAL',
  p_pinned boolean default false,
  p_admin_only_edit boolean default true,
  p_internal boolean default false,
  p_never_expires boolean default false,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
begin
  select * into v_row from public.announcements where id = p_id for update;
  if not found then
    raise exception '公告不存在' using errcode = 'P0002';
  end if;
  if not public.can_edit_announcement(v_row.admin_only_edit) then
    raise exception '你没有修改这条公告的权限' using errcode = '42501';
  end if;
  if coalesce(btrim(p_content), '') = '' and coalesce(p_content_html, '') = '' then
    raise exception '公告内容不能为空' using errcode = '22023';
  end if;
  if p_importance not in ('LOW', 'NORMAL', 'MODERATE', 'IMPORTANT') then
    raise exception '未知的重要等级' using errcode = '22023';
  end if;
  if not p_never_expires and p_expires_on is null then
    raise exception '请填写截止日期，或勾选「永不过期」' using errcode = '22023';
  end if;

  update public.announcements set
    content = coalesce(p_content, ''),
    content_html = nullif(p_content_html, ''),
    importance = p_importance,
    pinned = p_pinned,
    admin_only_edit = p_admin_only_edit,
    internal = p_internal,
    never_expires = p_never_expires,
    expires_on = case when p_never_expires then null else p_expires_on end,
    row_bytes = 120 + octet_length(coalesce(p_content, '')) + coalesce(octet_length(p_content_html), 0)
  where id = p_id;

  return jsonb_build_object('id', p_id);
end;
$$;

create or replace function public.delete_announcement(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements%rowtype;
begin
  select * into v_row from public.announcements where id = p_id for update;
  if not found then
    raise exception '公告不存在' using errcode = 'P0002';
  end if;
  if not public.can_edit_announcement(v_row.admin_only_edit) then
    raise exception '你没有删除这条公告的权限' using errcode = '42501';
  end if;
  update public.announcements set deleted_at = now() where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

grant execute on function public.list_announcements() to anon, authenticated;
grant execute on function public.create_announcement(text, text, text, boolean, boolean, boolean, boolean, date) to authenticated;
grant execute on function public.update_announcement(bigint, text, text, text, boolean, boolean, boolean, boolean, date) to authenticated;
grant execute on function public.delete_announcement(bigint) to authenticated;
