// 把 bindRichEditor 从 init() 内部搬到模块层。
//
// 原因：公告的 bindAnnouncementUi() 在模块层调用它，而它被定义在 init() 里面
// （缩进 4）—— 函数声明的作用域只到那个函数结束，模块层够不着，
// 一点「新建公告」就会 ReferenceError。node --check 查不出来。
//
// 它依赖的 client / shrinkImage / setDialogMessage / hs 都在模块层，
// 所以搬出去是安全的。
import { readFileSync, writeFileSync } from "node:fs";

const file = "assets/board.js";
const text = readFileSync(file, "utf8");

const startMarker = "    /**\n     * 给一个对话框绑定富文本工具栏 + 插图。";
const start = text.indexOf(startMarker);
if (start < 0) {
  console.error("找不到 bindRichEditor 的注释起点");
  process.exit(1);
}

// 从 function 行开始，用花括号配平找函数结束
const fnStart = text.indexOf("    function bindRichEditor(", start);
let depth = 0;
let i = text.indexOf("{", fnStart);
let end = -1;
for (; i < text.length; i += 1) {
  if (text[i] === "{") depth += 1;
  else if (text[i] === "}") {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end < 0) { console.error("花括号没配平，放弃"); process.exit(1); }

// 连同前面的注释一起摘出来
const block = text.slice(start, end);
const rest = text.slice(0, start) + text.slice(end);

// 缩进整体减 2，落到模块层
const dedented = block
  .split("\n")
  .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
  .join("\n");

const anchor = "  /* ------------------------------------------------------------- 公告栏 */";
if (!rest.includes(anchor)) { console.error("找不到插入锚点"); process.exit(1); }

const moved = rest.replace(anchor, `${dedented}\n\n${anchor}`);

// 原位置可能留下多余空行，压一下
const cleaned = moved.replace(/\n{4,}/g, "\n\n\n");

writeFileSync(file, cleaned);
console.log(`已把 bindRichEditor（${block.split("\n").length} 行）搬到模块层`);
