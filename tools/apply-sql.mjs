/**
 * 按顺序把 supabase/*.sql 应用到 Supabase 项目（走 Management API，无需 psql）。
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx PROJECT_REF=xxx node tools/apply-sql.mjs
 *
 * 三个脚本都是幂等的，可以重复执行。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL_DIR = join(ROOT, "supabase");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF;
if (!token || !ref) {
  console.error("需要环境变量 SUPABASE_ACCESS_TOKEN 与 PROJECT_REF");
  process.exit(1);
}

// 顺序有意义：先建表，再写角色规则，最后放开发服务端密钥
const ORDER = ["schema.sql", "bootstrap-admin.sql", "fix-service-role.sql"];
const available = readdirSync(SQL_DIR).filter((name) => name.endsWith(".sql"));
const files = [...ORDER.filter((name) => available.includes(name)), ...available.filter((name) => !ORDER.includes(name))];

for (const file of files) {
  const query = readFileSync(join(SQL_DIR, file), "utf8");
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  console.log(response.ok ? `✓ ${file}` : `✗ ${file} → ${response.status}: ${text.slice(0, 300)}`);
  if (!response.ok) process.exit(1);
}

console.log("全部执行完成");
