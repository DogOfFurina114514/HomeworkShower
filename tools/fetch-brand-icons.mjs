/**
 * 品牌图标进底栏。
 *
 * 为什么没直接用你给的文件：
 *   - bilibili.ico 是 32×32 的位图（ICO 容器），改后缀成 .svg 浏览器会当坏图；
 *   - Telegram 那张是 32×32 位图且四周有白边（pcl=fffffa 参数就是描边底色），
 *     位图放大发虚、白边在深色底栏上是一块白斑。
 * 所以这里改走矢量路线：从 simple-icons 取各品牌的轮廓路径，
 * 填上各自的品牌色（不是统一灰），既清晰又保住了辨识度。
 * GitHub 用你提供的路径原文。
 */
import { writeFileSync } from "node:fs";

// 你贴的 GitHub mark 路径原文
const GITHUB_D =
  "M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943";

const BRANDS = [
  { file: "github.svg", slug: null, color: "#181717", label: "GitHub", darkAware: true, d: GITHUB_D },
  { file: "bilibili.svg", slug: "bilibili", color: "#00A1D6", label: "哔哩哔哩", darkAware: false },
  { file: "qq.svg", slug: "tencentqq", color: "#12B7F5", label: "QQ", darkAware: false },
  { file: "telegram.svg", slug: "telegram", color: "#26A5E4", label: "Telegram", darkAware: false },
];

/** "↗ 新标签页打开"的小图标（M3E 精简图标表里没有 open_in_new，只能自带） */
const EXTERNAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Zm-2 16H5V9H3v12h12v-2h-3Z"/></svg>\n';

let ok = 0;
for (const brand of BRANDS) {
  try {
    let d = brand.d;
    if (!d) {
      const url = `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${brand.slug}.svg`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const m = raw.match(/<path[^>]*\sd="([^"]+)"/);
      if (!m) throw new Error("没找到 path");
      d = m[1];
    }
    // 深色底栏下 GitHub 的黑色 cat 几乎看不见 → 加 currentColor 类由 CSS 反白
    const cls = brand.darkAware ? ' class="brand-icon brand-icon--adaptive"' : ' class="brand-icon"';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${brand.label}">` +
      `<path${cls} fill="${brand.color}" d="${d}"/></svg>\n`;
    writeFileSync(`assets/${brand.file}`, svg);
    console.log(`${brand.file.padEnd(14)} ${brand.color} ${svg.length} 字节`);
    ok += 1;
  } catch (error) {
    console.log(`${brand.file.padEnd(14)} ❌ ${error.message}`);
  }
}

writeFileSync("assets/external.svg", EXTERNAL_SVG);
console.log(`external.svg    ${EXTERNAL_SVG.length} 字节`);
console.log(`\n图标 ${ok}/${BRANDS.length}`);
