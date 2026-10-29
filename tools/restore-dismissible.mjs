// 恢复 m3e-dialog 的 dismissible 属性，改用"捕获阶段拦截背景点击"来实现
// 「点外面不关闭」。
//
// 为什么不直接删 dismissible：它是 M3E 管 Esc 关闭的开关之一，
// 删了之后 Esc 也不能关，键盘用户就没法关弹窗了。保留它、
// 只拦掉落在背景上的那次点击，能同时保住两件事。
//
// 唯一不恢复的是 announcement-confirm-dialog（它本来就没有 dismissible，
// 是戳一下就得选「取消/删除」的确认框）。
import { readFileSync, writeFileSync } from "node:fs";

const htmlFiles = [
  "index.html",
  "timemachine.html",
  "login.html",
  "security.html",
];
const SKIP_IDS = new Set(["announcement-confirm-dialog"]);

let total = 0;
for (const file of htmlFiles) {
  let text = readFileSync(file, "utf8");
  let count = 0;

  text = text.replace(/<m3e-dialog\b([^>]*)>/g, (whole, attrs) => {
    if (/\bdismissible\b/.test(attrs)) return whole;
    const idMatch = attrs.match(/id="([^"]+)"/);
    if (idMatch && SKIP_IDS.has(idMatch[1])) return whole;
    count += 1;
    return `<m3e-dialog${attrs} dismissible>`;
  });

  if (count) {
    writeFileSync(file, text);
    console.log(`${file}: 恢复 ${count} 处 dismissible`);
    total += count;
  }
}
console.log(`\n共恢复 ${total} 处`);
