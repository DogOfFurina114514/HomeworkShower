/**
 * 一次性把 HomeworkShower 的认证设置应用到 Supabase 项目：
 * 站点地址、自定义 SMTP（发信人 = HomeworkShower）、邮件模板、速率。
 *
 * 用法：
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx PROJECT_REF=xxx SMTP_PASS=xxx node tools/apply-auth-config.mjs
 *
 * SMTP 账号与授权码是私密信息，不写进仓库；只在本地环境变量里传。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = join(ROOT, "supabase", "email-templates");

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF;
const smtpPass = process.env.SMTP_PASS;

if (!token || !ref) {
  console.error("需要环境变量 SUPABASE_ACCESS_TOKEN 与 PROJECT_REF");
  process.exit(1);
}

const SITE = "HomeworkShower";
const SITE_URL = "https://dogoffurina114514.github.io/HomeworkShower/";

const TEMPLATE_NAMES = [
  "confirmation",
  "recovery",
  "magic_link",
  "email_change",
  "invite",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
];

const read = (name, ext) => readFileSync(join(TEMPLATE_DIR, `${name}.${ext}`), "utf8");

const body = {
  // 站点与回调白名单：邮件里的链接回到 Pages，本地调试用 8080
  site_url: SITE_URL,
  uri_allow_list: `${SITE_URL}*,http://localhost:8080/*,http://127.0.0.1:8080/*`,

  // 注册后必须验证邮箱
  mailer_autoconfirm: false,
  mailer_secure_email_change_enabled: true,
  mailer_otp_exp: 3600,

  // 自定义发信人：与 WMessage 同一套 163 SMTP，只把发信人改成 HomeworkShower
  smtp_host: "smtp.163.com",
  smtp_port: "465",
  smtp_user: "wu__20111229@163.com",
  smtp_admin_email: "wu__20111229@163.com",
  smtp_sender_name: SITE,
  smtp_max_frequency: 60,
  rate_limit_email_sent: 30,

  ...Object.fromEntries(TEMPLATE_NAMES.map((name) => [`mailer_subjects_${name}`, read(name, "subject.txt")])),
  ...Object.fromEntries(TEMPLATE_NAMES.map((name) => [`mailer_templates_${name}_content`, read(name, "html")])),
};

if (smtpPass) body.smtp_pass = smtpPass;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const text = await response.text();
console.log(response.ok ? `已应用认证配置到 ${ref}（包含 ${TEMPLATE_NAMES.length} 套邮件模板）` : `失败 ${response.status}: ${text.slice(0, 500)}`);

