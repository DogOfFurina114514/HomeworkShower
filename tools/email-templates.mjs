/**
 * 生成并（可选）应用 HomeworkShower 的认证邮件模板。
 *
 *   node tools/email-templates.mjs            # 只生成 supabase/email-templates/*.html
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx PROJECT_REF=xxx node tools/email-templates.mjs --apply
 *
 * 模板风格与网页端一致（同一套 M3 配色）。每封邮件里都有一段
 * <div class="text-only" style="display:none…"> 的纯文本版本：
 * 支持 HTML 的客户端会隐藏它，只认纯文本的客户端则能读到内容。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "supabase", "email-templates");

const SITE = "HomeworkShower";
const BRAND = "作业";
const SITE_URL = "https://dogoffurina114514.github.io/HomeworkShower/";

const C = {
  bg: "#f5fafc",
  card: "#eff4f6",
  border: "#bfc8cb",
  text: "#171d1e",
  muted: "#3f484a",
  faint: "#6f797b",
  primary: "#006877",
  onPrimary: "#ffffff",
};

function layout({ plain, title, lead, buttonLabel, buttonUrl, code, after = "", footer }) {
  const button = buttonUrl
    ? `<tr><td align="center" style="padding:4px 0 22px;">
          <a href="${buttonUrl}" style="display:inline-block;padding:14px 30px;border-radius:999px;background:${C.primary};color:${C.onPrimary};font-size:16px;font-weight:500;text-decoration:none;">${buttonLabel}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:${C.muted};padding-bottom:6px;">如果按钮点不动，把下面这段链接复制到浏览器打开：</td></tr>
        <tr><td style="font-size:12px;line-height:1.5;color:${C.primary};word-break:break-all;padding-bottom:20px;">${buttonUrl}</td></tr>`
    : "";
  const codeBlock = code
    ? `<tr><td align="center" style="padding:4px 0 22px;">
          <div style="display:inline-block;padding:14px 24px;border-radius:14px;background:${C.card};border:1px solid ${C.border};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;letter-spacing:6px;color:${C.text};">${code}</div>
        </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:0;">
<div class="text-only" style="display:none;max-height:0;overflow:hidden;opacity:0;">
${plain}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:${C.bg};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${C.card};border:1px solid ${C.border};border-radius:20px;padding:30px 28px;font-family:'Segoe UI','Microsoft YaHei',system-ui,-apple-system,sans-serif;color:${C.text};">
      <tr><td style="font-size:15px;font-weight:600;color:${C.primary};padding-bottom:14px;letter-spacing:1px;">${BRAND}</td></tr>
      <tr><td style="font-size:22px;font-weight:500;line-height:1.4;padding-bottom:12px;">${title}</td></tr>
      <tr><td style="font-size:15px;line-height:1.7;color:${C.muted};padding-bottom:22px;">${lead}</td></tr>
      ${button}
      ${codeBlock}
      ${after}
      <tr><td style="font-size:12px;line-height:1.7;color:${C.faint};border-top:1px solid ${C.border};padding-top:16px;">${footer || "如果不是你本人操作，忽略这封邮件即可。此邮件由系统自动发送，无需回复。"}</td></tr>
    </table>
    <div style="max-width:480px;font-size:12px;color:${C.faint};padding-top:14px;font-family:'Segoe UI','Microsoft YaHei',system-ui,sans-serif;">
      ${SITE} · 同学打开就能看当天作业<br />
      <a href="${SITE_URL}" style="color:${C.faint};text-decoration:underline;">${SITE_URL}</a>
    </div>
  </td></tr>
</table>
</body>
</html>
`;
}

const TEMPLATES = {
  confirmation: {
    subject: "确认你的 HomeworkShower 邮箱",
    html: layout({
      plain: `欢迎使用 ${SITE}！请打开下面的链接完成邮箱验证（24 小时内有效）：
{{ .ConfirmationURL }}

如果这不是你的操作，请忽略此邮件。`,
      title: "确认你的邮箱",
      lead: `欢迎使用 ${SITE}。点一下下面的按钮完成邮箱验证，之后就能查看每天的作业了。`,
      buttonLabel: "验证邮箱",
      buttonUrl: "{{ .ConfirmationURL }}",
    }),
  },

  recovery: {
    subject: "重置你的 HomeworkShower 密码",
    html: layout({
      plain: `我们收到了重置密码的请求，请打开下面的链接设置新密码（24 小时内有效）：
{{ .ConfirmationURL }}

如果不是你本人操作，请忽略此邮件，你的密码不会被更改。`,
      title: "重置密码",
      lead: "我们收到了重置密码的请求。点下面的按钮设置新密码；如果这不是你做的，忽略即可，密码不会被改动。",
      buttonLabel: "设置新密码",
      buttonUrl: "{{ .ConfirmationURL }}",
    }),
  },

  magic_link: {
    subject: "登录你的 HomeworkShower 账号",
    html: layout({
      plain: `点击下面的链接即可直接登录 ${SITE}：
{{ .ConfirmationURL }}

链接只能使用一次，请勿转发给他人。`,
      title: "一键登录",
      lead: "点下面的按钮即可直接登录，不需要输入密码。链接只能使用一次，请不要转发给他人。",
      buttonLabel: "登录",
      buttonUrl: "{{ .ConfirmationURL }}",
    }),
  },

  email_change: {
    subject: "确认你新的 HomeworkShower 邮箱",
    html: layout({
      plain: `你正在把 ${SITE} 账号的邮箱改为 {{ .NewEmail }}，请打开下面的链接确认：
{{ .ConfirmationURL }}

如果不是你本人操作，请忽略此邮件。`,
      title: "确认新邮箱",
      lead: `你正在把账号邮箱改为 <strong>{{ .NewEmail }}</strong>。点下面的按钮确认这次更改。`,
      buttonLabel: "确认新邮箱",
      buttonUrl: "{{ .ConfirmationURL }}",
    }),
  },

  invite: {
    subject: "邀请你加入 HomeworkShower",
    html: layout({
      plain: `你被邀请加入 ${SITE}，请打开下面的链接设置密码并完成注册：
{{ .ConfirmationURL }}`,
      title: "你被邀请了",
      lead: `有人邀请你加入 ${SITE}。点下面的按钮设置密码，就能查看每天的作业了。`,
      buttonLabel: "接受邀请",
      buttonUrl: "{{ .ConfirmationURL }}",
    }),
  },

  reauthentication: {
    subject: "你的 HomeworkShower 验证码",
    html: layout({
      plain: `你的验证码是：{{ .Token }}

如果这不是你的操作，请忽略此邮件。`,
      title: "验证码",
      lead: "请在页面中输入下面的验证码完成验证。",
      code: "{{ .Token }}",
    }),
  },

  password_changed_notification: {
    subject: "你的 HomeworkShower 密码已更改",
    html: layout({
      plain: `你的 ${SITE} 账号密码刚刚被更改。如果这不是你本人操作，请立即重置密码。`,
      title: "密码已更改",
      lead: "你的账号密码刚刚被更改。如果这是你本人操作，可以忽略这封邮件。",
      after: `<tr><td style="font-size:14px;line-height:1.7;color:${C.muted};padding-bottom:18px;">如果<strong>不是你本人</strong>改的，请立刻用「忘记密码」重置，并检查邮箱是否被他人登录。</td></tr>`,
    }),
  },

  email_changed_notification: {
    subject: "你的 HomeworkShower 邮箱已更改",
    html: layout({
      plain: `你的 ${SITE} 账号邮箱已更改为 {{ .Email }}。如果这不是你本人操作，请立即联系我们。`,
      title: "邮箱已更改",
      lead: `你的账号邮箱已更改为 <strong>{{ .Email }}</strong>。如果这是你本人操作，可以忽略这封邮件。`,
    }),
  },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, template] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT_DIR, `${name}.html`), template.html, "utf8");
  writeFileSync(join(OUT_DIR, `${name}.subject.txt`), template.subject, "utf8");
}
console.log(`已生成 ${Object.keys(TEMPLATES).length} 套模板到 supabase/email-templates/`);

if (process.argv.includes("--apply")) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.PROJECT_REF;
  if (!token || !ref) {
    console.error("需要环境变量 SUPABASE_ACCESS_TOKEN 与 PROJECT_REF");
    process.exit(1);
  }

  const body = {
    site_url: SITE_URL,
    uri_allow_list: `${SITE_URL}*,http://localhost:8080/*`,
    mailer_autoconfirm: false,
    smtp_sender_name: SITE,
    ...Object.fromEntries(Object.entries(TEMPLATES).map(([name, t]) => [`mailer_subjects_${name}`, t.subject])),
    ...Object.fromEntries(Object.entries(TEMPLATES).map(([name, t]) => [`mailer_templates_${name}_content`, t.html])),
  };

  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log(response.ok ? `已应用到项目 ${ref}` : `应用失败 ${response.status}: ${text.slice(0, 400)}`);
}

