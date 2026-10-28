// 简版公告对话框：四个选项从原生 checkbox 升级为开关外观；
// 截止日期包进可折叠槽位，并给隐藏/显示加过渡动画。
//
// 简版仍然只用原生控件（input type=checkbox / date），只是加样式 ——
// 与完整版保持同一套观感与同一套交互，不引入任何组件库。
import { readFileSync, writeFileSync } from "node:fs";

const file = "simple/core.js";
let text = readFileSync(file, "utf8");

// ① 选项 → 开关（仍是原生 checkbox，套 .sw 样式）
const OLD_OPTIONS = `      '<div class="annrow">' +
      '<label><input type="checkbox" id="ann-pinned"' + (editing && editing.pinned ? " checked" : "") + " /> 置顶</label>" +
      (isStrictPublisher()
        ? '<label><input type="checkbox" id="ann-admin-edit"' + (!editing || editing.admin_only_edit ? " checked" : "") + " /> 管理员可修改</label>"
        : "") +
      '<label><input type="checkbox" id="ann-internal"' + (editing && editing.internal ? " checked" : "") + " /> 内部（仅管理员与发布者可见）</label>" +
      '<label><input type="checkbox" id="ann-never"' + (editing && editing.never_expires ? " checked" : "") + " /> 永不过期</label>" +
      "</div>" +
      '<label class="field"><span>截止日期</span><input type="date" id="ann-expiry" value="' +
      (editing && editing.expires_on ? String(editing.expires_on).slice(0, 10) : "") + '" /></label>' +`;

const NEW_OPTIONS = `      '<div class="annswitches">' +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-pinned"' + (editing && editing.pinned ? " checked" : "") + ' /><span>置顶</span></label>' +
      (isStrictPublisher()
        ? '<label class="switchitem"><input type="checkbox" class="sw" id="ann-admin-edit"' + (!editing || editing.admin_only_edit ? " checked" : "") + ' /><span>管理员可修改</span></label>'
        : "") +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-internal"' + (editing && editing.internal ? " checked" : "") + ' /><span>内部（仅管理员与发布者可见）</span></label>' +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-never"' + (editing && editing.never_expires ? " checked" : "") + ' /><span>永不过期</span></label>' +
      "</div>" +
      '<div class="anndateslot" id="ann-dateslot"><label class="field"><span>截止日期</span><input type="date" id="ann-expiry" value="' +
      (editing && editing.expires_on ? String(editing.expires_on).slice(0, 10) : "") + '" /></label></div>' +`;

// ② 样式：开关 + 折叠槽
const OLD_STYLE_TAIL = `      ".anndlg select,.anndlg input[type=date]{min-height:38px;padding:6px 10px;border:1px solid #6f7a7d;border-radius:10px;background:#fff;font:inherit;font-size:14px}"
    ].join("");`;

const NEW_STYLE_TAIL = `      ".anndlg select,.anndlg input[type=date]{min-height:38px;padding:6px 10px;border:1px solid #6f7a7d;border-radius:10px;background:#fff;font:inherit;font-size:14px}",
      // 开关：原生 checkbox + appearance:none，语义与键盘操作保持原生
      ".annswitches{display:grid;gap:10px;margin:0 0 12px}",
      ".switchitem{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:#171d1e;user-select:none}",
      ".switchitem input.sw{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:52px;min-width:52px;height:32px;min-height:32px;margin:0;padding:0;border:2px solid #6f7a7d;border-radius:999px;background:#e0e5e7;cursor:pointer;transition:background-color 200ms cubic-bezier(.2,0,0,1),border-color 200ms cubic-bezier(.2,0,0,1)}",
      ".switchitem input.sw::before{content:\\"\\";position:absolute;top:50%;left:6px;width:16px;height:16px;border-radius:50%;background:#6f7a7d;transform:translateY(-50%);transition:left 240ms cubic-bezier(.2,0,0,1),width 240ms cubic-bezier(.2,0,0,1),height 240ms cubic-bezier(.2,0,0,1),background-color 200ms cubic-bezier(.2,0,0,1)}",
      ".switchitem input.sw:checked{border-color:#006877;background:#006877}",
      ".switchitem input.sw:checked::before{left:22px;width:24px;height:24px;background:#fff}",
      ".switchitem input.sw:focus-visible{outline:2px solid #006877;outline-offset:3px}",
      // 截止日期折叠：hidden/display:none 没法过渡，改用 max-height + opacity
      ".anndateslot{overflow:hidden;max-height:120px;opacity:1;transform:translateY(0);transition:max-height 280ms cubic-bezier(.2,0,0,1),opacity 200ms cubic-bezier(.2,0,0,1),transform 280ms cubic-bezier(.2,0,0,1),margin-block-end 280ms cubic-bezier(.2,0,0,1);margin-block-end:10px}",
      ".anndateslot.collapsed{max-height:0;opacity:0;transform:translateY(-8px);margin-block-end:0;pointer-events:none}",
      ".anndateslot.noanim{transition:none}"
    ].join("");`;

// ③ 交互：勾选「永不过期」→ 收起日期槽（带过渡）；打开对话框时直接定位不播动画
const OLD_SYNC = `    // 勾了「永不过期」就把日期框禁掉，避免让人以为还要填
    var neverBox = document.getElementById("ann-never");
    var expiryInput = document.getElementById("ann-expiry");
    if (neverBox && expiryInput) {
      var syncExpiry = function () { expiryInput.disabled = neverBox.checked; };
      neverBox.onchange = syncExpiry;
      syncExpiry();
    }`;

const NEW_SYNC = `    // 勾了「永不过期」就把截止日期平滑收起（不是简单地 disabled/隐藏）
    var neverBox = document.getElementById("ann-never");
    var dateSlot = document.getElementById("ann-dateslot");
    if (neverBox && dateSlot) {
      // 首次按当前状态直接定位，别让人看到"先展开再收起"
      dateSlot.className = "anndateslot noanim" + (neverBox.checked ? " collapsed" : "");
      void dateSlot.offsetHeight;
      dateSlot.className = "anndateslot" + (neverBox.checked ? " collapsed" : "");
      neverBox.onchange = function () {
        if (neverBox.checked) dateSlot.className = "anndateslot collapsed";
        else dateSlot.className = "anndateslot";
      };
    }`;

const edits = [
  ["选项改为开关", OLD_OPTIONS, NEW_OPTIONS],
  ["样式（开关 + 折叠槽）", OLD_STYLE_TAIL, NEW_STYLE_TAIL],
  ["折叠交互", OLD_SYNC, NEW_SYNC],
];

let applied = 0;
for (const [label, from, to] of edits) {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.log(`跳过「${label}」（命中 ${hits} 次）`);
    continue;
  }
  text = text.replace(from, to);
  applied += 1;
  console.log(`已替换：${label}`);
}

writeFileSync(file, text);
console.log(`\n共替换 ${applied} / ${edits.length} 处`);
