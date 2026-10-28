// 网页 27 + APK 26.1.0（必更新）。
//
// 为什么这次必须发 APK：MainActivity 的 LocalSiteHandler 加了"无后缀回落"
// （/login → login.html、/site/ → index.html）。网页端现在统一用无后缀地址，
// 旧 APK 不认识，点任何链接都会 404 —— 所以必须强制所有人升到 26.1.0。
import { readFileSync, writeFileSync } from "node:fs";

const file = "version.json";
const v = JSON.parse(readFileSync(file, "utf8"));

v.webVersion = "27";
v.webVersionCode = 27;
v.updatedAt = "2026-10-28T22:05:00+08:00";
v.webNote =
  "网页版本 27：" +
  "① 站内跳转一律省略 .html（/login、/timemachine…），首页收敛成 /，地址栏更简洁；" +
  "App 端同步支持无后缀加载，所以两端行为一致。" +
  "② 顶栏按钮放不下时自动等比缩小，最多缩到 75%，尽量保持一行；缩到 75% 仍不够才换行。" +
  "③ 未登录也能查看公告（点开是只读详情，富文本、图片可放大，无编辑按钮），" +
  "「仅发布者可改」只限制编辑不影响任何人查看。" +
  "④ 个人中心里去掉「发布作业」（右下角按钮菜单已有该入口）。" +
  "⑤ 补上 docs/CNAME（homework.fucku.top）—— 之前仓库里缺这个文件，" +
  "GitHub Pages 下次部署会把自定义域名清掉。README 的在线地址也改为新域名。资源版本号提到 v93。";

v.apkVersion = "26.1.0";
v.apkVersionCode = 260100;
v.apkMandatory = true;
v.apkMandatorySince = 260100;
v.apkNotes =
  "26.1.0（必须更新）：支持从无后缀地址加载页面（/login 自动对应 login.html、" +
  "/site/ 对应 index.html），与网页端新的简洁地址保持一致。" +
  "旧版本不会识别无后缀地址，因此这次设为强制更新 —— 请更新后再使用。";

// 更新源换成新域名：GitHub Pages 已绑定 homework.fucku.top，
// 而旧的 *.github.io 地址会 301 跳过去（多一跳，且 Location 是 http，有混合内容风险）。
v.sources = [
  "https://gh.dpik.top/https://raw.githubusercontent.com/DogOfFurina114514/HomeworkShower/main/docs/",
  "https://gh.llkk.cc/https://raw.githubusercontent.com/DogOfFurina114514/HomeworkShower/main/docs/",
  "https://homework.fucku.top/",
];
v.manifestUrl = "https://homework.fucku.top/manifest.json";

writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
console.log(`web ${v.webVersionCode} | apk ${v.apkVersion} (${v.apkVersionCode}) | 强制起始 ${v.apkMandatorySince}`);
