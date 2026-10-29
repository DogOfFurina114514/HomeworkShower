// 更新 6 个页面的底栏标记：在原有三行下面追加
//   · 开放源代码仓库（带"新标签页"图标）
//   · by DogOfFurina114514
//   · GitHub / B站 / QQ / Telegram 四个品牌图标
//
// 品牌 svg 文件一律不动（作者已换成自己的版本），这里只引用。
// "新标签页"图标用内联 SVG 而不是 <img src>：img 里的 currentColor
// 拿不到页面文字色（会固定成黑色），暗色主题下就看不见了。
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const GNU = "https://www.gnu.org/licenses/agpl-3.0.html";
const REPO = "https://github.com/DogOfFurina114514/HomeworkShower";
const PROFILE = "https://github.com/DogOfFurina114514";

// Material open_in_new
const EXTERNAL =
  '<svg class="license-footer__external" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';

const NEW_BLOCK = `    <footer class="license-footer" id="license-footer">
      <a class="license-footer__badge" href="${GNU}" target="_blank" rel="noopener noreferrer">
        <img src="assets/agplv3.svg" alt="GNU Affero General Public License v3.0" width="155" height="51" />
      </a>
      <p class="license-footer__line">
        Under the <a href="${GNU}" target="_blank" rel="noopener noreferrer">GNU Affero General Public License v3.0</a>
      </p>
      <p class="license-footer__line">
        采用 <a href="${GNU}" target="_blank" rel="noopener noreferrer">AGPL v3.0 协议</a>开源
      </p>
      <p class="license-footer__line">
        <a href="${REPO}" target="_blank" rel="noopener noreferrer">开放源代码仓库${EXTERNAL}</a>
      </p>
      <p class="license-footer__line">by DogOfFurina114514</p>
      <p class="license-footer__social">
        <a href="${PROFILE}" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><img src="assets/github.svg" alt="GitHub" /></a>
        <a href="https://space.bilibili.com/1275382346" target="_blank" rel="noopener noreferrer" aria-label="哔哩哔哩"><img src="assets/bilibili.svg" alt="哔哩哔哩" /></a>
        <a href="https://qm.qq.com/q/pD0PC6tQju" target="_blank" rel="noopener noreferrer" aria-label="QQ"><img src="assets/qq.svg" alt="QQ" /></a>
        <a href="https://t.me/DogOfFurina" target="_blank" rel="noopener noreferrer" aria-label="Telegram"><img src="assets/telegram.svg" alt="Telegram" /></a>
      </p>
    </footer>
`;

const files = ["index.html", "timemachine.html", "publish.html", "security.html", "login.html", "auth.html"];

let done = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf('    <footer class="license-footer"');
  if (start < 0) {
    console.log(`${file}: ⚠ 找不到旧底栏`);
    continue;
  }
  const end = text.indexOf("</footer>", start);
  if (end < 0) {
    console.log(`${file}: ⚠ 底栏没有闭合`);
    continue;
  }
  const replaced = text.slice(0, start) + NEW_BLOCK + text.slice(end + "</footer>".length);
  writeFileSync(file, replaced);
  done += 1;
  console.log(`${file}: 底栏已更新`);
}

// 之前建的 external.svg 不再引用（改成内联），删掉免得进清单占体积
try {
  rmSync("assets/external.svg");
  console.log("已删除 assets/external.svg（改为内联）");
} catch {
  /* 不存在就算了 */
}

console.log(`\n共 ${done}/${files.length} 个页面`);
