-- 引导管理员：注册时决定初始角色
--
-- 规则：
--   1. 邮箱在下面的名单里 → 直接给 admin；
--   2. 系统里还没有任何 admin → 第一个注册的人自动成为 admin（避免没人能发布作业）；
--   3. 其余人 → user（只读）。
--
-- 之后要调整某个人的角色，直接改 profiles 表即可：
--   update public.profiles set role = 'publisher' where email = 'xxx@example.com';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bootstrap_admins text[] := array['wu__20111229@outlook.com'];
  v_role text := 'user';
begin
  if lower(new.email) = any (v_bootstrap_admins) then
    v_role := 'admin';
  elsif not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 发布者：额外指定（可随时改）
create or replace function public.grant_publisher(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '只有管理员可以调整角色' using errcode = '42501';
  end if;

  update public.profiles set role = 'publisher' where lower(email) = lower(p_email);
  if not found then
    return '没有找到这个邮箱，等他先注册';
  end if;
  return 'ok';
end;
$$;

grant execute on function public.grant_publisher(text) to authenticated;
