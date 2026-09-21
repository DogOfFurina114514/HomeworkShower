-- HomeworkShower 后端结构
-- 在 Supabase Dashboard → SQL Editor 里整段执行即可（也可用 Management API 的 database/query 端点）。
-- 幂等：可重复执行。

-- ============================================================
-- 1. 用户资料与角色
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('publisher', 'admin', 'user')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is '用户资料与角色：user=只读，publisher=可发布作业，admin=可发布并管理用户';

-- 注册后自动建档（默认角色 user）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 当前用户角色（security definer，避免 RLS 递归）
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- 是否可发布（发布者或管理员）
create or replace function public.is_publisher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('publisher', 'admin') from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- 2. 发布批次（一天一条，整天删除的最小单位）
-- ============================================================
create table if not exists public.publish_batches (
  id bigserial primary key,
  published_on date not null,
  published_at timestamptz not null default now(),
  publisher_email text,
  subject_count integer not null default 0,
  homework_count integer not null default 0,
  payload_bytes bigint not null default 0
);

create unique index if not exists publish_batches_published_on_key
  on public.publish_batches (published_on);

comment on table public.publish_batches is '一次发布 = 一天的作业快照；清理时按 published_on 整天删除';

-- ============================================================
-- 3. 作业
-- ============================================================
create table if not exists public.homeworks (
  id bigserial primary key,
  batch_id bigint not null references public.publish_batches (id) on delete cascade,
  published_on date not null,
  subject text not null,
  content text not null default '',
  content_html text,
  tags text[] not null default '{}',
  due_date date,
  due_time text,
  expired boolean not null default false,
  sort_order integer not null default 0,
  row_bytes integer not null default 0
);

create index if not exists homeworks_published_on_idx on public.homeworks (published_on desc);
create index if not exists homeworks_due_date_idx on public.homeworks (due_date);
create index if not exists homeworks_batch_idx on public.homeworks (batch_id);

-- ============================================================
-- 4. 行级安全
-- ============================================================
alter table public.profiles enable row level security;
alter table public.publish_batches enable row level security;
alter table public.homeworks enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_role_name() = 'admin');

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for update to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

drop policy if exists batches_select on public.publish_batches;
create policy batches_select on public.publish_batches
  for select to authenticated using (true);

drop policy if exists batches_write on public.publish_batches;
create policy batches_write on public.publish_batches
  for all to authenticated
  using (public.is_publisher()) with check (public.is_publisher());

drop policy if exists homeworks_select on public.homeworks;
create policy homeworks_select on public.homeworks
  for select to authenticated using (true);

drop policy if exists homeworks_write on public.homeworks;
create policy homeworks_write on public.homeworks
  for all to authenticated
  using (public.is_publisher()) with check (public.is_publisher());

-- ============================================================
-- 5. 存储清理：超限时从旧到新整天删除
-- ============================================================
create or replace function public.prune_old_homeworks(p_max_bytes bigint default 314572800)
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
begin
  -- 只统计本应用自己的数据量：这个项目与其它应用共用一个数据库，
  -- 用 pg_database_size 会把别人的数据也算进来，所以按行内实际字节数累加。
  select coalesce(sum(row_bytes), 0) into v_size from public.homeworks;

  while v_size > p_max_bytes loop
    select min(published_on) into v_oldest from public.publish_batches;
    exit when v_oldest is null;

    delete from public.homeworks where published_on = v_oldest;
    get diagnostics v_deleted = row_count;
    v_rows := v_rows + v_deleted;
    delete from public.publish_batches where published_on = v_oldest;
    v_days := v_days + 1;

    select coalesce(sum(row_bytes), 0) into v_size from public.homeworks;
  end loop;

  return jsonb_build_object(
    'removedDays', v_days,
    'removedHomeworks', v_rows,
    'sizeBytes', v_size,
    'maxBytes', p_max_bytes
  );
end;
$$;

comment on function public.prune_old_homeworks(bigint) is '超过字节预算时，按 published_on 从最旧的一天开始整天删除（删除不会立即回收物理空间，因此以行内字节数计量）';

-- ============================================================
-- 6. 发布作业（把桌面端导出的 JSON 整份写入某一天）
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
begin
  if not public.is_publisher() then
    raise exception '只有发布者或管理员可以发布作业' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(coalesce(p_payload -> 'subjects', 'null'::jsonb)) <> 'array' then
    raise exception '数据格式不正确：缺少 subjects 数组' using errcode = '22023';
  end if;

  -- 同一天重复发布 = 覆盖当天
  delete from public.publish_batches where published_on = p_published_on;

  insert into public.publish_batches (published_on, publisher_email)
  values (p_published_on, (select email from public.profiles where id = auth.uid()))
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

  perform public.prune_old_homeworks();

  return jsonb_build_object(
    'batchId', v_batch_id,
    'publishedOn', p_published_on,
    'subjectCount', v_subject_count,
    'homeworkCount', v_homework_count,
    'bytes', v_bytes
  );
end;
$$;

comment on function public.publish_homeworks(jsonb, date) is '把桌面端导出的 JSON（format=stickyhomeworks2.homeworks）整份发布到指定日期；同一天重复发布会覆盖';

-- ============================================================
-- 7. 权限
-- ============================================================
revoke all on function public.publish_homeworks(jsonb, date) from public;
grant execute on function public.publish_homeworks(jsonb, date) to authenticated;

revoke all on function public.prune_old_homeworks(bigint) from public;
grant execute on function public.prune_old_homeworks(bigint) to authenticated;
