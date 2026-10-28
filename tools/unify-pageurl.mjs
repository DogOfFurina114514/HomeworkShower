// App 端已支持无后缀（MainActivity.LocalSiteHandler 会把 /login 回落到 login.html、
// 把 /site/ 回落到 index.html），所以前端不再按 host 分支，统一用无后缀。
//
// 保留 pageUrl 这层函数本身：它集中处理「index 收敛成 ./」和查询串拼接，
// 也方便以后改规则只动一处。
import { readFileSync, writeFileSync } from "node:fs";

// ---------- 完整版 client.js ----------
{
  const file = "assets/client.js";
  let text = readFileSync(file, "utf8");

  const from = `  /**
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
    // index 收敛成 "./"：地址栏不该出现 index.html。
    // 但 App 内必须给 index.html —— WebViewAssetLoader 对 /site/ 这种目录请求返回 404。
    if (name === "index" || name === "index.html") {
      const home = IS_APP_WEBVIEW ? "index.html" : "./";
      return query ? home + "?" + query : home;
    }
    const clean = name.replace(/\\.html$/, "");
    const withExt = IS_APP_WEBVIEW ? clean + ".html" : clean;
    return query ? withExt + "?" + query : withExt;
  }`;

  const to = `  /**
   * 页面地址：一律省略 .html。
   *
   * 两端都支持无后缀：
   *   · 网页端 —— GitHub Pages 与 homework.fucku.top 都会把 /login 解析到 login.html
   *   · App 内 —— MainActivity.LocalSiteHandler 把 /login 回落到 login.html，
   *     把目录请求 /site/ 回落到 index.html
   * 所以这里不再按 host 分支，地址栏保持简洁。
   */
  function pageUrl(path) {
    // path 可以带查询串，如 "login?next=timemachine"
    const [name, query] = String(path).split("?");
    // 首页收敛成 "./"，地址栏不该出现 index.html
    if (name === "index" || name === "index.html") return query ? "./?" + query : "./";
    const clean = name.replace(/\\.html$/, "");
    return query ? clean + "?" + query : clean;
  }`;

  if (!text.includes(from)) throw new Error("client.js 里没找到旧的 pageUrl 实现");
  text = text.replace(from, to);
  writeFileSync(file, text);
  console.log("client.js: pageUrl 改为统一无后缀");
}

// ---------- 简版 core.js ----------
{
  const file = "simple/core.js";
  let text = readFileSync(file, "utf8");

  const from = `  /**
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
  }`;

  const to = `  /**
   * 页面地址：一律省略 .html。
   * 网页端与 App 端都支持无后缀（App 侧是 LocalSiteHandler 做的回落）。
   */
  function pageUrl(path) {
    var parts = String(path).split("?");
    var name = parts[0];
    var query = parts[1] || "";
    // 首页收敛成 "./"，地址栏不该出现 index.html
    if (name === "index" || name === "index.html") return query ? "./?" + query : "./";
    var clean = name.replace(/\\.html$/, "");
    return query ? clean + "?" + query : clean;
  }`;

  if (!text.includes(from)) throw new Error("core.js 里没找到旧的 pageUrl 实现");
  text = text.replace(from, to);
  writeFileSync(file, text);
  console.log("core.js: pageUrl 改为统一无后缀");
}
