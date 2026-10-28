// 给简版 core.js 插入公告功能。
// 简版是给老浏览器/弱设备用的降级版，所以这里一律用原生控件
// （input[type=date] / select / checkbox），不碰 M3E，也不引入富文本工具栏
// —— 但内容用 contenteditable，仍然能存 HTML，与完整版的富文本数据互通。
import { readFileSync, writeFileSync } from "node:fs";

const file = "simple/core.js";
let text = readFileSync(file, "utf8");

if (text.includes("function loadAnnouncements")) {
  console.log("简版已有公告功能，跳过");
  process.exit(0);
}

const BLOCK = `
  /* ---------------------------------------------------------------- 公告栏 */
  //
  // 与完整版共用同一张表与同一套 RPC（list/create/update/delete_announcement），
  // 所以排序（置顶 > 等级 > 最近更新）、过期过滤、内部公告可见性都由后端保证，
  // 这里只负责画出来和提交表单。
  //
  // 控件用原生的：简版的定位就是"老浏览器也能用"，
  // 原生 select / checkbox / date 在这些环境里比任何组件库都可靠。

  var IMPORTANCE_LABELS = { LOW: "低", NORMAL: "普通", MODERATE: "中等", IMPORTANT: "重要" };
  var announcements = [];

  function injectAnnouncementStyle() {
    if (document.getElementById("announcement-style")) return;
    var style = document.createElement("style");
    style.id = "announcement-style";
    style.textContent = [
      ".annbar{margin:16px 20px 0;padding:12px 14px;border:1px solid #bfc8cb;border-radius:14px;background:#eff4f6}",
      ".annbar[hidden]{display:none}",
      ".annbar h3{margin:0 0 10px;font-size:15px;font-weight:600;color:#3f484a}",
      ".annitem{padding:10px 12px;margin:0 0 8px;border:1px solid #d7dee0;border-radius:10px;background:#fff;overflow-wrap:anywhere}",
      ".annitem:last-child{margin-bottom:0}",
      ".annitem.clickable{cursor:pointer}",
      ".annitem.clickable:active{filter:brightness(.97)}",
      ".annitem .anntext{font-size:14px;line-height:1.7;color:#171d1e}",
      ".annitem .anntext img{max-width:min(320px,100%)}",
      ".annmeta{margin-top:6px;font-size:12px;color:#3f484a;display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
      ".anntag{display:inline-flex;padding:1px 8px;border:1px solid #bfc8cb;border-radius:999px;font-size:12px}",
      ".anntag.pin{color:#006877;border-color:#006877}",
      ".anntag.lv-IMPORTANT{color:#7f1d1d;border-color:#f3b4b4;background:#ffe4e6;font-weight:600}",
      ".anntag.lv-MODERATE{color:#7a5900;border-color:#e6c34a;background:#fff3cd}",
      ".anntag.internal{color:#4338ca;border-color:#c7d2fe;background:#eef2ff}",
      ".annitem.pinned{border-left:3px solid #006877}",
      ".annitem.lv-IMPORTANT{border-left:3px solid #ef4444}",
      ".annitem.lv-MODERATE{border-left:3px solid #e6b800}",
      ".annrow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 10px}",
      ".annrow > label{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#3f484a}",
      ".anncontent{min-height:90px;padding:10px 12px;border:1px solid #6f7a7d;border-radius:10px;background:#fff;font-size:14px;line-height:1.6;overflow-wrap:anywhere}",
      ".anndlg .field{display:block;margin:0 0 10px}",
      ".anndlg .field > span{display:block;font-size:13px;color:#3f484a;margin-bottom:4px}",
      ".anndlg select,.anndlg input[type=date]{min-height:38px;padding:6px 10px;border:1px solid #6f7a7d;border-radius:10px;background:#fff;font:inherit;font-size:14px}"
    ].join("");
    document.head.appendChild(style);
  }

  /** 公告栏容器：插在状态条之前；没有公告就整块 hidden */
  function ensureAnnouncementBar() {
    var existing = document.getElementById("announcement-bar");
    if (existing) return existing;
    var bar = document.createElement("section");
    bar.id = "announcement-bar";
    bar.className = "annbar";
    bar.hidden = true;
    bar.innerHTML = "<h3>公告</h3><div id=\\"announcement-list\\"></div>";
    var status = document.getElementById("status");
    if (status && status.parentNode) status.parentNode.insertBefore(bar, status);
    else document.body.insertBefore(bar, document.body.firstChild);
    return bar;
  }

  function loadAnnouncements() {
    injectAnnouncementStyle();
    var bar = ensureAnnouncementBar();
    return api("rpc/list_announcements", { method: "POST", body: {} })
      .then(function (rows) {
        announcements = rows || [];
        renderAnnouncements(bar);
        return announcements;
      })
      .catch(function (error) {
        // 公告读失败不该挡住作业
        if (window.console) console.warn("[简版] 读取公告失败：", error.message);
        announcements = [];
        renderAnnouncements(bar);
        return [];
      });
  }

  function renderAnnouncements(bar) {
    var list = document.getElementById("announcement-list");
    if (!list) return;
    if (!announcements.length) {
      bar.hidden = true;
      list.innerHTML = "";
      return;
    }
    bar.hidden = false;
    list.innerHTML = announcements.map(function (item) {
      var content = item.content_html
        ? item.content_html
        : escapeHtml(item.content || "").replace(/\\n/g, "<br>");
      var tags = [];
      if (item.pinned) tags.push('<span class="anntag pin">置顶</span>');
      tags.push('<span class="anntag lv-' + item.importance + '">' +
        escapeHtml(IMPORTANCE_LABELS[item.importance] || item.importance) + "</span>");
      if (item.internal) tags.push('<span class="anntag internal">内部</span>');
      if (!item.admin_only_edit) tags.push('<span class="anntag">仅发布者可改</span>');
      var expiry = item.never_expires ? "长期有效"
        : item.expires_on ? "截止 " + String(item.expires_on).replace(/-/g, "/") : "";
      var author = item.author_role ? roleLabel(item.author_role) + "发布" : "";
      return '<div class="annitem lv-' + item.importance + (item.pinned ? " pinned" : "") +
        (item.can_edit ? " clickable" : "") + '" data-ann-id="' + item.id + '">' +
        '<div class="anntext">' + content + "</div>" +
        '<div class="annmeta">' + tags.join("") +
        (expiry ? "<span>" + escapeHtml(expiry) + "</span>" : "") +
        (author ? "<span>· " + escapeHtml(author) + "</span>" : "") +
        "</div></div>";
    }).join("");
  }

  function isStrictPublisher() {
    return !!(profile && profile.role === "publisher");
  }

  /** 公告编辑框：新建与修改共用，字段按角色增减 */
  function openAnnouncementDialog(id) {
    if (!canEdit()) return void message("只有发布者和管理员可以发布公告", true);
    var editing = null;
    if (id) {
      for (var i = 0; i < announcements.length; i += 1) {
        if (String(announcements[i].id) === String(id)) { editing = announcements[i]; break; }
      }
      if (!editing) return;
      if (!editing.can_edit) return void message("这条公告只有发布者可改", true);
    }

    var allowCritical = isStrictPublisher() || (editing && editing.importance === "IMPORTANT");
    var levels = ["LOW", "NORMAL", "MODERATE", "IMPORTANT"].map(function (value) {
      var disabled = value === "IMPORTANT" && !allowCritical ? " disabled" : "";
      var 选中 = editing && editing.importance === value ? " selected" : (!editing && value === "NORMAL" ? " selected" : "");
      return '<option value="' + value + '"' + disabled + 选中 + ">" + IMPORTANCE_LABELS[value] + "</option>";
    }).join("");

    var body = '<div class="anndlg">' +
      '<label class="field"><span>重要等级</span><select id="ann-importance">' + levels + "</select></label>" +
      (allowCritical ? "" : '<p class="status" style="margin:0 0 10px">只有发布者可以把公告设为「重要」。</p>') +
      '<div class="annrow">' +
      '<label><input type="checkbox" id="ann-pinned"' + (editing && editing.pinned ? " checked" : "") + " /> 置顶</label>" +
      (isStrictPublisher()
        ? '<label><input type="checkbox" id="ann-admin-edit"' + (!editing || editing.admin_only_edit ? " checked" : "") + " /> 管理员可修改</label>"
        : "") +
      '<label><input type="checkbox" id="ann-internal"' + (editing && editing.internal ? " checked" : "") + " /> 内部（仅管理员与发布者可见）</label>" +
      '<label><input type="checkbox" id="ann-never"' + (editing && editing.never_expires ? " checked" : "") + " /> 永不过期</label>" +
      "</div>" +
      '<label class="field"><span>截止日期</span><input type="date" id="ann-expiry" value="' +
      (editing && editing.expires_on ? String(editing.expires_on).slice(0, 10) : "") + '" /></label>' +
      '<label class="field"><span>内容（支持粘贴带格式的文本）</span>' +
      '<div class="anncontent" id="ann-content" contenteditable="true"></div></label>' +
      "</div>";

    var actions = [{ label: "取消" }];
    if (editing) {
      actions.push({
        label: "删除",
        onClick: function (close) {
          close();
          dialog({
            title: "删除这条公告？",
            body: "<p>删除后不再显示，且无法恢复。</p>",
            actions: [
              { label: "取消" },
              {
                label: "删除",
                primary: true,
                onClick: function (close2) {
                  close2();
                  api("rpc/delete_announcement", { method: "POST", body: { p_id: Number(editing.id) } })
                    .then(function () { message("公告已删除", false); loadAnnouncements(); })
                    .catch(function (error) { message("删除失败：" + error.message, true); });
                }
              }
            ]
          });
        }
      });
    }
    actions.push({
      label: "保存",
      primary: true,
      onClick: function (close) {
        var editor = document.getElementById("ann-content");
        var html = (editor.innerHTML || "").trim();
        var plain = (editor.textContent || "").trim();
        if (!html && !plain) return void message("公告内容不能为空", true);

        var never = document.getElementById("ann-never").checked;
        var expiry = document.getElementById("ann-expiry").value;
        if (!never && !expiry) return void message("请填写截止日期，或勾选「永不过期」", true);

        var adminFlag = document.getElementById("ann-admin-edit");
        var payload = {
          p_content: plain,
          p_content_html: html || null,
          p_importance: document.getElementById("ann-importance").value,
          p_pinned: document.getElementById("ann-pinned").checked,
          p_admin_only_edit: adminFlag ? adminFlag.checked : true,
          p_internal: document.getElementById("ann-internal").checked,
          p_never_expires: never,
          p_expires_on: never ? null : expiry
        };
        var rpc = editing ? "rpc/update_announcement" : "rpc/create_announcement";
        if (editing) payload.p_id = Number(editing.id);

        api(rpc, { method: "POST", body: payload })
          .then(function () {
            close();
            message(editing ? "公告已更新" : "公告已发布", false);
            loadAnnouncements();
          })
          .catch(function (error) { message("保存失败：" + error.message, true); });
      }
    });

    dialog({ title: editing ? "修改公告" : "新建公告", body: body, actions: actions });

    var editor = document.getElementById("ann-content");
    if (editor) {
      editor.innerHTML = editing
        ? (editing.content_html || escapeHtml(editing.content || "").replace(/\\n/g, "<br>"))
        : "";
    }
    // 勾了「永不过期」就把日期框禁掉，避免让人以为还要填
    var neverBox = document.getElementById("ann-never");
    var expiryInput = document.getElementById("ann-expiry");
    if (neverBox && expiryInput) {
      var syncExpiry = function () { expiryInput.disabled = neverBox.checked; };
      neverBox.onchange = syncExpiry;
      syncExpiry();
    }
  }

  /** 公告点击/新建入口的绑定，主界面与时光机共用 */
  function bindAnnouncementBar() {
    var bar = ensureAnnouncementBar();
    bar.onclick = function (event) {
      var row = event.target.closest ? event.target.closest("[data-ann-id]") : null;
      if (!row) return;
      var id = row.getAttribute("data-ann-id");
      var item = null;
      for (var i = 0; i < announcements.length; i += 1) {
        if (String(announcements[i].id) === String(id)) { item = announcements[i]; break; }
      }
      if (!item) return;
      if (!canEdit()) return void message("登录后可以查看公告；发布者与管理员可以维护公告", true);
      if (!item.can_edit) return void message("这条公告只有发布者可改", true);
      openAnnouncementDialog(item.id);
    };
  }

`;

// 插到 pageIndex 之前
const anchor = "  function pageIndex() {";
if (!text.includes(anchor)) throw new Error("找不到 pageIndex 锚点");
text = text.replace(anchor, BLOCK + anchor);

writeFileSync(file, text);
console.log("简版公告功能已插入");
