// 页面地址helper：网页端省略 .html，App 内保留 .html。
//
// 背景：
//   新域名 https://homework.fucku.top 支持无后缀访问（/login → login.html），
//   所以网页端地址栏可以用更简洁的 /login 、/timemachine 。
//   但 App 内部是 WebViewAssetLoader 按字面文件名找资源，
//   /login 会 404（除非改 Kotlin 重新发 APK）。
//   为了只用热更新就能生效，这里按 host 区分：
//     App  → appassets.androidplatform.net，保留 .html
//     网页 → 去掉 .html
//
// 注意：**邮件重定向地址必须继续用 .html**（new URL("auth.html", ...) 那些），
// 那是 Supabase 邮件里的完整 URL，改动可能让验证链接失效，不在本脚本范围内。
import { readFileSync, writeFileSync } from "node:fs";

// ---------- ① 完整版：在 client.js 里加 hs.pageUrl ----------
{
  const file = "assets/client.js";
  let text = readFileSync(file, "utf8");

  if (text.includes("pageUrl:")) {
    console.log("client.js: 已有 pageUrl，跳过");
  } else {
    const anchor = "  window.hs = {";
    const helper = `  /**
   * 页面地址：网页端省略 .html，App 内保留。
   *
   * App 里是 WebViewAssetLoader 按字面文件名找资源，/login 会 404；
   * 网页端的新域名支持无后缀（/login → login.html），地址栏更简洁。
   * 这样不用改 Kotlin、不用重发 APK，热更新就能生效。
   */
  const IS_APP_WEBVIEW = location.hostname === "appassets.androidplatform.net";
  function pageUrl(path) {
    // path 可以带查询串，如 "login?next=timemachine"
    const [name, query] = String(path).split("?");
    // index 一律收敛成 "./"：地址栏不该出现 index.html 或 index
    if (name === "index" || name === "index.html") return query ? "./?" + query : "./";
    const clean = name.replace(/\\.html$/, "");
    const withExt = IS_APP_WEBVIEW ? clean + ".html" : clean;
    return query ? withExt + "?" + query : withExt;
  }

  window.hs = {`;
    if (!text.includes(anchor)) throw new Error("client.js 找不到 window.hs 锚点");
    text = text.replace(anchor, helper);
    text = text.replace("    roleLabel: (role) => ROLE_LABELS[role] || role,", "    pageUrl,\n    roleLabel: (role) => ROLE_LABELS[role] || role,");
    writeFileSync(file, text);
    console.log("client.js: 已加入 hs.pageUrl");
  }
}

// ---------- ② 页面间跳转改成 pageUrl ----------
const edits = [
  // auth.js
  ["assets/auth.js", 'continueButton.dataset.target = success ? "./" : "login.html";',
    'continueButton.dataset.target = success ? "./" : hs.pageUrl("login");'],

  // board.js
  ["assets/board.js",
    'location.assign(`login.html?next=${encodeURIComponent("timemachine.html")}`);',
    'location.assign(`login?next=${encodeURIComponent("timemachine")}`);'],
  ["assets/board.js", 'accountButton.addEventListener("click", () => location.assign("login.html"));',
    'accountButton.addEventListener("click", () => location.assign(hs.pageUrl("login")));'],
  ["assets/board.js", 'if (bannerLoginButton) bannerLoginButton.addEventListener("click", () => location.assign("login.html"));',
    'if (bannerLoginButton) bannerLoginButton.addEventListener("click", () => location.assign(hs.pageUrl("login")));'],
  ["assets/board.js", 'securityLink.addEventListener("click", () => location.assign("security.html"));',
    'securityLink.addEventListener("click", () => location.assign(hs.pageUrl("security")));'],
  ["assets/board.js", 'timemachineButton.addEventListener("click", () => location.assign(session ? "timemachine.html" : "login.html"));',
    'timemachineButton.addEventListener("click", () => location.assign(hs.pageUrl(session ? "timemachine" : "login")));'],
  ["assets/board.js", 'document.getElementById("fab-publish")?.addEventListener("click", () => location.assign("publish.html"));',
    'document.getElementById("fab-publish")?.addEventListener("click", () => location.assign(hs.pageUrl("publish")));'],

  // publish.js
  ["assets/publish.js", 'if (backButton) backButton.addEventListener("click", () => location.assign("./"));',
    'if (backButton) backButton.addEventListener("click", () => location.assign("./"));'],

  // client.js：封禁/掉登录时的重定向
  ["assets/client.js", 'location.replace("login.html");', 'location.replace(pageUrl("login"));'],
  ["assets/client.js", 'location.replace("ban.html");', 'location.replace(pageUrl("ban"));'],
];

const cache = new Map();
let applied = 0;
for (const [file, from, to] of edits) {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  const text = cache.get(file);
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}（命中 ${hits}）：${from.slice(0, 56)}`);
    continue;
  }
  cache.set(file, text.replace(from, to));
  applied += 1;
  console.log(`OK ${file}: ${from.slice(0, 56)}`);
}
for (const [file, text] of cache) writeFileSync(file, text);
console.log(`\n跳转替换 ${applied} / ${edits.length} 处`);
