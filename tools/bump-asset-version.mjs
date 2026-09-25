// 把所有页面里的静态资源版本号从 v84/v78 统一提到 v85。
//
// 为什么必须做：页面用 ?vNN 当缓存钥匙，而 App 内置站点（LocalSiteHandler）
// 返回的响应没有 Cache-Control，WebView 会按默认启发式缓存。
// 改了 board.js / client.js / app.css 却不提这个号，热更新虽然把文件换了，
// 客户端仍可能继续用缓存里的旧脚本 —— 表现就是"推送了但用户那边没变化"。
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = process.argv[2] || "v85";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (name.endsWith(".html")) files.push(full);
  }
})(".");

let touched = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const next = text.replace(/\?v\d+/g, `?${TARGET}`);
  if (next === text) continue;
  writeFileSync(file, next);
  const before = [...new Set(text.match(/\?v\d+/g) || [])].join(",");
  console.log(`${file}: ${before} → ?${TARGET}`);
  touched += 1;
}
console.log(`共改动 ${touched} 个文件`);
