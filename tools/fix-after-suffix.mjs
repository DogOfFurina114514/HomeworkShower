// 去掉 .html 之后的配套修正。
//
// 有三处会因此坏掉，必须一起改：
//   1. App 里的 "./" 会请求 /site/ 目录，LocalSiteHandler 对空路径返回 404
//      → pageUrl("index") 在 App 内要回 "index.html"
//   2. login.js 的 next 校验只认 xxx.html，现在 next 是 "timemachine"（无后缀），
//      会被判非法而回退首页 → 改成允许无后缀，并交给 pageUrl 统一处理
//   3. client.js 用 pathname.indexOf("ban.html") 防重定向循环，
//      现在跳到 /ban，匹配不上 → 会无限重定向
import { readFileSync, writeFileSync } from "node:fs";

const edits = [
  // ① App 内 index 返回 index.html（目录请求在 App 里是 404）
  ["assets/client.js",
    `    // index 一律收敛成 "./"：地址栏不该出现 index.html 或 index
    if (name === "index" || name === "index.html") return query ? "./?" + query : "./";`,
    `    // index 收敛成 "./"：地址栏不该出现 index.html。
    // 但 App 内必须给 index.html —— WebViewAssetLoader 对 /site/ 这种目录请求返回 404。
    if (name === "index" || name === "index.html") {
      const home = IS_APP_WEBVIEW ? "index.html" : "./";
      return query ? home + "?" + query : home;
    }`],

  // ② login.js：next 允许无后缀，再经 pageUrl 落成当前环境该有的形式
  ["assets/login.js",
    `  const nextUrl = (() => {
    const next = new URLSearchParams(location.search).get("next");
    // 旧链接的 next 可能是 index.html，同样收敛成 "./"，地址栏更简洁
    if (!next || next === "index.html") return "./";
    return /^[\\w.-]+\\.html(\\?[^#]*)?$/.test(next) ? next : "./";
  })();`,
    `  const nextUrl = (() => {
    const next = new URLSearchParams(location.search).get("next");
    if (!next) return hs.pageUrl("index");
    // 只接受站内页面名（现在链接里通常不带 .html，旧链接可能带），
    // 统一交给 hs.pageUrl 决定要不要补扩展名。
    const match = /^([\\w.-]+?)(?:\\.html)?(\\?[^#]*)?$/.exec(next);
    if (!match) return hs.pageUrl("index");
    return hs.pageUrl((match[1] || "index") + (match[2] || ""));
  })();`],

  // ③ client.js：封禁判断兼容 /ban 与 /ban.html，否则无限重定向
  ["assets/client.js",
    `    if (location.pathname.indexOf("ban.html") >= 0) return;`,
    `    // 兼容 /ban 与 /ban.html（网页端已不带后缀）
    if (/\\/ban(?:\\.html)?$/.test(location.pathname)) return;`],
];

const cache = new Map();
let applied = 0;
for (const [file, from, to] of edits) {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  const text = cache.get(file);
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}（命中 ${hits}）`);
    continue;
  }
  cache.set(file, text.replace(from, to));
  applied += 1;
  console.log(`OK ${file}`);
}
for (const [file, text] of cache) writeFileSync(file, text);
console.log(`\n${applied} / ${edits.length} 处`);
