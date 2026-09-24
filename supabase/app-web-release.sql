-- 热更新（网页）版本与文件清单：
--   * app_web_release  —— 恒为一行（id = 1）的“当前网页版本”，App 只读这一行比较版本号
--   * app_web_manifest —— 当前版本所有文件的 sha256 清单，App 按清单比对本地哈希，只下载变化的文件
create table if not exists public.app_web_release (
  id integer primary key default 1 check (id = 1),
  version text not null,
  version_code integer not null,
  entry text not null default 'index.html',
  published_at timestamptz not null default now()
);

create table if not exists public.app_web_manifest (
  path text primary key,
  hash text not null,
  bytes integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 单行版本表：同步函数用 on conflict (id) do update，回滚版本号时也能覆盖，
-- 不会再像早先那样每次同步插一条新行。
alter table public.app_web_release drop constraint if exists app_web_release_single_row;
alter table public.app_web_release add constraint app_web_release_single_row check (id = 1);

alter table public.app_web_release enable row level security;
alter table public.app_web_manifest enable row level security;

drop policy if exists app_web_release_read on public.app_web_release;
create policy app_web_release_read on public.app_web_release
  for select to anon, authenticated using (true);

drop policy if exists app_web_manifest_read on public.app_web_manifest;
create policy app_web_manifest_read on public.app_web_manifest
  for select to anon, authenticated using (true);

grant select on public.app_web_release, public.app_web_manifest to anon, authenticated;

insert into public.app_web_release (id, version, version_code, entry)
values (1, '26.0.0', 260000, 'index.html')
on conflict (id) do update
  set version = excluded.version,
      version_code = excluded.version_code,
      entry = excluded.entry;
