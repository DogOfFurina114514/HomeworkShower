-- 用户管理：封禁标记 + 只有发布者能调用的管理接口

alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists banned_at timestamptz;

-- 封禁者不再具备任何写权限
create or replace function public.can_edit_now()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('publisher','admin') and not banned
  );
$$;

create or replace function public.is_publisher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'publisher' and not banned
  );
$$;

-- 列出所有用户（仅发布者）
create or replace function public.admin_list_users()
returns table (id uuid, email text, role text, banned boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.role, p.banned, p.created_at
  from public.profiles p
  where public.is_publisher()
  order by p.created_at nulls last, p.email;
$$;

-- 设/撤管理员（发布者本身不受影响）
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_publisher() then
    raise exception '只有发布者可以管理用户' using errcode = '42501';
  end if;
  if p_role not in ('user', 'admin') then
    raise exception '角色只能是 user 或 admin' using errcode = '22023';
  end if;
  update public.profiles set role = p_role where id = p_user_id and role <> 'publisher';
end;
$$;

-- 封禁/解封
create or replace function public.admin_set_banned(p_user_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_publisher() then
    raise exception '只有发布者可以管理用户' using errcode = '42501';
  end if;
  update public.profiles
     set banned = p_banned,
         banned_at = case when p_banned then now() else null end
   where id = p_user_id and role <> 'publisher';
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_set_banned(uuid, boolean) to authenticated;

-- 自己的行也要能读到 banned，登录后才知道被封了
grant select on public.profiles to authenticated;
