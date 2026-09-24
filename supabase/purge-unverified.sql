-- 账号 7 天未验证则删除
--
--   · 由 pg_cron 每天跑一次（凌晨 3 点），不依赖前端或有人访问；
--   · 只删"邮箱从未验证过、且注册满 7 天"的账号；
--   · profiles 行通过外键级联一并删除。

create or replace function public.purge_unverified_accounts()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer := 0;
begin
  delete from auth.users u
   where u.email_confirmed_at is null
     and u.created_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;

  -- 顺手清掉可能残留的资料行（正常情况下会被级联删除）
  delete from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id);

  return jsonb_build_object('deleted', v_deleted, 'ranAt', now());
end;
$$;

-- 只有定时任务需要调用，不给普通用户开放
revoke all on function public.purge_unverified_accounts() from public, anon, authenticated;

-- 注册定时任务（若已存在则先移除，避免重复）
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-unverified-accounts')
      where exists (select 1 from cron.job where jobname = 'purge-unverified-accounts');
    perform cron.schedule('purge-unverified-accounts', '0 3 * * *', $cron$select public.purge_unverified_accounts()$cron$);
  end if;
end $$;
