/**
 * 发布网页时的同步动作（单一命令，双份冗余 + Supabase 跟随 GitHub）：
 *
 *   1. 扫描 docs/ 计算每个文件的 sha256
 *   2. 写 GitHub 侧清单  docs/manifest.json
 *   3. 读 GitHub 侧版本   docs/version.json（权威来源）
 *   4. 把清单与版本同步进 Supabase（镜像；即使忘了跑，GitHub 侧也是完整的）
 *
 * 用法：node tools/web-manifest.mjs [--dry]
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DOCS = join(ROOT, "docs");
const SKIP_DIRS = new Set([".git"]);
const DRY = process.argv.includes("--dry");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full);
      continue;
    }
    if (name === "manifest.json") continue; // 清单本身不进清单
    const rel = relative(DOCS, full).split(sep).join("/");
    const buffer = readFileSync(full);
    files.push({ path: rel, hash: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length });
  }
})(DOCS);

const versionInfo = JSON.parse(readFileSync(join(DOCS, "version.json"), "utf8"));

// ① GitHub 侧清单
const manifest = {
  version: versionInfo.webVersion,
  versionCode: versionInfo.webVersionCode,
  entry: versionInfo.entry || "index.html",
  files: files,
};
writeFileSync(join(DOCS, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`GitHub 清单已写：docs/manifest.json（${files.length} 个文件）`);

// ② Supabase 跟随 GitHub：版本 + 清单 + 安装包信息，全部以 version.json 为准
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF;
if (DRY || !token || !ref) {
  console.log("未提供 SUPABASE_ACCESS_TOKEN / PROJECT_REF（或 --dry）：仅写 GitHub 侧。");
  process.exit(0);
}

const esc = (v) => String(v).replace(/'/g, "''");
const values = files.map((f) => `('${esc(f.path)}', '${f.hash}', ${f.bytes})`).join(",\n  ");
const paths = files.map((f) => `'${esc(f.path)}'`).join(", ");

const sql = `
insert into public.app_web_release (version, version_code, entry)
values ('${esc(versionInfo.webVersion)}', ${Number(versionInfo.webVersionCode)}, '${esc(versionInfo.entry || "index.html")}')
on conflict do nothing;

insert into public.app_web_manifest (path, hash, bytes) values
  ${values}
on conflict (path) do update set hash = excluded.hash, bytes = excluded.bytes, updated_at = now();
delete from public.app_web_manifest where path not in (${paths});

insert into public.app_releases (version, version_code, mandatory, notes, apk_url)
select '${esc(versionInfo.apkVersion)}', ${Number(versionInfo.apkVersionCode)}, ${versionInfo.apkMandatory ? "true" : "false"},
       ${versionInfo.apkNotes ? `'${esc(versionInfo.apkNotes)}'` : "null"},
       replace('${esc(versionInfo.apkUrlTemplate)}', '{version}', '${esc(versionInfo.apkVersion)}')
where not exists (select 1 from public.app_releases where version_code = ${Number(versionInfo.apkVersionCode)});
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
console.log(response.ok ? `Supabase 已跟随 GitHub 更新：清单 ${files.length} 条、版本 ${versionInfo.webVersion}` : `同步失败 ${response.status}: ${(await response.text()).slice(0, 300)}`);
