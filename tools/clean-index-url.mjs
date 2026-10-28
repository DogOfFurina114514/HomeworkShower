// 站内跳回首页时改用 "./"，让地址栏不出现 index.html。
//
// 为什么用 "./" 而不是 "/"：
//   站点既可能部署在根域名（homework.fucku.top/），也可能部署在
//   GitHub Pages 的子路径（/HomeworkShower/）。"/" 在子路径下会跑到域名根、
//   指向别的东西；"./" 是相对当前目录，两种情况都落在站点根上，
//   由服务器自动补 index.html，地址栏保持简洁。
//
// 不改 core.js 里 `parts[parts.length - 1] || "index.html"` ——
// 那是解析"当前是哪个页面"，不是跳转。
import { readFileSync, writeFileSync } from "node:fs";

const edits = [
  // auth.js：验证成功后进入看板
  ["assets/auth.js",
    'continueButton.dataset.target = success ? "index.html" : "login.html";',
    'continueButton.dataset.target = success ? "./" : "login.html";'],
  ["assets/auth.js",
    'location.assign(continueButton.dataset.target || "index.html");',
    'location.assign(continueButton.dataset.target || "./");'],

  // board.js：「回到今天」
  ["assets/board.js",
    'if (backButton) backButton.addEventListener("click", () => location.assign("index.html"));',
    'if (backButton) backButton.addEventListener("click", () => location.assign("./"));'],

  // login.js：登录后的落地页
  ["assets/login.js",
    '    if (!next) return "index.html";\n    return /^[\\w.-]+\\.html(\\?[^#]*)?$/.test(next) ? next : "index.html";',
    '    // 旧链接的 next 可能是 index.html，同样收敛成 "./"，地址栏更简洁\n    if (!next || next === "index.html") return "./";\n    return /^[\\w.-]+\\.html(\\?[^#]*)?$/.test(next) ? next : "./";'],
  ["assets/login.js",
    '    location.assign("index.html");',
    '    location.assign("./");'],

  // publish.js：返回按钮
  ["assets/publish.js",
    'if (backButton) backButton.addEventListener("click", () => location.assign("index.html"));',
    'if (backButton) backButton.addEventListener("click", () => location.assign("./"));'],

  // 简版：时光机 / 登录页 / 发布页 / 安全中心的返回与跳转
  ["simple/core.js",
    'topbar({ title: (config.siteName || "作业") + " · 时光机", datePicker: true, back: "index.html" });',
    'topbar({ title: (config.siteName || "作业") + " · 时光机", datePicker: true, back: "./" });'],
  ["simple/core.js",
    'topbar({ title: config.siteName || "作业", hideAccount: true, backLink: "index.html" });',
    'topbar({ title: config.siteName || "作业", hideAccount: true, backLink: "./" });'],
  ["simple/core.js",
    'if (session()) return void refreshProfile().then(function () { location.href = "index.html"; });',
    'if (session()) return void refreshProfile().then(function () { location.href = "./"; });'],
  ["simple/core.js",
    '          location.href = "index.html";',
    '          location.href = "./";'],
  ["simple/core.js",
    'topbar({ title: "发布作业", back: "index.html" });',
    'topbar({ title: "发布作业", back: "./" });'],
  ["simple/core.js",
    'topbar({ title: "安全中心", hideStatus: true, hideAccount: true, backLink: "index.html" });',
    'topbar({ title: "安全中心", hideStatus: true, hideAccount: true, backLink: "./" });'],
  ["simple/core.js",
    '<div class="dialogactions"><a class="pill primary" href="index.html">进入作业看板</a>',
    '<div class="dialogactions"><a class="pill primary" href="./">进入作业看板</a>'],
];

const cache = new Map();
let applied = 0;

for (const [file, from, to] of edits) {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  let text = cache.get(file);
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}（命中 ${hits} 次）：${from.split("\n")[0].trim().slice(0, 50)}`);
    continue;
  }
  cache.set(file, text.replace(from, to));
  applied += 1;
  console.log(`OK ${file}：${from.split("\n")[0].trim().slice(0, 50)}`);
}

for (const [file, text] of cache) writeFileSync(file, text);
console.log(`\n共替换 ${applied} / ${edits.length} 处`);
