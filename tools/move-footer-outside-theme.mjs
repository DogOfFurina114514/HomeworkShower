// 把底栏移到 m3e-theme 外面（成为它的兄弟节点）。
//
// 用户要求："页面可以显示全就直接在屏幕下方框架外加一个底栏" ——
// 也就是底栏不属于框架本身，而是框架之外的独立一条。
//
// 配合 CSS：body 拉成纵向 flex、框架 flex:1 撑满一屏，
// 底栏因此落在首屏之外，必须向下滚才出现。
import { readFileSync, writeFileSync } from "node:fs";

const files = ["index.html", "timemachine.html", "publish.html", "security.html", "login.html", "auth.html"];

let done = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf('    <footer class="license-footer"');
  if (start < 0) {
    console.log(`${file}: ⚠ 找不到底栏`);
    continue;
  }
  const end = text.indexOf("</footer>", start);
  if (end < 0) {
    console.log(`${file}: ⚠ 底栏没有闭合`);
    continue;
  }
  const block = text.slice(start, end + "</footer>".length);
  const themeEnd = text.indexOf("</m3e-theme>");
  if (themeEnd < 0) {
    console.log(`${file}: ⚠ 没有 m3e-theme`);
    continue;
  }
  if (start > themeEnd) {
    console.log(`${file}: 底栏已在框架外，跳过`);
    continue;
  }

  // 从框架内摘掉，插到 </m3e-theme> 之后
  let out = text.slice(0, start) + text.slice(end + "</footer>".length);
  const closeIdx = out.indexOf("</m3e-theme>");
  out =
    out.slice(0, closeIdx + "</m3e-theme>".length) +
    "\n\n" +
    block.replace(/^    /gm, "  ") +
    out.slice(closeIdx + "</m3e-theme>".length);

  writeFileSync(file, out);
  done += 1;
  console.log(`${file}: 底栏已移到框架外`);
}
console.log(`\n共 ${done}/${files.length} 个页面`);
