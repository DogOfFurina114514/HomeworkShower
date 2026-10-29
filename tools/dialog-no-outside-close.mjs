// 弹窗改成「点外面不关闭」。
//
// 原因：编辑作业时在内容区选中文本，鼠标往往会滑到弹窗外面（划出边框），
// 一松手就触发了 backdrop 点击 → 弹窗直接关掉，刚编辑的内容全没了。
//
// 做法：去掉 m3e-dialog 的 dismissible 属性（它就是"点背景可关闭"的开关）。
// 但那样连 Esc 也不能关了，所以同时在 client.js 里补一个全局 Esc 处理，
// 保持键盘可关闭（可访问性不降级）。
//
// 简版同理：它的 dialog() 是自己写的，把 backdrop.onclick 那段去掉即可。
import { readFileSync, writeFileSync } from "node:fs";

const htmlFiles = [
  "index.html",
  "timemachine.html",
  "login.html",
  "security.html",
  "auth.html",
  "publish.html",
  "404.html",
  "ban.html",
  "deleted.html",
  "unsupport.html",
];

let total = 0;
for (const file of htmlFiles) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!text.includes("dismissible")) continue;

  const before = (text.match(/dismissible/g) || []).length;
  // 只处理 <m3e-dialog ... dismissible> 上的属性，别误伤注释文字
  text = text.replace(/(<m3e-dialog\b[^>]*?)\s+dismissible\b/g, "$1");
  const after = (text.match(/dismissible/g) || []).length;
  writeFileSync(file, text);
  if (before !== after) {
    console.log(`${file}: 去掉 ${before - after} 处 dismissible`);
    total += before - after;
  }
}
console.log(`\n完整版共去掉 ${total} 处`);

// 简版：不点背景关闭
{
  const file = "simple/core.js";
  let text = readFileSync(file, "utf8");
  const from = `    backdrop.onclick = function (event) { if (event.target === backdrop) close(); };`;
  if (text.includes(from)) {
    text = text.replace(
      from,
      `    // 点背景不关闭：编辑时选中文本、鼠标划出边框松手会落在 backdrop 上，
    // 原来那样会把刚编辑的内容连弹窗一起丢掉。关闭请用取消/确定按钮或 Esc。
    backdrop.onclick = function (event) {
      if (event.target === backdrop) event.stopPropagation();
    };`
    );
    writeFileSync(file, text);
    console.log("简版 core.js: backdrop 点击改为不关闭");
  } else {
    console.log("简版 core.js: 没找到 backdrop.onclick（可能已改）");
  }
}
