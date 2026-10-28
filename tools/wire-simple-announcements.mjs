// 把简版的公告功能接到页面里：
//   ① FAB 菜单加「新建公告」（仅发布者/管理员可见）
//   ② 主界面与时光机页各加载并绑定一次公告栏
import { readFileSync, writeFileSync } from "node:fs";

const file = "simple/core.js";
let text = readFileSync(file, "utf8");

const edits = [
  // ① FAB 菜单：新建公告放在「发布作业」之前
  [
    `      (isPublisher() ? '<button type="button" id="menu-publish">' + icon("upload", 18) + "发布作业</button>" : "") +`,
    `      (canEdit() ? '<button type="button" id="menu-announcement">' + icon("note", 18) + "新建公告</button>" : "") +
      (isPublisher() ? '<button type="button" id="menu-publish">' + icon("upload", 18) + "发布作业</button>" : "") +`,
  ],
  [
    `    if ($("menu-publish")) $("menu-publish").onclick = function () { location.href = "publish.html"; };`,
    `    if ($("menu-announcement")) $("menu-announcement").onclick = function () { openAnnouncementDialog(); };
    if ($("menu-publish")) $("menu-publish").onclick = function () { location.href = "publish.html"; };`,
  ],
  // ② 主界面
  [
    `    bindAccount();
    fab(exportJson);
    bindBoard();`,
    `    bindAccount();
    fab(exportJson);
    bindBoard();
    bindAnnouncementBar();
    loadAnnouncements();`,
  ],
  // ③ 时光机页（公告是公开内容，这里也显示）
  [
    `    bindAccount();
    bindBoard();
    message("请选择一个日期");`,
    `    bindAccount();
    bindBoard();
    bindAnnouncementBar();
    loadAnnouncements();
    message("请选择一个日期");`,
  ],
];

let applied = 0;
for (const [from, to] of edits) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过（命中 ${hits} 次）：${from.split("\n")[0].trim().slice(0, 52)}`);
    continue;
  }
  text = text.replace(from, to);
  applied += 1;
  console.log(`已替换：${from.split("\n")[0].trim().slice(0, 52)}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} / ${edits.length} 处`);
