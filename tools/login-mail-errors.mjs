// login.js：两处"重发验证邮件失败"仍直接贴 Supabase 英文原文，换成 hs.describeAuthError。
import { readFileSync, writeFileSync } from "node:fs";

const file = "assets/login.js";
let text = readFileSync(file, "utf8");

const edits = [
  [
    '        text.includes("rate limit") || text.includes("too many") ? "发送太频繁了，请等一分钟再试。" : `发送失败：${error.message}`,',
    "        hs.describeAuthError(error, \"发送验证邮件\"),",
  ],
  [
    "    showMessage(error ? `重发失败：${error.message}` : \"验证邮件已重新发送，请稍等一两分钟查收（也看看垃圾箱）。\", Boolean(error));",
    "    showMessage(error ? hs.describeAuthError(error, \"重发验证邮件\") : \"验证邮件已重新发送，请稍等一两分钟查收（也看看垃圾箱）。\", Boolean(error));",
  ],
];

let applied = 0;
for (const [from, to] of edits) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过（命中 ${hits} 次）：${from.slice(0, 56)}`);
    continue;
  }
  text = text.replace(from, to);
  applied += 1;
  console.log(`已替换：${from.slice(0, 56)}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} / ${edits.length} 处`);
