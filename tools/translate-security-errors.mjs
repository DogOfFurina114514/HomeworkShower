// security.js：把"直接贴 Supabase 英文错误"的地方换成中文可行动提示，
// 并把「通知邮件发送失败」的原因带到注销说明页（原来是只 console.warn，用户完全不知道）。
//
// 用 Node 做替换：PowerShell 会把反引号当转义符，模板字符串里的 ${...} 会被吃掉。
import { readFileSync, writeFileSync } from "node:fs";

const file = "assets/security.js";
let text = readFileSync(file, "utf8");

const edits = [
  // ---- 旧邮箱验证：发信失败 ----
  [
    "      error ? `发送失败：${error.message}` : `验证邮件已发送到 ${email}，请点开邮件里的链接（同时也会让你重新登录一次）。`,",
    "      error ? hs.describeAuthError(error, \"发送验证邮件\") : `验证邮件已发送到 ${email}，请点开邮件里的链接（同时也会让你重新登录一次）。`,",
  ],
  // ---- 改邮箱：除"已被占用"外一律翻译 ----
  [
    "      show(emailMessage, text.includes(\"already\") ? \"这个邮箱已经被其它账号使用了。\" : `发送失败：${error.message}`);",
    "      show(emailMessage, text.includes(\"already\") ? \"这个邮箱已经被其它账号使用了。\" : hs.describeAuthError(error, \"发送验证邮件\"));",
  ],
  // ---- 重发验证邮件 ----
  [
    "    show(emailMessage, error ? `重发失败：${error.message}` : \"验证邮件已重新发送，请查收（也看看垃圾箱）。\", Boolean(error));",
    "    show(emailMessage, error ? hs.describeAuthError(error, \"重发验证邮件\") : \"验证邮件已重新发送，请查收（也看看垃圾箱）。\", Boolean(error));",
  ],
  // ---- 密码：验证码发送失败 ----
  [
    "    if (error) return show(passwordMessage, `发送失败：${error.message}`);",
    "    if (error) return show(passwordMessage, hs.describeAuthError(error, \"发送验证码\"));",
  ],
  // ---- 密码：校验验证码失败 ----
  [
    "      return show(passwordMessage, `验证码不正确或已过期：${error.message}`);",
    "      return show(passwordMessage, hs.describeAuthError(error, \"校验验证码\"));",
  ],
  // ---- 密码：设置新密码失败 ----
  [
    "    if (updateError) return show(passwordMessage, `设置新密码失败：${updateError.message}`);",
    "    if (updateError) return show(passwordMessage, hs.describeAuthError(updateError, \"设置新密码\"));",
  ],
  // ---- 注销：发验证邮件失败 ----
  [
    "        error ? `发送失败：${error.message}` : `验证邮件已发送到 ${email}：请把邮件里的数字验证码填到下面。`,",
    "        error ? hs.describeAuthError(error, \"发送验证邮件\") : `验证邮件已发送到 ${email}：请把邮件里的数字验证码填到下面。`,",
  ],
  // ---- 注销：校验验证码失败 ----
  [
    "    if (error) return show(deletionMessage, `验证码不正确或已过期：${error.message}`);",
    "    if (error) return show(deletionMessage, hs.describeAuthError(error, \"校验验证码\"));",
  ],
  // ---- 注销：提交申请失败 ----
  [
    "      return show(deletionMessage, `提交失败：${error.message}`);",
    "      return show(deletionMessage, hs.describeAuthError(error, \"提交注销申请\"));",
  ],
  // ---- 注销：取消申请失败 ----
  [
    "    if (error) return show(deletionMessage, `取消失败：${error.message}`);",
    "    if (error) return show(deletionMessage, hs.describeAuthError(error, \"取消注销申请\"));",
  ],
  // ---- 通知邮件失败：记下原因，交给 deleted.html 说明 ----
  [
    "    let notified = false;\n    try {",
    "    let notified = false;\n    // 失败原因要带到说明页：否则用户以为邮箱里会有一封\"可随时取消\"的信，\n    // 一直等，反而错过 3 天窗口。原来这里只 console.warn，页面上一字不提。\n    let mailFailure = \"\";\n    try {",
  ],
  [
    "      notified = !mailError;\n      if (mailError) console.warn(\"[HomeworkShower] 通知邮件发送失败：\", mailError.message);",
    "      notified = !mailError;\n      if (mailError) {\n        mailFailure = hs.describeAuthError(mailError, \"发送通知邮件\");\n        console.warn(\"[HomeworkShower] 通知邮件发送失败：\", mailError.message);\n      }",
  ],
  [
    "    } catch (error) {\n      console.warn(\"[HomeworkShower] 通知邮件发送失败：\", error);\n    }",
    "    } catch (error) {\n      mailFailure = hs.describeAuthError(error, \"发送通知邮件\");\n      console.warn(\"[HomeworkShower] 通知邮件发送失败：\", error);\n    }",
  ],
  // ---- 跳转时把原因带上（截断，避免 URL 过长）----
  [
    "    location.replace(`deleted.html?state=requested&notified=${notified ? \"1\" : \"0\"}`);",
    "    const reason = notified ? \"\" : `&reason=${encodeURIComponent(mailFailure.slice(0, 120))}`;\n    location.replace(`deleted.html?state=requested&notified=${notified ? \"1\" : \"0\"}${reason}`);",
  ],
];

let applied = 0;
let skipped = 0;
for (const [from, to] of edits) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    skipped += 1;
    console.log(`跳过（命中 ${hits} 次）：${from.slice(0, 60).replace(/\n/g, "\\n")}`);
    continue;
  }
  text = text.replace(from, to);
  applied += 1;
  console.log(`已替换：${from.slice(0, 60).replace(/\n/g, "\\n")}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} 处，跳过 ${skipped} 处`);
