// 简版 core.js：两处 mailto 直连换成带失败提示的 openMailto()。
// 用 Node 替换：缩进层级深，手写 old_string 容易对不上。
import { readFileSync, writeFileSync } from "node:fs";

const file = "simple/core.js";
let text = readFileSync(file, "utf8");

const edits = [
  // ① 申请作业管理员（原来连正文都没带，只填了收件人和主题）
  {
    from:
      '                        location.href = "mailto:" + (config.adminEmail || "") +\n' +
      '                          "?subject=" + encodeURIComponent("申请作业管理员");',
    to:
      '                        openMailto(\n' +
      '                          config.adminEmail,\n' +
      '                          "申请作业管理员",\n' +
      '                          "你好，我想申请成为作业管理员（可以发布与修改作业）。\\n\\n" +\n' +
      '                            "我的账号邮箱：" + (((session() || {}).email) || "（未填写）") + "\\n\\n申请理由："\n' +
      '                        );',
  },
  // ② 邮箱不可用申诉
  {
    from:
      '            location.href = "mailto:" + (config.adminEmail || "") +\n' +
      '              "?subject=" + encodeURIComponent("邮箱不可用申诉") +\n' +
      '              "&body=" + encodeURIComponent("我的账号旧邮箱已经无法使用，申请协助。\\n\\n账号（旧邮箱）：" + oldEmail + "\\n\\n可用的新邮箱：");',
    to:
      '            openMailto(\n' +
      '              config.adminEmail,\n' +
      '              "邮箱不可用申诉",\n' +
      '              "我的账号旧邮箱已经无法使用，申请协助。\\n\\n账号（旧邮箱）：" + oldEmail + "\\n\\n可用的新邮箱："\n' +
      '            );',
  },
];

let applied = 0;
for (const { from, to } of edits) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过（命中 ${hits} 次）：${from.slice(0, 52).replace(/\n/g, "\\n")}`);
    continue;
  }
  text = text.replace(from, to);
  applied += 1;
  console.log(`已替换：${from.slice(0, 52).replace(/\n/g, "\\n")}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} / ${edits.length} 处`);
