// 简版 core.js：加自己的 pageUrl 并替换页面间跳转。
//
// 简版不加载 assets/client.js（只有 config.js + core.js），所以拿不到 hs.pageUrl，
// 得自己来一份。规则与完整版一致：网页端去 .html，App 内保留。
import { readFileSync, writeFileSync } from "node:fs";

const file = "simple/core.js";
let text = readFileSync(file, "utf8");

// ① 插入 pageUrl（放在 icon 之后、登录态之前，模块层）
if (!text.includes("function pageUrl(")) {
  const anchor = "  /* ---------------------------------------------------------- 登录态 */";
  if (!text.includes(anchor)) throw new Error("找不到登录态锚点");
  const helper = `  /**
   * 页面地址：网页端省略 .html，App 内保留。
   *
   * App 里是 WebViewAssetLoader 按字面文件名找资源，/login 会 404；
   * 网页端（homework.fucku.top）支持无后缀，地址栏更简洁。
   * index 收敛成 "./"，但 App 内要给 index.html —— 目录请求在 App 里是 404。
   */
  var IS_APP_WEBVIEW = location.hostname === "appassets.androidplatform.net";
  function pageUrl(path) {
    var parts = String(path).split("?");
    var name = parts[0];
    var query = parts[1] || "";
    if (name === "index" || name === "index.html") {
      var home = IS_APP_WEBVIEW ? "index.html" : "./";
      return query ? home + "?" + query : home;
    }
    var clean = name.replace(/\\.html$/, "");
    var withExt = IS_APP_WEBVIEW ? clean + ".html" : clean;
    return query ? withExt + "?" + query : withExt;
  }

${anchor}`;
  text = text.replace(anchor, helper);
  console.log("core.js: 已加入 pageUrl");
} else {
  console.log("core.js: 已有 pageUrl，跳过");
}

// ② 替换跳转（邮件相关的不动）
const edits = [
  ["'<a class=\"pill\" href=\"timemachine.html\">'", "'<a class=\"pill\" href=\"' + pageUrl(\"timemachine\") + '\">'"],
  ["'<a class=\"pill\" id=\"account-button\" href=\"login.html\">'", "'<a class=\"pill\" id=\"account-button\" href=\"' + pageUrl(\"login\") + '\">'"],
  ['location.href = "publish.html";', 'location.href = pageUrl("publish");'],
  ['location.href = "security.html";', 'location.href = pageUrl("security");'],
  ["'<a class=\"pill primary\" href=\"login.html\">登录 / 注册</a>'", "'<a class=\"pill primary\" href=\"' + pageUrl(\"login\") + '\">登录 / 注册</a>'"],
  ['location.href = "ban.html";', 'location.href = pageUrl("ban");'],
  ['location.href = "login.html";', 'location.href = pageUrl("login");'],
  ['(location.href = "login.html")', '(location.href = pageUrl("login"))'],
  ['(location.href = "ban.html")', '(location.href = pageUrl("ban"))'],
];

let applied = 0;
for (const [from, to] of edits) {
  const before = text.split(from).length - 1;
  if (before === 0) {
    console.log(`跳过（未命中）：${from.slice(0, 56)}`);
    continue;
  }
  text = text.split(from).join(to);
  applied += before;
  console.log(`OK ×${before}: ${from.slice(0, 56)}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} 处`);
