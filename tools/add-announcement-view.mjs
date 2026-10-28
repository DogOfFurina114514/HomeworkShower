// 加"公告详情"只读对话框：未登录 / 无编辑权限时点公告 → 打开它，
// 而不是弹一句"登录后可以查看公告"（内容本来就在页面上，那句话自相矛盾）。
//
// 只读视图的价值：富文本长内容在小屏上需要更大的阅读区域，
// 里面的图片也能点开放大；但没有保存/删除按钮，不涉及任何写权限。
import { readFileSync, writeFileSync } from "node:fs";

const BLOCK = `
      <!-- 公告详情（只读）：未登录或无编辑权限时点公告进来，只给「关闭」 -->
      <m3e-dialog id="announcement-view-dialog" dismissible>
        <m3e-heading slot="header" variant="headline" size="small" level="2">公告</m3e-heading>
        <div class="announcement-view__meta" id="announcement-view-meta"></div>
        <div class="announcement-view" id="announcement-view-body"></div>
        <div slot="actions" end>
          <m3e-button variant="text" id="announcement-view-close">关闭</m3e-button>
        </div>
      </m3e-dialog>
`;

for (const file of ["index.html", "timemachine.html"]) {
  let text = readFileSync(file, "utf8");
  if (text.includes('id="announcement-view-dialog"')) {
    console.log(`${file}: 已有公告详情对话框，跳过`);
    continue;
  }
  const anchor = '      <m3e-dialog id="delete-dialog"';
  if (!text.includes(anchor)) {
    console.log(`${file}: ⚠ 找不到 delete-dialog 锚点`);
    continue;
  }
  text = text.replace(anchor, `${BLOCK}\n${anchor}`);
  writeFileSync(file, text);
  console.log(`${file}: 已插入公告详情对话框`);
}
