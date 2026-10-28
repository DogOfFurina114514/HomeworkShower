// README 里的在线地址从 GitHub Pages 换成自定义域名 https://homework.fucku.top
//
// 只改"用户该访问的地址"，不动这两类：
//   1. github.com/belugaQAQ/StickyHomeworks2-tauri —— 上游原项目仓库
//   2. appassets.androidplatform.net/assets/site/... —— App 内部 WebView 地址
import { readFileSync, writeFileSync } from "node:fs";

const NEW = "https://homework.fucku.top";
const OLD = "https://dogoffurina114514.github.io/HomeworkShower";

const files = ["README.md", "mobile/README.md"];

for (const file of files) {
  let text = readFileSync(file, "utf8");
  const before = (text.match(/dogoffurina114514\.github\.io/g) || []).length;
  if (before === 0) {
    console.log(`${file}: 没有旧域名，跳过`);
    continue;
  }
  // 带结尾斜杠的整站地址，以及具体的 auth.html
  text = text.split(`${OLD}/auth.html`).join(`${NEW}/auth.html`);
  text = text.split(`${OLD}/**`).join(`${NEW}/**`);
  text = text.split(OLD).join(NEW);
  const after = (text.match(/dogoffurina114514\.github\.io/g) || []).length;
  writeFileSync(file, text);
  console.log(`${file}: 替换 ${before} 处旧域名 → ${NEW}（剩余 ${after}）`);
}
