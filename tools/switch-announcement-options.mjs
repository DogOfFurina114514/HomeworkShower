// 公告编辑框：四个选项由 chip 改成开关（原生 checkbox + CSS 样式化）。
// 同时把「截止日期」字段包进一个可折叠的槽位，让隐藏/显示能播过渡动画
// （hidden/display:none 是没法过渡的，必须换成 max-height + opacity）。
import { readFileSync, writeFileSync } from "node:fs";

const OLD_FLAGS = `            <div class="chip-row" id="announcement-flags">
              <button type="button" class="chip-toggle" data-flag="pinned" role="checkbox" aria-checked="false">置顶</button>
              <button type="button" class="chip-toggle" data-flag="admin_only_edit" role="checkbox" aria-checked="true" id="flag-admin-edit">管理员可修改</button>
              <button type="button" class="chip-toggle" data-flag="internal" role="checkbox" aria-checked="false">内部（仅管理员与发布者可见）</button>
              <button type="button" class="chip-toggle" data-flag="never_expires" role="checkbox" aria-checked="false">永不过期</button>
            </div>`;

const NEW_FLAGS = `            <div class="switch-list" id="announcement-flags">
              <label class="switch-item">
                <input type="checkbox" class="switch" data-flag="pinned" />
                <span class="switch-item__text">置顶</span>
              </label>
              <label class="switch-item" id="flag-admin-edit-row">
                <input type="checkbox" class="switch" data-flag="admin_only_edit" id="flag-admin-edit" checked />
                <span class="switch-item__text">管理员可修改</span>
              </label>
              <label class="switch-item">
                <input type="checkbox" class="switch" data-flag="internal" />
                <span class="switch-item__text">内部（仅管理员与发布者可见）</span>
              </label>
              <label class="switch-item">
                <input type="checkbox" class="switch" data-flag="never_expires" />
                <span class="switch-item__text">永不过期</span>
              </label>
            </div>`;

// 截止日期：包一层可折叠槽位
const OLD_EXPIRY = `          <m3e-form-field variant="outlined" id="announcement-expiry-field">
            <label slot="label" for="announcement-expiry-input">截止日期</label>
            <input id="announcement-expiry-input" readonly autocomplete="off" />
            <m3e-icon-button slot="suffix" aria-label="选择截止日期">
              <m3e-icon variant="outlined" name="calendar_today"></m3e-icon>
              <m3e-datepicker-toggle for="announcement-expiry-picker"></m3e-datepicker-toggle>
            </m3e-icon-button>
          </m3e-form-field>`;

const NEW_EXPIRY = `          <div class="ann-expiry-slot" id="ann-expiry-slot">
            <m3e-form-field variant="outlined" id="announcement-expiry-field">
              <label slot="label" for="announcement-expiry-input">截止日期</label>
              <input id="announcement-expiry-input" readonly autocomplete="off" />
              <m3e-icon-button slot="suffix" aria-label="选择截止日期">
                <m3e-icon variant="outlined" name="calendar_today"></m3e-icon>
                <m3e-datepicker-toggle for="announcement-expiry-picker"></m3e-datepicker-toggle>
              </m3e-icon-button>
            </m3e-form-field>
          </div>`;

for (const file of ["index.html", "timemachine.html"]) {
  let text = readFileSync(file, "utf8");
  let changed = 0;

  if (text.includes(OLD_FLAGS)) {
    text = text.replace(OLD_FLAGS, NEW_FLAGS);
    changed += 1;
    console.log(`${file}: 选项已改为开关`);
  } else {
    console.log(`${file}: ⚠ 没找到旧的 chip 选项块（可能已改过）`);
  }

  if (text.includes(OLD_EXPIRY)) {
    text = text.replace(OLD_EXPIRY, NEW_EXPIRY);
    changed += 1;
    console.log(`${file}: 截止日期已包进可折叠槽位`);
  } else {
    console.log(`${file}: ⚠ 没找到旧的截止日期字段（可能已改过）`);
  }

  if (changed) writeFileSync(file, text);
}
