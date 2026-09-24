-- 每 10 分钟（pg_cron）把 GitHub 上的 version.json / manifest.json 同步到库里，
-- 作为 App 的兜底数据源（Pages 连不上时用）。
--
-- 两个关键点：
--   1. app_web_release 恒为一行（id = 1）；
--   2. pg_net 会把历史响应留在 net._http_response 里，队列中可能混着旧版本。
--      所以按响应的 created 时刻判断新旧 —— 只允许更新的响应写入。
--      不能只比 version_code 大小：网页版本是 1、2、3 这种小数字，
--      而旧的 260002 比新的 1 大得多，单看"更大"会被旧响应改回去。
create or replace function public.sync_app_version_from_github()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_row record;
  v_body jsonb;
  v_applied_version integer := 0;
  v_applied_files integer := 0;
begin
  for v_row in
    select content, created from net._http_response
    where status_code = 200 and content is not null
    order by id desc limit 6
  loop
    begin
      v_body := v_row.content::jsonb;
    exception when others then
      continue;
    end;

    if v_body ? 'webVersionCode' then
      insert into public.app_web_release (id, version, version_code, entry, published_at, epoch)
      values (1, v_body ->> 'webVersion', (v_body ->> 'webVersionCode')::int,
              coalesce(v_body ->> 'entry', 'index.html'), now(), v_row.created)
      on conflict (id) do update
        set version = excluded.version,
            version_code = excluded.version_code,
            entry = excluded.entry,
            published_at = excluded.published_at,
            epoch = excluded.epoch
        where excluded.epoch > public.app_web_release.epoch;
      v_applied_version := 1;

      -- App 发布历史：按 version_code 去重
      insert into public.app_releases (version, version_code, mandatory, notes, apk_url)
      values (v_body ->> 'apkVersion',
              (v_body ->> 'apkVersionCode')::int,
              coalesce((v_body ->> 'apkMandatory')::boolean, false),
              v_body ->> 'apkNotes',
              replace(v_body ->> 'apkUrlTemplate', '{version}', v_body ->> 'apkVersion'))
      on conflict (version_code) do update
        set version = excluded.version,
            mandatory = excluded.mandatory,
            notes = excluded.notes,
            apk_url = excluded.apk_url;

    elsif v_body ? 'files' then
      -- 热更新清单：整体替换（多出来的文件会被删掉）
      insert into public.app_web_manifest (path, hash, bytes)
      select f ->> 'path', f ->> 'hash', coalesce((f ->> 'bytes')::int, 0)
      from jsonb_array_elements(v_body -> 'files') as f
      on conflict (path) do update
        set hash = excluded.hash, bytes = excluded.bytes, updated_at = now();

      delete from public.app_web_manifest m
      where not exists (
        select 1 from jsonb_array_elements(v_body -> 'files') as f where f ->> 'path' = m.path
      );
      v_applied_files := 1;
    end if;
  end loop;

  -- 触发下一次抓取（结果在下一次调用时消费）
  perform net.http_get('https://dogoffurina114514.github.io/HomeworkShower/version.json');
  perform net.http_get('https://dogoffurina114514.github.io/HomeworkShower/manifest.json');

  return jsonb_build_object('appliedVersion', v_applied_version, 'appliedManifest', v_applied_files, 'ranAt', now());
end;
$$;

-- 版本表需要记录"这条数据对应哪次响应"
alter table public.app_web_release
  add column if not exists epoch timestamptz not null default 'epoch'::timestamptz;

revoke all on function public.sync_app_version_from_github() from public, anon, authenticated;
