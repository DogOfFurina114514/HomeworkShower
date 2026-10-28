// 网页版本 23 → 24：新增公告栏。
import { readFileSync, writeFileSync } from "node:fs";

const file = "version.json";
const v = JSON.parse(readFileSync(file, "utf8"));

v.webVersion = "24";
v.webVersionCode = 24;
v.updatedAt = "2026-10-28T21:00:00+08:00";
v.webNote =
  "网页版本 24：新增公告栏。" +
  "① 位置在「XXXX · 共 N 条作业」状态条上方，一个框、每条公告一行，内容过长自动换行；" +
  "支持富文本（加粗/斜体/列表/链接/图片），没有公告时整块自动隐藏。" +
  "② 排序：置顶在最上 → 同置顶/非置顶按重要等级 → 再相同按最近更新（由后端 list_announcements 统一排序）。" +
  "③ 每条公告可设：重要等级（低/普通/中等/重要，界面显示中文）、置顶、管理员可修改、内部（仅管理员与发布者可见，带「内部」标签）、永不过期或指定截止日期。" +
  "④ 权限：发布者与管理员都能发公告；管理员不能把公告设为「重要」（选项不显示，后端 trigger 也拒），" +
  "也没有「管理员可修改」这个选项；发布者可以改这个开关，包括改管理员发的公告。" +
  "「管理员可修改」关掉后，该公告只有发布者能编辑。" +
  "⑤ 编辑入口：右下角按钮菜单新增「新建公告」；「新建作业」图标改为加号，" +
  "「新建公告」沿用原来的剪贴板图标。点公告条目即可编辑，删除需二次确认。" +
  "⑥ 简版（/simple/）同步支持公告栏与新建/编辑，控件用原生的以保证老浏览器可用。资源版本号提到 v90。";

writeFileSync(file, JSON.stringify(v, null, 2) + "\n");
console.log(`已写入 web ${v.webVersionCode}（apk 保持 ${v.apkVersionCode}）`);
