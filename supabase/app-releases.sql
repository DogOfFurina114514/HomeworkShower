create table if not exists public.app_releases (
  id bigserial primary key,
  version text not null,
  version_code integer not null,
  mandatory boolean not null default false,
  notes text,
  apk_url text,
  published_at timestamptz not null default now()
);

alter table public.app_releases enable row level security;

drop policy if exists app_releases_read on public.app_releases;
create policy app_releases_read on public.app_releases
  for select to anon, authenticated using (true);

grant select on public.app_releases to anon, authenticated;

insert into public.app_releases (version, version_code, mandatory, notes, apk_url)
select '26.0.0', 260000, false, '首个热更新版本：新增安全中心（改邮箱/改密码/注销账号）、用户管理与封禁、简版与降级链路。', 'https://github.com/DogOfFurina114514/HomeworkShower/releases/download/26.0.0/HomeworkShower_26.0.0.apk'
where not exists (select 1 from public.app_releases where version_code = 260000);
