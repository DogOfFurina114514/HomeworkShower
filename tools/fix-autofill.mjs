// 阻止浏览器把作业编辑里的「科目」「标签」当成要记住的个人信息。
//
// 这类提示来自浏览器的自动填充启发式：只要 input 没有明确的 autocomplete，
// 它就可能列入"保存以便下次填写"。业务字段应当显式声明 off。
//
// 同时给只读字段补上 autocomplete="off"（readonly 本来就不会填充，
// 但有些浏览器仍会给建议），并把一处漏掉的邮箱语义补正确。
import { readFileSync, writeFileSync } from "node:fs";

const edits = [
  // 作业编辑：科目 / 标签（用户报的就是科目）
  ["index.html",
    `              <input id="edit-subject" type="text" />`,
    `              <input id="edit-subject" type="text" autocomplete="off" spellcheck="false" />`],
  ["index.html",
    `              <input id="edit-tags" type="text" />`,
    `              <input id="edit-tags" type="text" autocomplete="off" spellcheck="false" />`],
  ["timemachine.html",
    `                  <input id="edit-subject" type="text" />`,
    `                  <input id="edit-subject" type="text" autocomplete="off" spellcheck="false" />`],
  ["timemachine.html",
    `                  <input id="edit-tags" type="text" />`,
    `                  <input id="edit-tags" type="text" autocomplete="off" spellcheck="false" />`],

  // 只读字段：防御性补 off
  ["index.html", `<input id="apply-email" readonly />`, `<input id="apply-email" readonly autocomplete="off" />`],
  ["timemachine.html", `<input id="apply-email" readonly />`, `<input id="apply-email" readonly autocomplete="off" />`],
  ["publish.html", `<input id="publish-date" type="text" readonly />`, `<input id="publish-date" type="text" readonly autocomplete="off" />`],
  ["security.html", `<input id="current-email" readonly />`, `<input id="current-email" readonly autocomplete="off" />`],
  ["security.html", `<input id="appeal-email" readonly />`, `<input id="appeal-email" readonly autocomplete="off" />`],

  // 重发验证邮件那里确实是邮箱，语义补正确（原来什么都没写）
  ["login.html", `<input id="resend-email" type="email" />`, `<input id="resend-email" type="email" autocomplete="email" />`],
];

const cache = new Map();
let applied = 0;
for (const [file, from, to] of edits) {
  if (!cache.has(file)) cache.set(file, readFileSync(file, "utf8"));
  const text = cache.get(file);
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过 ${file}（命中 ${hits}）：${from.trim().slice(0, 52)}`);
    continue;
  }
  cache.set(file, text.replace(from, to));
  applied += 1;
  console.log(`OK ${file}: ${from.trim().slice(0, 52)}`);
}
for (const [file, text] of cache) writeFileSync(file, text);
console.log(`\n共改动 ${applied} / ${edits.length} 处`);
