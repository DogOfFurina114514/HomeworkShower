// 在「整个 M3 组件框架」的最底部加许可证底栏。
//
// 放在 </m3e-theme> 之前 —— 这样它继承主题的配色变量，且确实在框架内部的最下方。
// 只在有 m3e-theme 的正式页面加（index / timemachine / publish / security / login / auth）；
// 404 / ban / deleted / unsupport 是降级或异常状态页，不掺这一块。
//
// 吸附行为（"要么整个隐藏、要么滚到底，不许停在中间"）由 client.js 实现，
// 这里只负责结构。
import { readFileSync, writeFileSync } from "node:fs";

const FOOTER = `    <!-- 许可证底栏：只有在滚到底时整块出现，不会半截停在视口里 -->
    <footer class="license-footer" id="license-footer">
      <a class="license-footer__badge" href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
        <img src="assets/agplv3.svg" alt="GNU Affero General Public License v3.0" width="155" height="51" />
      </a>
      <p class="license-footer__line">
        Under the <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU Affero General Public License v3.0</a>
      </p>
      <p class="license-footer__line">
        采用 <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL v3.0 协议</a>开源
      </p>
    </footer>

`;

const files = ["index.html", "timemachine.html", "publish.html", "security.html", "login.html", "auth.html"];

let done = 0;
for (const file of files) {
  let text = readFileSync(file, "utf8");
  if (text.includes('id="license-footer"')) {
    console.log(`${file}: 已有底栏，跳过`);
    continue;
  }
  const anchor = "</m3e-theme>";
  if (!text.includes(anchor)) {
    console.log(`${file}: ⚠ 没有 </m3e-theme>，跳过`);
    continue;
  }
  text = text.replace(anchor, `${FOOTER}${anchor}`);
  writeFileSync(file, text);
  done += 1;
  console.log(`${file}: 已插入底栏`);
}
console.log(`\n共 ${done} 个页面`);
