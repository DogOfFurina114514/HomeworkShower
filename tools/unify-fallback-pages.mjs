// 把兜底页（unsupport / 404）也改成无后缀，并修掉它们俩的路径拼接 bug。
//
// 改动面：
//   ① 6 个完整版页面里的降级跳转：unsupport.html?page=xxx.html → unsupport?page=xxx
//      注意 page 的格式必须与 unsupport.html 的白名单一致，所以两边同步去后缀。
//   ② unsupport.html：白名单、回退值、site 根目录计算。
//      原来 base 用 pathname 第一段（/HomeworkShower/unsupport.html → /HomeworkShower/），
//      换成根域名后会拼成 /unsupport.html/，导致"前往简版"的链接整个是错的。
//   ③ 404.html：同样的 base 问题。但 404 页的 pathname 是用户乱输的路径，
//      不能"取当前目录"，要按域名类型判断（项目 Pages 取第一段，自定义域名取根）。
//   ④ publish.js / core.js 里跳 404 的地方。
import { readFileSync, writeFileSync } from "node:fs";

let changed = 0;
const touch = (file, from, to, label) => {
  let text = readFileSync(file, "utf8");
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}「${label}」：命中 ${hits} 次`);
    return;
  }
  writeFileSync(file, text.replace(from, to));
  changed += 1;
  console.log(`OK ${file}：${label}`);
};

// ---------- ① 6 个页面的降级跳转 ----------
const pages = {
  "auth.html": "auth",
  "index.html": "index",
  "login.html": "login",
  "publish.html": "publish",
  "security.html": "security",
  "timemachine.html": "timemachine",
};

for (const [file, baseName] of Object.entries(pages)) {
  const text = readFileSync(file, "utf8");
  // 找到本页原始的 name 行（各页默认值不同）
  const m = text.match(/var name = location\.pathname\.replace\(\/\.\*\\\/\/, ""\) \|\| "([\w.]+)";/);
  if (!m) {
    console.log(`跳过 ${file}：没匹配到 name 行`);
    continue;
  }
  const fallback = m[1]; // 形如 "security.html"
  const newNameLine =
    `var name = (location.pathname.replace(/.*\\//, "") || "${fallback}").replace(/\\.html$/, "");`;

  touch(file,
    `var name = location.pathname.replace(/.*\\//, "") || "${fallback}";`,
    newNameLine,
    "name 去掉 .html");

  touch(file,
    `+ "unsupport.html?page=" +`,
    `+ "unsupport?page=" +`,
    "unsupport 路径去后缀");
}

// ---------- ② unsupport.html ----------
touch("unsupport.html",
  `        var ALLOWED = ["index.html", "timemachine.html", "login.html", "publish.html", "auth.html"];`,
  `        // 白名单与跳转方传的 page 参数都去掉了 .html，两边必须一致，
        // 否则校验失败会一律回退成看板（"去简版"就送错页了）
        var ALLOWED = ["index", "timemachine", "login", "publish", "auth"];`,
  "白名单去后缀");

touch("unsupport.html",
  `        var parts = location.pathname.split("/").filter(function (item) { return !!item; });
        var base = "/" + (parts[0] || "") + "/";`,
  `        // 页面自身所在目录：/unsupport → /，/HomeworkShower/unsupport.html → /HomeworkShower/
        //（原来取 pathname 第一段，根域名下会拼成 /unsupport.html/）
        var base = location.pathname.replace(/[^\\/]*$/, "");`,
  "base 改取当前目录");

touch("unsupport.html",
  `        if (!valid) page = "index.html";`,
  `        if (!valid) page = "index";`,
  "回退值去后缀");

// ---------- ③ 404.html ----------
touch("404.html",
  `        var parts = path.split("/").filter(function (item) { return !!item; });
        var base = "/" + (parts[0] || "") + "/";`,
  `        /* 站点根目录。404 页的 pathname 是用户乱输的路径，不能"取当前目录"：
           项目 Pages（*.github.io/repo）时第一段是仓库名，自定义域名时站点就在根。 */
        var parts = path.split("/").filter(function (item) { return !!item; });
        var isProjectPages = /\\.github\\.io$/i.test(location.hostname);
        var base = isProjectPages ? "/" + (parts[0] || "") + "/" : "/";`,
  "base 按域名类型判断");

// ---------- ④ 跳 404 的地方 ----------
touch("assets/publish.js",
  `location.replace("404.html");`,
  `location.replace(hs.pageUrl("404"));`,
  "publish.js 跳 404");

for (const from of [
  `if (!session()) return void (location.href = "404.html");`,
  `if (!isPublisher()) return void (location.href = "404.html");`,
]) {
  touch("simple/core.js", from, from.replace(`"404.html"`, `pageUrl("404")`), "core.js 跳 404");
}

console.log(`\n共改动 ${changed} 处`);
