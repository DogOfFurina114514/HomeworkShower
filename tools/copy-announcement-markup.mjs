// 把首页(index.html)里的公告栏 + 公告对话框 + 删除确认框，原样复制到时光机页。
// 两页共用 board.js，标记必须一致，手抄容易漏 id。
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("index.html", "utf8");
const dstPath = "timemachine.html";
let dst = readFileSync(dstPath, "utf8");

// ① 截取公告栏 section（从注释到 </section>）
const barStart = src.indexOf("      <!-- 公告栏：每条一行");
const barEnd = src.indexOf("</section>", barStart);
if (barStart < 0 || barEnd < 0) throw new Error("首页找不到公告栏块");
const barBlock = src.slice(barStart, barEnd + "</section>".length);

// ② 截取公告对话框（从注释到 </m3e-dialog>）
const dlgStart = src.indexOf("      <!-- 公告编辑：等级与开关用可点击 chip");
const dlgEnd = src.indexOf("</m3e-dialog>", dlgStart);
if (dlgStart < 0 || dlgEnd < 0) throw new Error("首页找不到公告对话框块");
const dlgBlock = src.slice(dlgStart, dlgEnd + "</m3e-dialog>".length);

// ③ 截取删除确认框
const cnfStart = src.indexOf("      <!-- 删除公告确认");
const cnfEnd = src.indexOf("</m3e-dialog>", cnfStart);
if (cnfStart < 0 || cnfEnd < 0) throw new Error("首页找不到公告删除确认块");
const cnfBlock = src.slice(cnfStart, cnfEnd + "</m3e-dialog>".length);

// 已存在就不重复插入
if (dst.includes('id="announcement-bar"')) {
  console.log("时光机页已有公告栏，跳过");
  process.exit(0);
}

// 公告栏插在状态条之前
const statusAnchor = '      <div class="hs-status-row" id="hs-status-row" hidden>';
if (!dst.includes(statusAnchor)) throw new Error("时光机页找不到状态条锚点");
dst = dst.replace(statusAnchor, `${barBlock}\n\n${statusAnchor}`);

// 两个对话框插在 delete-dialog 之前
const delAnchor = '      <m3e-dialog id="delete-dialog"';
if (!dst.includes(delAnchor)) throw new Error("时光机页找不到 delete-dialog 锚点");
dst = dst.replace(delAnchor, `${dlgBlock}\n\n${cnfBlock}\n\n${delAnchor}`);

writeFileSync(dstPath, dst);
console.log("已把公告栏 + 公告对话框 + 删除确认框复制到 timemachine.html");
