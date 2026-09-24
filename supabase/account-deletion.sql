-- 账号注销：三段式状态机
--   提交申请 → 3 天内登录可取消 → 满 3 天标记已注销 → 满 60 天真正删除

alter table public.profiles add column if not exists deletion_requested_at timestamptz;
alter table public.profiles add column if not exists deleted_at timestamptz;

-- 提交注销申请（仅本人、且已登录）
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  update public.profiles
     set deletion_requested_at = coalesce(deletion_requested_at, now()),
         deleted_at = null
   where id = auth.uid()
  returning email into v_email;

  return jsonb_build_object('email', v_email, 'requestedAt', now());
end;
$$;

-- 取消注销（3 天内登录也会自动调用这个逻辑）
create or replace function public.cancel_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer := 0;
begin
  if auth.uid() is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  update public.profiles
     set deletion_requested_at = null
   where id = auth.uid() and deletion_requested_at is not null and deleted_at is null;
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('canceled', v_cleared > 0);
end;
$$;

grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;

-- 定时推进状态（复用已有的 pg_cron）
create or replace function public.advance_account_deletions()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_marked integer := 0;
  v_purged integer := 0;
begin
  -- ① 满 3 天：标记为已注销
  update public.profiles
     set deleted_at = now()
   where deletion_requested_at is not null
     and deleted_at is null
     and deletion_requested_at < now() - interval '3 days';
  get diagnostics v_marked = row_count;

  -- ② 满 60 天：真正删除账号与数据
  delete from auth.users u
   using public.profiles p
   where p.id = u.id
     and p.deleted_at is not null
     and p.deleted_at < now() - interval '60 days';
  get diagnostics v_purged = row_count;

  return jsonb_build_object('marked', v_marked, 'purged', v_purged, 'ranAt', now());
end;
$$;

revoke all on function public.advance_account_deletions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('advance-account-deletions')
      where exists (select 1 from cron.job where jobname = 'advance-account-deletions');
    perform cron.schedule('advance-account-deletions', '15 3 * * *', $cron$select public.advance_account_deletions()$cron$);
  end if;
end $$;
