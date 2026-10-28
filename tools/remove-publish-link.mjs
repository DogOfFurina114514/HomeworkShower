// 去掉个人中心（顶栏账号下拉）里的「发布作业」。
//
// 理由：右下角按钮菜单里已经有「发布作业」，个人中心里再放一个是重复入口；
// 用户要求只保留菜单那一处。
//
// 注意 publishLink 在 board.js 里出现在 4 个地方（元素引用、初始化、点击绑定、
// 权限同步），只删 HTML 会留下 4 个 if (publishLink) 的空判断 —— 一并清掉，
// 免得以后有人看到 const publishLink = getElementById(...) 以为还有这个元素。
import { readFileSync, writeFileSync } from "node:fs";

// ① 两个页面的 HTML
for (const file of ["index.html", "timemachine.html"]) {
  let text = readFileSync(file, "utf8");
  const line = '              <m3e-button variant="text" id="publish-link" hidden>发布作业</m3e-button>\n';
  const hits = text.split(line).length - 1;
  if (hits !== 1) {
    console.log(`${file}: ⚠ 找到 ${hits} 处 publish-link，跳过`);
    continue;
  }
  text = text.replace(line, "");
  writeFileSync(file, text);
  console.log(`${file}: 已删除个人中心里的「发布作业」`);
}

// ② board.js 的引用
{
  const file = "assets/board.js";
  let text = readFileSync(file, "utf8");

  const edits = [
    ["元素引用", `  const publishLink = document.getElementById("publish-link");\n`, ""],
    ["初始化时显示", `      if (publishLink) publishLink.hidden = !hs.isPublisher(profile);\n`, ""],
    ["点击绑定", `      if (publishLink) publishLink.addEventListener("click", () => location.assign("publish.html"));\n`, ""],
    ["权限同步", `        if (publishLink) publishLink.hidden = !hs.isPublisher(latest);\n`, ""],
  ];

  let applied = 0;
  for (const [label, from, to] of edits) {
    const hits = text.split(from).length - 1;
    if (hits !== 1) {
      console.log(`board.js: 跳过「${label}」（命中 ${hits} 次）`);
      continue;
    }
    text = text.replace(from, to);
    applied += 1;
    console.log(`board.js: 已清除「${label}」`);
  }
  writeFileSync(file, text);
  console.log(`\nboard.js 清理 ${applied} / ${edits.length} 处`);
}
