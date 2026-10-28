// 网页版本 22 → 23：写清本轮改动（邮件失败通知 + 个人中心弹窗宽度）。
import { readFileSync, writeFileSync } from "node:fs";

const file = "version.json";
const v = JSON.parse(readFileSync(file, "utf8"));

v.webVersion = "23";
v.webVersionCode = 23;
v.updatedAt = "2026-10-28T19:05:00+08:00";
v.webNote =
  "网页版本 23：" +
  "① 邮件发送失败现在会通知了 —— 之前是静默的：收件人邮箱没配置、地址无效（缺 @ 或缺域名点号）、" +
  "或设备上根本没有能处理 mailto 的应用时，点了「打开电子邮件」什么都不会发生，只会以为按钮坏了。" +
  "现在这三类都会明确提示；后端返回的英文错误（no MX records / Mailbox unavailable / Rate limit 等）" +
  "也统一翻译成可行动的中文，其中邮箱解析失败会直说「可能是邮箱不存在或地址拼写有误」。" +
  "涉及申请管理员、邮箱不可用申诉、改邮箱、改密码、注销验证与通知邮件等全部入口。" +
  "② 注销说明页补上「通知邮件没发出去」的提示（原来只写进 console，用户不知道，" +
  "会一直等一封不会来的邮件而错过 3 天反悔窗口），并修掉一处顺序错误：读取 admin-mail 元素早于它被创建，" +
  "脚本在那里抛异常，导致「联系管理员」的 mailto 链接从来没被设置成功。" +
  "③ 手机端「个人中心」弹窗不再过窄 —— 上一轮为防溢出写了 min-width:0，" +
  "结果绝对定位的 shrink-to-fit 让弹窗塌到 122px、邮箱被迫折行。" +
  "现在改成 min(320px, 100vw - 28px)：放得下就是 320px，放不下才收缩，实测 320/360/390 均不溢出。" +
  "④ 顶栏控件换行后改为靠右（原来会左对齐、右侧空出一条）。资源版本号提到 v89。";

writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
console.log(`已写入：web ${v.webVersionCode} / apk ${v.apkVersionCode}`);
