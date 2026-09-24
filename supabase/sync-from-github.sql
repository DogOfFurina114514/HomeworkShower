create or replace function public.sync_app_version_from_github()
returns jsonb
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_row record;
  v_body jsonb;
  v_applied_version integer := 0;
  v_applied_files integer := 0;
begin
  -- 逐条消费最近的响应，用内容特征区分"版本文件"与"清单文件"（该版本 pg_net 没有 url 列）
  for v_row in
    select content
    from net._http_response
    where status_code = 200 and content is not null
    order by id desc
    limit 6
  loop
    begin
      v_body := v_row.content::jsonb;
    exception when others then
      continue;
    end;

    if v_body ? 'webVersionCode' then
      -- 网页版本表恒为一行：id = 1。回滚到旧版本号时也能覆盖，
      -- 不会再像早先那样每次同步都插一条新行。
      insert into public.app_web_release (id, version, version_code, entry, published_at)
      values (1, v_body ->> 'webVersion', (v_body ->> 'webVersionCode')::int,
              coalesce(v_body ->> 'entry', 'index.html'), now())
      on conflict (id) do update
        set version = excluded.version,
            version_code = excluded.version_code,
            entry = excluded.entry,
            published_at = excluded.published_at;
      v_applied_version := 1;

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

  perform net.http_get('https://dogoffurina114514.github.io/HomeworkShower/version.json');
  perform net.http_get('https://dogoffurina114514.github.io/HomeworkShower/manifest.json');

  return jsonb_build_object('appliedVersion', v_applied_version, 'appliedManifest', v_applied_files, 'ranAt', now());
end;
$$;
revoke all on function public.sync_app_version_from_github() from public, anon, authenticated;
