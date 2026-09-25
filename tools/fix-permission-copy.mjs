// 一次性文案修正：权限从「只能改当天发布的」改成「未过期的都能改」之后，
// 页面上还留着几处旧说法，这里统一替换掉。
import { readFileSync, writeFileSync } from "node:fs";

const edits = [
  ["index.html",
   "<span class=\"banner__text\">还没有登录：登录后可以用时光机查看以前的作业，也才能发布或修改（仅限当天）。</span>",
   "<span class=\"banner__text\">还没有登录：登录后可以用时光机查看以前的作业，也才能发布或修改（仅限未过期的作业）。</span>"],
  ["index.html",
   "<p class=\"hint\">删除后无法恢复。只有当天发布的内容可以修改或删除。</p>",
   "<p class=\"hint\">删除后无法恢复。只有未过期的作业可以修改或删除。</p>"],
  ["timemachine.html",
   "<p class=\"hint\">删除后无法恢复。只有当天发布的内容可以修改或删除。</p>",
   "<p class=\"hint\">删除后无法恢复。只有未过期的作业可以修改或删除。</p>"],
  ["index.html",
   "而且只能修改当天发布的内容。",
   "而且只能修改未过期的作业。"],
  ["timemachine.html",
   "而且只能修改当天发布的内容。",
   "而且只能修改未过期的作业。"],
];

for (const [file, from, to] of edits) {
  const text = readFileSync(file, "utf8");
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}（命中 ${hits} 次）：${from.slice(0, 34)}`);
    continue;
  }
  writeFileSync(file, text.replace(from, to));
  console.log(`已替换 ${file}：${from.slice(0, 30)}…`);
}
