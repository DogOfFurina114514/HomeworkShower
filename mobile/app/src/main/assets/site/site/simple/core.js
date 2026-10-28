/*
 * 简版（低版本浏览器）唯一实现文件 —— 重建版
 *
 *   - 不依赖任何库：ES5 + fetch，兼容 iOS 12 / 老 Chrome；
 *   - 与完整版共用同一份登录态（同一 localStorage 键，格式与 supabase-js 一致）；
 *   - 图标全部自绘内联 SVG，不用 emoji、不引图标字体；
 *   - 样式由本文件注入；页面外壳只需 <script src="core.js"> + hsSimple.render("页面名")。
 *
 * 页面名：index / timemachine / login / publish / auth
 */
(function () {
  var config = window.HOMEWORK_SHOWER_CONFIG || {};
  var STORAGE_KEY = config.authStorageKey || "homeworkshower.auth.v1";
  /** 站点状态页（与完整版顶栏「网站状态」按钮指向同一地址），新标签页打开 */
  var STATUS_PAGE_URL = "https://statuspage.flashcat.cloud/homeworkshower";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayString() {
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  function formatDate(value) {
    var parts = String(value).split("-");
    return parts[0] + " 年 " + Number(parts[1]) + " 月 " + Number(parts[2]) + " 日";
  }

  function isExpired(due) { return due ? String(due) < todayString() : false; }
  // 一整行是否过期 = 发布者显式作废 或 期限已过（与后端 RLS can_edit_homework 一致）
  function isRowExpired(row) { return !row ? false : (!!row.expired || isExpired(row.due_date)); }

  /* ---------------------------------------------------------- 自绘图标 */

  var ICONS = {
    pencil: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    upload: "M12 2 8 6h3v8h2V6h3l-4-4zM5 12H3v8a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-8h-2v7H5v-7z",
    export: "M12 2 8 6h3v8h2V6h3l-4-4zM5 12H3v8a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-8h-2v7H5v-7z",
    clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11H7v-2h4V6h2v7z",
    account: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-8 2-8 4v2h16v-2c0-2-4-4-8-4z",
    calendar: "M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v9H5v-9h14z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z",
    trash: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    warn: "M12 3 L2 20 L22 20 Z M11 9 L13 9 L13 14 L11 14 Z M11 16 L13 16 L13 18 L11 18 Z",
    block: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM5.7 7.1l11.2 11.2A8 8 0 0 1 5.7 7.1zm1.4-1.4a8 8 0 0 1 11.2 11.2L7.1 5.7z",
    back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z",
    // 网站状态：圆形勾（与完整版顶栏按钮图标一致）
    status: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-3.6-3.6 1.4-1.4 2.2 2.2 5-5 1.4 1.4-6.4 6.4Z",
    // 公告：剪贴板（完整版用 M3E 的 assignment，简版自带一份等价图形）
    note: "M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 16H5V5h2v3h10V5h2v14z"
  };

  function icon(name, size) {
    var path = ICONS[name];
    if (!path) return "";
    var edge = size || 20;
    return '<svg class="ic" viewBox="0 0 24 24" width="' + edge + '" height="' + edge +
      '" aria-hidden="true" focusable="false"><path fill="currentColor" d="' + path + '"/></svg>';
  }

  /* ---------------------------------------------------------- 登录态 */

  var profile = null;

  function session() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var token = parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token);
      var user = parsed.user || (parsed.currentSession && parsed.currentSession.user);
      if (!token || !user) return null;
      return {
        accessToken: token,
        userId: user.id,
        email: user.email,
        role: profile && profile.id === user.id ? profile.role : "user",
        banned: !!(profile && profile.id === user.id && profile.banned)
      };
    } catch (error) {
      return null;
    }
  }

  function saveSession(data) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || "bearer",
        expires_in: data.expires_in,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: data.user
      }));
    } catch (error) {}
  }

  function refreshProfile() {
    var current = session();
    if (!current) {
      profile = null;
      return Promise.resolve(null);
    }
    return fetch(config.supabaseUrl + "/rest/v1/profiles?select=id,role,banned,deletion_requested_at,deleted_at&id=eq." + current.userId, {
      headers: { apikey: config.supabaseKey, Authorization: "Bearer " + current.accessToken }
    })
      .then(function (response) {
        if (!response.ok) return null; // 读失败：身份未知，别拿假身份覆盖
        return response.json();
      })
      .then(function (rows) {
        if (!rows) return profile; // 请求失败：保留上一次已知的角色
        // rows 为空数组才算"确实没有这条 profile"，这时兜底成 user 是对的
        profile = rows[0] || { id: current.userId, role: "user", banned: false, deletion_requested_at: null, deleted_at: null };
        return profile;
      })
      .catch(function () { return profile; });
  }

  function isPublisher() { return !!(profile && profile.role === "publisher" && !profile.banned); }
  function canEdit() { return !!(profile && (profile.role === "publisher" || profile.role === "admin") && !profile.banned); }
  function roleLabel(role) { return { publisher: "发布者", admin: "管理员", user: "用户" }[role] || "用户"; }

  /* ---------------------------------------------------------- 数据访问 */

  function readError(text, status) {
    try {
      var parsed = JSON.parse(text);
      return parsed.message || parsed.error_description || parsed.error || "HTTP " + status;
    } catch (error) {
      return text || "HTTP " + status;
    }
  }

  function api(path, options) {
    options = options || {};
    var current = session();
    var token = options.token || (current && current.accessToken) || config.supabaseKey;
    return fetch(config.supabaseUrl + "/rest/v1/" + path, {
      method: options.method || "GET",
      headers: {
        apikey: config.supabaseKey,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error(readError(text, response.status));
        return text ? JSON.parse(text) : null;
      });
    });
  }

  function login(email, password) {
    return fetch(config.supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error(readError(text, response.status));
        saveSession(JSON.parse(text));
        return refreshProfile();
      });
    });
  }

  function signUp(email, password) {
    return fetch(config.supabaseUrl + "/auth/v1/signup", {
      method: "POST",
      headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error(readError(text, response.status));
        return JSON.parse(text);
      });
    });
  }

  /* ---------------------------------------------------------- 样式注入 */

  var CSS = [
    "*{box-sizing:border-box}",
    "body{margin:0;background:#f5fafc;color:#171d1e;font-family:'PingFang SC','HarmonyOS Sans SC','Microsoft YaHei',-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;-webkit-text-size-adjust:100%}",
    ".ic{display:inline-block;vertical-align:middle;flex:0 0 auto}",
    ".lowbar{position:sticky;top:0;z-index:50;padding:10px 16px;background:#ffdad6;color:#410002;border-bottom:1px solid #ba1a1a;font-size:13px;line-height:1.6}",
    ".lowbar a{color:#410002;font-weight:600;white-space:nowrap}",
    ".topbar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 20px;background:#f5fafc;border-bottom:1px solid #bfc8cb}",
    ".topbar h1{flex:1 1 auto;margin:0;font-size:22px;font-weight:500}",
    ".controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
    ".pill{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 18px;border:0;border-radius:20px;background:#cde7ed;color:#0b3c46;font:inherit;font-size:15px;cursor:pointer;text-decoration:none}",
    ".pill.primary{background:#006877;color:#fff}",
    ".pill.text{background:transparent;color:#006877;padding:8px 12px}",
    ".pill:active{filter:brightness(.94)}",
    ".datewrap{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border:1px solid #6f797b;border-radius:20px;background:#eff4f6}",
    ".datewrap span{font-size:13px;color:#3f484a;white-space:nowrap}",
    ".datewrap input{border:0;background:transparent;font:inherit;font-size:15px;color:#171d1e;padding:6px 0}",
    ".banner{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 20px;background:#ffdad6;color:#410002;border-bottom:1px solid #ba1a1a;font-size:14px}",
    ".banner span{flex:1 1 200px}",
    ".status{margin:16px 20px 0;padding:10px 14px;border:1px solid #bfc8cb;border-radius:12px;background:#eff4f6;color:#3f484a;font-size:14px}",
    ".status.error{border-color:#ba1a1a;color:#ba1a1a}",
    /* 错误红条 + 右侧「前往状态页」按钮的横排布局（仅数据访问失败时启用） */
    ".status--with-link{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
    ".status--with-link .status__text{flex:1 1 auto;min-width:0}",
    ".status__link{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;background:#ba1a1a;color:#fff;font-size:13px;text-decoration:none;white-space:nowrap;flex:0 0 auto}",
    ".status__link:active{filter:brightness(.94)}",
    /* 卡片内的状态条，需要去掉默认外边距（避免和卡片里的其它字段打架） */
    ".card .status{margin:0 0 12px}",
    "main.board{padding:24px 20px 96px}",
    ".cols{display:flex;align-items:flex-start;gap:8px}",
    ".col{flex:1 1 0;min-width:0}",
    ".group{margin:0 0 36px}",
    ".group h2{margin:0 0 10px;font-size:19px;font-weight:500}",
    ".item{position:relative;margin:0 0 2px;padding:12px 14px 12px 28px;border-radius:12px;background:#eff4f6;font-size:17px;line-height:1.55;word-break:break-word;transition:background-color .2s ease-out,box-shadow .2s ease-out}",
    ".item:before{content:'';position:absolute;left:13px;top:22px;width:6px;height:6px;border-radius:50%;background:#006877}",
    ".item.expired{color:#ba1a1a}",
    ".item.expired:before{background:#ba1a1a}",
    ".item.clickable{cursor:pointer}",
    ".item.selected{background:#cde7ed;box-shadow:0 2px 10px rgba(0,0,0,.12)}",
    ".item img{max-width:100%;height:auto;border-radius:8px}",
    ".tags{display:block;margin-top:6px}",
    ".tag{display:inline-block;margin:0 4px 4px 0;padding:2px 10px;border:1px solid #bfc8cb;border-radius:999px;font-size:12px;color:#3f484a}",
    ".actions{display:flex;justify-content:flex-end;gap:2px;max-height:0;overflow:hidden;opacity:0;transition:max-height .24s cubic-bezier(.5,1,.89,1),opacity .18s cubic-bezier(.5,1,.89,1)}",
    ".item.selected .actions{max-height:64px;opacity:1}",
    ".empty{padding:64px 20px;text-align:center;color:#3f484a;font-size:17px}",
    ".fab{position:fixed;right:24px;bottom:24px;z-index:30;width:60px;height:60px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:18px;background:#006877;color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.24);transition:transform .2s cubic-bezier(.5,1,.89,1)}",
    ".fab:active{transform:scale(.94)}",
    ".fabmenu{position:fixed;right:24px;bottom:96px;z-index:31;display:none;min-width:180px;padding:8px;border-radius:16px;background:#e3e9eb;box-shadow:0 8px 24px rgba(0,0,0,.24)}",
    ".fabmenu.open{display:block}",
    ".fabmenu button{display:flex;align-items:center;gap:8px;width:100%;padding:12px 14px;border:0;border-radius:12px;background:transparent;color:#171d1e;font:inherit;font-size:15px;text-align:left;cursor:pointer}",
    ".fabmenu button:active{background:#cdd3d6}",
    ".backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:60;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.32)}",
    ".backdrop.open{display:flex}",
    ".dialog{width:100%;max-width:430px;max-height:86vh;overflow:auto;padding:22px;border-radius:28px;background:#e3e9eb;box-shadow:0 12px 32px rgba(0,0,0,.3)}",
    ".dialog h3{margin:0 0 12px;font-size:21px;font-weight:500}",
    ".dialog p{margin:0 0 12px;font-size:15px;color:#3f484a;word-break:break-word}",
    ".dialogactions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}",
    ".field{display:block;margin:0 0 14px}",
    ".field>span{display:block;margin-bottom:6px;font-size:13px;color:#3f484a}",
    ".field input,.field textarea{width:100%;min-height:44px;padding:10px 14px;border:1px solid #6f797b;border-radius:10px;background:#eff4f6;color:#171d1e;font:inherit;font-size:16px}",
    ".field textarea{min-height:150px;resize:vertical;font-size:14px}",
    ".card{max-width:460px;margin:24px auto;padding:24px;border:1px solid #bfc8cb;border-radius:24px;background:#eff4f6}",
    ".card h2{margin:0 0 14px;font-size:22px;font-weight:500}",
    ".card h2:not(:first-child){margin-top:22px}",
    ".tabs{display:flex;gap:8px;margin:0 0 12px}.tabs .pill{flex:1;justify-content:center}",
    "@media(max-width:700px){.cols{display:block}.topbar{padding:10px 14px}}"
  ].join("");

  /** 记住当前视图（简版/完整版），方便用户从另一种视图调回来 */
  function rememberView() {
    try {
      document.cookie = "hs_view=simple; path=/; max-age=31536000";
    } catch (error) {}
  }

  function injectStyle() {
    if ($("hs-simple-style")) return;
    var style = document.createElement("style");
    style.id = "hs-simple-style";
    style.appendChild(document.createTextNode(CSS));
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------- 通用组件 */

  function lowBar() {
    var parts = location.pathname.split("/").filter(function (item) { return !!item; });
    var base = "/" + (parts[0] || "") + "/";
    var name = parts[parts.length - 1] || "index.html";
    var bar = document.createElement("div");
    bar.className = "lowbar";
    bar.innerHTML = icon("warn", 16) +
      " <b>你的浏览器版本过低</b>，当前是简版页面（功能与控件位置与完整版一致）。" +
      ' <a href="' + base + name + '">重试完整版</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function topbar(options) {
    options = options || {};
    var current = session();
    var html = '<header class="topbar"><h1>' + escapeHtml(options.title || config.siteName || "作业") +
      '</h1><div class="controls">';
    // 网站状态：全局入口，所有页面都显示（除非显式传 hideStatus: true），放在最左，新标签页打开
    if (!options.hideStatus) {
      html += '<a class="pill" href="' + STATUS_PAGE_URL + '" target="_blank" rel="noopener">' +
        icon("status", 18) + "网站状态</a>";
    }
    if (options.datePicker) {
      html += '<label class="datewrap">' + icon("calendar", 18) + "<span>发布日期</span>" +
        '<input type="date" id="date-picker" /></label>';
    }
    if (options.back) {
      html += '<a class="pill text" href="' + options.back + '">' + icon("back", 18) + "回到今天</a>";
    }
    // 通用返回入口（登录页等）：文案可自定义，默认回主页
    if (options.backLink) {
      html += '<a class="pill text" href="' + options.backLink + '">' + icon("back", 18) +
        escapeHtml(options.backLabel || "返回") + "</a>";
    }
    if (options.showTimemachine) {
      html += '<a class="pill" href="timemachine.html">' + icon("clock", 18) + "时光机</a>";
    }
    if (!options.hideAccount) {
      html += '<a class="pill" id="account-button" href="login.html">' + icon("account", 18) +
        '<span id="account-label">' + (current ? "个人中心" : "登录") + "</span></a>";
    }
    html += "</div></header>";
    var host = $("topbar-host");
    if (host) host.innerHTML = html;
    else document.body.insertAdjacentHTML("afterbegin", html);
    return current;
  }

  function fab(onExport) {
    var html = '<div class="fabmenu" id="fab-menu">' +
      (canEdit() ? '<button type="button" id="menu-announcement">' + icon("note", 18) + "新建公告</button>" : "") +
      (isPublisher() ? '<button type="button" id="menu-publish">' + icon("upload", 18) + "发布作业</button>" : "") +
      '<button type="button" id="menu-export">' + icon("export", 18) + "导出作业</button></div>" +
      '<button class="fab" id="fab" aria-label="编辑">' + icon("pencil", 26) + "</button>";
    document.body.insertAdjacentHTML("beforeend", html);
    $("fab").onclick = function () {
      var menu = $("fab-menu");
      menu.className = menu.className.indexOf("open") >= 0 ? "fabmenu" : "fabmenu open";
    };
    if ($("menu-announcement")) $("menu-announcement").onclick = function () { openAnnouncementDialog(); };
    if ($("menu-publish")) $("menu-publish").onclick = function () { location.href = "publish.html"; };
    $("menu-export").onclick = onExport || function () {};
  }

  function dialog(options) {
    var backdrop = document.createElement("div");
    backdrop.className = "backdrop open";
    var buttons = (options.actions || []).map(function (action, index) {
      return '<button class="pill ' + (action.primary ? "primary" : "text") + '" data-i="' + index + '">' +
        escapeHtml(action.label) + "</button>";
    }).join("");
    backdrop.innerHTML = '<div class="dialog"><h3>' + escapeHtml(options.title) + "</h3>" +
      (options.body || "") + '<div class="dialogactions">' + buttons + "</div></div>";
    document.body.appendChild(backdrop);

    function close() {
      if (backdrop.parentNode) document.body.removeChild(backdrop);
      if (options.onClose) options.onClose();
    }
    Array.prototype.forEach.call(backdrop.querySelectorAll("[data-i]"), function (node) {
      node.onclick = function () {
        var action = options.actions[Number(node.getAttribute("data-i"))];
        if (action && action.onClick) action.onClick(close);
        else close();
      };
    });
    backdrop.onclick = function (event) { if (event.target === backdrop) close(); };
    return close;
  }

  /**
   * 显示状态消息。
   * 当且仅当是「数据访问失败」类错误时，在右侧挂一个「前往状态页」按钮。
   * 前端校验类错误（密码 / 邮箱 / 输入格式 / JSON 解析等）不挂。
   */
  /**
   * 唤起邮件应用，并把"到底有没有走成"告诉用户。
   *
   * 原来两处都是直接 location.href = mailto:...，失败时完全静默：
   * 收件人地址没配、格式不对、或设备上根本没有能处理 mailto 的应用时，
   * 点了「打开电子邮件」什么都不会发生，用户只会以为按钮坏了。
   *
   * 检测办法：成功唤起邮件应用时页面会切到后台（visibilitychange → hidden）；
   * 若一段时间内还在前台，就认为没打开。不用 iframe 探针 —— 那样可能唤起两次。
   * 简版不加载 client.js，所以这里自带一份（与 hs.openMailto 同逻辑）。
   */
  function openMailto(to, subject, body) {
    var address = String(to || "").trim();
    if (!address) {
      message("还没有配置收件人邮箱，请联系站点管理员", true);
      return false;
    }
    // 明显不是邮箱地址（缺 @、缺域名点号）直接说清楚，
    // 免得用户以为"邮件发出去了"而其实根本没打开编辑器。
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      message("收件人邮箱地址无效（" + address + "），可能是邮箱不存在或地址拼写有误", true);
      return false;
    }
    var url = "mailto:" + address +
      "?subject=" + encodeURIComponent(subject || "") +
      "&body=" + encodeURIComponent(body || "");

    var left = false;
    var onHide = function () {
      if (document.visibilityState === "hidden") { left = true; cleanup(); }
    };
    var cleanup = function () {
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onHide);
    var timer = window.setTimeout(function () {
      cleanup();
      if (!left) message("没能打开邮件应用：设备上可能没有安装邮件客户端", true);
    }, 2000);

    location.href = url;
    return true;
  }

  function message(text, isError) {
    var el = $("status");
    if (!el) return;
    var t = String(text === null || text === undefined ? "" : text);
    var looksLikeBackendFailure =
      /(失败|加载|读取|发布|保存|删除|发送|提交|登录|注册)/.test(t) &&
      !/(密码|邮箱格式|请填写|请选择|原样输入|不一致|JSON\s*解析)/.test(t);
    var wantLink = !!isError && looksLikeBackendFailure;

    if (wantLink) {
      el.innerHTML =
        '<span class="status__text">' + escapeHtml(text) + "</span>" +
        '<a class="status__link" href="' + STATUS_PAGE_URL + '" target="_blank" rel="noopener">' +
        "前往状态页</a>";
      el.className = "status error status--with-link";
    } else {
      el.innerHTML = escapeHtml(text);
      el.className = isError ? "status error" : "status";
    }
  }

  function renderBoard(rows, options) {
    options = options || {};
    var board = $("board");
    if (!board) return;
    if (!rows.length) {
      board.innerHTML = '<p class="empty">' + escapeHtml(options.emptyText || "没有作业") + "</p>";
      return;
    }
    var groups = [];
    var index = {};
    rows.forEach(function (row) {
      var subject = String(row.subject || "其它").replace(/^\s+|\s+$/g, "") || "其它";
      if (!index[subject]) {
        index[subject] = { subject: subject, items: [] };
        groups.push(index[subject]);
      }
      index[subject].items.push(row);
    });

    var columns = Math.max(1, Math.min(groups.length, Math.floor((board.clientWidth || 1024) / 358) || 1));
    var buckets = [];
    for (var i = 0; i < columns; i += 1) buckets.push([]);
    groups.forEach(function (group, position) { buckets[position % columns].push(group); });

    board.innerHTML = '<div class="cols">' + buckets.map(function (bucket) {
      return '<div class="col">' + bucket.map(function (group) {
        return '<section class="group"><h2>' + escapeHtml(group.subject) + "</h2>" +
          group.items.map(function (item) {
            var expired = isRowExpired(item);
            var editable = !!options.canManage && !expired;
            var selected = options.selectedId && String(options.selectedId) === String(item.id);
            var content = item.content_html ? item.content_html : escapeHtml(item.content).replace(/\n/g, "<br>");
            var tags = (item.tags || []).length ? '<span class="tags">' + item.tags.map(function (tag) {
              return '<span class="tag">' + escapeHtml(tag) + "</span>";
            }).join("") + "</span>" : "";
            var actions = editable ? '<span class="actions">' +
              '<button class="pill text" data-edit="' + item.id + '">' + icon("edit", 18) + "修改</button>" +
              '<button class="pill text" data-delete="' + item.id + '">' + icon("trash", 18) + "删除</button></span>" : "";
            return '<div class="item' + (expired ? " expired" : "") + (selected ? " selected" : "") +
              (editable ? " clickable" : "") + '" data-id="' + item.id + '">' + content + tags + actions + "</div>";
          }).join("") + "</section>";
      }).join("") + "</div>";
    }).join("") + "</div>";
  }

  /** 个人中心：所有简版页面共用；发布者额外有「管理用户」 */
  function bindAccount() {
    var button = $("account-button");
    if (!button || !session()) return;
    $("account-label").innerHTML = "个人中心";
    button.setAttribute("href", "#");
    button.onclick = function (event) {
      event.preventDefault();
      var actions = [];
      actions.push({
        label: "安全中心",
        onClick: function (close) {
          close();
          location.href = "security.html";
        }
      });
      if (isPublisher()) {
        actions.push({
          label: "管理用户",
          onClick: function (close) {
            close();
            manageUsers();
          }
        });
      }
      actions.push({
        label: "退出登录",
        onClick: function (close) {
          close();
          try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
          location.href = "login.html";
        }
      });
      actions.push({ label: "关闭", primary: true });
      dialog({
        title: "个人中心",
        body: "<p>当前身份：<b>" + roleLabel(profile ? profile.role : "user") + "</b><br>" +
          escapeHtml((session() || {}).email || "") + "</p>",
        actions: actions
      });
    };
  }

  /** 管理用户（仅发布者）：设/撤管理员、封禁/解封 */
  function manageUsers() {
    var close = dialog({ title: "管理用户", body: '<p class="status" id="users-status">正在加载…</p><div class="list" id="users"></div>', actions: [] });

    function paint() {
      api("rpc/admin_list_users", { method: "POST", body: {} })
        .then(function (users) {
          var box = $("users");
          if (!box) return;
          if (!users || !users.length) return void (box.innerHTML = "<p>还没有其他用户。</p>");
          box.innerHTML = users.map(function (user) {
            var locked = user.role === "publisher";
            return '<div class="userrow"><div class="who"><strong>' + escapeHtml(user.email || "（无邮箱）") +
              '</strong><span class="chip">' + roleLabel(user.role) + (user.banned ? " · 已封禁" : "") + "</span></div>" +
              (locked ? "<span>不可修改</span>" : '<div class="dialogactions">' +
                '<button class="pill text" data-role="' + user.id + '" data-next="' + (user.role === "admin" ? "user" : "admin") + '">' +
                (user.role === "admin" ? "移除管理员" : "设为管理员") + "</button>" +
                '<button class="pill text" data-ban="' + user.id + '" data-next="' + (user.banned ? "false" : "true") + '">' +
                (user.banned ? "解封" : "封禁") + "</button></div>") + "</div>";
          }).join("");
          Array.prototype.forEach.call(box.querySelectorAll("[data-role],[data-ban]"), function (node) {
            node.onclick = function () {
              var asRole = node.getAttribute("data-role");
              var promise = asRole
                ? api("rpc/admin_set_role", { method: "POST", body: { p_user_id: asRole, p_role: node.getAttribute("data-next") } })
                : api("rpc/admin_set_banned", { method: "POST", body: { p_user_id: node.getAttribute("data-ban"), p_banned: node.getAttribute("data-next") === "true" } });
              promise.then(function () { paint(); }).catch(function (error) {
                var status = $("users-status");
                if (status) { status.className = "status error"; status.innerHTML = escapeHtml(error.message); }
              });
            };
          });
          close();
          dialog({ title: "管理用户", body: box.outerHTML, actions: [{ label: "关闭", primary: true }] });
        })
        .catch(function (error) {
          var status = $("users-status");
          if (status) { status.className = "status error"; status.innerHTML = escapeHtml(error.message); }
        });
    }
    paint();
  }
  /* ---------------------------------------------------------- 页面：看板 */


  /* ------------------------------------------------------------------
   *  看板共享状态与动作
   *
   *  提到模块作用域的原因：主界面（pageIndex）和时光机（pageTimemachine）现在
   *  共用同一套「点击卡片 → 选中/修改/删除」，时光机也能改未过期的作业。
   *  这几个函数只依赖模块级的 api/renderBoard/message/dialog/config，搬出来是安全的。
   * ------------------------------------------------------------------ */
    var rows = [];
    var selectedId = null;
    var currentDate = "";
    var manage = false;

    function exportJson() {
      var subjects = [];
      var index = {};
      rows.forEach(function (row) {
        var subject = row.subject || "其它";
        if (!index[subject]) {
          index[subject] = { subject: subject, homeworks: [] };
          subjects.push(index[subject]);
        }
        index[subject].homeworks.push({
          content: row.content,
          contentHtml: row.content_html,
          tags: row.tags || [],
          dueDate: row.due_date
        });
      });
      var blob = new Blob([JSON.stringify({ format: "stickyhomeworks2.homeworks", publishedOn: currentDate, subjects: subjects }, null, 2)], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "作业-" + (currentDate || "latest") + ".json";
      link.click();
    }

    function loadDay(date) {
      message("正在加载…");
      api("homeworks?select=id,subject,content,content_html,tags,due_date,expired,sort_order&published_on=eq." + date + "&order=subject.asc,sort_order.asc")
        .then(function (data) {
          rows = data;
          // 权限只看角色，过不过期是逐条判定的
          manage = canEdit();
          message(formatDate(date) + " · 共 " + rows.length + " 条作业" + (manage ? " · 点击作业可修改或删除" : ""));
          renderBoard(rows, { canManage: manage, selectedId: selectedId, emptyText: "今天没有需要做的作业" });
        })
        .catch(function (error) { message("加载失败：" + error.message, true); });
    }

    function findRow(id) {
      for (var i = 0; i < rows.length; i += 1) if (String(rows[i].id) === String(id)) return rows[i];
      return null;
    }

    function editItem(id) {
      if (!manage) return void message("你的修改权限已被撤销", true);
      var row = findRow(id);
      if (!row) return;
      dialog({
        title: "修改作业",
        body: '<label class="field"><span>科目</span><input id="edit-subject" value="' + escapeHtml(row.subject || "") + '" /></label>' +
          '<label class="field"><span>期限（年-月-日）</span><input id="edit-due" value="' + escapeHtml(row.due_date || "") + '" /></label>' +
          '<label class="field"><span>标签（逗号分隔）</span><input id="edit-tags" value="' + escapeHtml((row.tags || []).join(", ")) + '" /></label>' +
          '<label class="field"><span>内容（纯文本）</span><textarea id="edit-content">' + escapeHtml(row.content || "") + "</textarea></label>",
        actions: [
          { label: "取消" },
          {
            label: "保存",
            primary: true,
            onClick: function (close) {
              var due = $("edit-due").value;
              var tags = $("edit-tags").value.split(",").map(function (tag) {
                return tag.replace(/^\s+|\s+$/g, "");
              }).filter(function (tag) { return !!tag; });
              api("homeworks?id=eq." + id, {
                method: "PATCH",
                body: {
                  subject: $("edit-subject").value || "其它",
                  content: $("edit-content").value,
                  content_html: null,
                  tags: tags,
                  due_date: due || null,
                  due_time: due ? due + "T00:00:00" : null
                }
              }).then(function () { close(); loadDay(currentDate); })
                .catch(function (error) { message("保存失败：" + error.message, true); });
            }
          }
        ]
      });
    }

    function deleteItem(id) {
      if (!manage) return void message("你的修改权限已被撤销", true);
      dialog({
        title: "删除这条作业？",
        body: "<p>删除后无法恢复。只有未过期的作业可以修改或删除。</p>",
        actions: [
          { label: "取消" },
          {
            label: "删除",
            primary: true,
            onClick: function (close) {
              api("homeworks?id=eq." + id, { method: "DELETE" })
                .then(function () { close(); loadDay(currentDate); })
                .catch(function (error) { message("删除失败：" + error.message, true); });
            }
          }
        ]
      });
    }

    /** 作业卡片的点击/选中/编辑入口。主界面和时光机共用同一套（时光机现在也能改未过期的作业）。 */
    function bindBoard() {
      $("board").onclick = function (event) {
      var editId = event.target.getAttribute && event.target.getAttribute("data-edit");
      var deleteId = event.target.getAttribute && event.target.getAttribute("data-delete");
      if (editId) return void editItem(editId);
      if (deleteId) return void deleteItem(deleteId);
      var node = event.target;
      while (node && node !== this && !(node.getAttribute && node.getAttribute("data-id"))) node = node.parentNode;
      if (!node || node === this || !node.getAttribute || !node.getAttribute("data-id")) return;
      // 已过期的行没有 clickable，点了也不该弹「申请管理员」——先说过期
      if (node.className && node.className.indexOf("expired") >= 0) return void message("已过期的作业不能修改", true);
      if (!manage) {
        dialog({
          title: "仅管理员可修改作业",
          body: "<p>当前身份是「" + roleLabel(profile ? profile.role : "user") + "」。只有发布者与管理员可以修改作业，而且只能修改未过期的作业。</p>",
          actions: [
            { label: "我知道了" },
            {
              label: "申请管理员",
              primary: true,
              onClick: function (close) {
                close();
                dialog({
                  title: "申请作业管理员",
                  body: "<p>管理员邮箱：<b>" + escapeHtml(config.adminEmail || "") + "</b></p>" +
                    "<p>点下面的按钮会打开邮件应用，收件人与主题（申请作业管理员）已经填好。</p>",
                  actions: [
                    { label: "关闭" },
                    {
                      label: "打开「电子邮件」",
                      primary: true,
                      onClick: function (next) {
                        next();
                        openMailto(
                          config.adminEmail,
                          "申请作业管理员",
                          "你好，我想申请成为作业管理员（可以发布与修改作业）。\n\n" +
                            "我的账号邮箱：" + (((session() || {}).email) || "（未填写）") + "\n\n申请理由："
                        );
                      }
                    }
                  ]
                });
              }
            }
          ]
        });
        return;
      }
      selectedId = selectedId === node.getAttribute("data-id") ? null : node.getAttribute("data-id");
      renderBoard(rows, { canManage: manage, selectedId: selectedId });
      };
    }


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
      ".anndlg select,.anndlg input[type=date]{min-height:38px;padding:6px 10px;border:1px solid #6f7a7d;border-radius:10px;background:#fff;font:inherit;font-size:14px}",
      // 开关：原生 checkbox + appearance:none，语义与键盘操作保持原生
      ".annswitches{display:grid;gap:10px;margin:0 0 12px}",
      ".switchitem{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;color:#171d1e;user-select:none}",
      ".switchitem input.sw{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:52px;min-width:52px;height:32px;min-height:32px;margin:0;padding:0;border:2px solid #6f7a7d;border-radius:999px;background:#e0e5e7;cursor:pointer;transition:background-color 200ms cubic-bezier(.2,0,0,1),border-color 200ms cubic-bezier(.2,0,0,1)}",
      ".switchitem input.sw::before{content:\"\";position:absolute;top:50%;left:6px;width:16px;height:16px;border-radius:50%;background:#6f7a7d;transform:translateY(-50%);transition:left 240ms cubic-bezier(.2,0,0,1),width 240ms cubic-bezier(.2,0,0,1),height 240ms cubic-bezier(.2,0,0,1),background-color 200ms cubic-bezier(.2,0,0,1)}",
      ".switchitem input.sw:checked{border-color:#006877;background:#006877}",
      ".switchitem input.sw:checked::before{left:22px;width:24px;height:24px;background:#fff}",
      ".switchitem input.sw:focus-visible{outline:2px solid #006877;outline-offset:3px}",
      // 截止日期折叠：hidden/display:none 没法过渡，改用 max-height + opacity
      ".anndateslot{overflow:hidden;max-height:120px;opacity:1;transform:translateY(0);transition:max-height 280ms cubic-bezier(.2,0,0,1),opacity 200ms cubic-bezier(.2,0,0,1),transform 280ms cubic-bezier(.2,0,0,1),margin-block-end 280ms cubic-bezier(.2,0,0,1);margin-block-end:10px}",
      ".anndateslot.collapsed{max-height:0;opacity:0;transform:translateY(-8px);margin-block-end:0;pointer-events:none}",
      ".anndateslot.noanim{transition:none}"
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
    bar.innerHTML = "<h3>公告</h3><div id=\"announcement-list\"></div>";
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
        : escapeHtml(item.content || "").replace(/\n/g, "<br>");
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
      '<div class="annswitches">' +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-pinned"' + (editing && editing.pinned ? " checked" : "") + ' /><span>置顶</span></label>' +
      (isStrictPublisher()
        ? '<label class="switchitem"><input type="checkbox" class="sw" id="ann-admin-edit"' + (!editing || editing.admin_only_edit ? " checked" : "") + ' /><span>管理员可修改</span></label>'
        : "") +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-internal"' + (editing && editing.internal ? " checked" : "") + ' /><span>内部（仅管理员与发布者可见）</span></label>' +
      '<label class="switchitem"><input type="checkbox" class="sw" id="ann-never"' + (editing && editing.never_expires ? " checked" : "") + ' /><span>永不过期</span></label>' +
      "</div>" +
      '<div class="anndateslot" id="ann-dateslot"><label class="field"><span>截止日期</span><input type="date" id="ann-expiry" value="' +
      (editing && editing.expires_on ? String(editing.expires_on).slice(0, 10) : "") + '" /></label></div>' +
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
        ? (editing.content_html || escapeHtml(editing.content || "").replace(/\n/g, "<br>"))
        : "";
    }
    // 勾了「永不过期」就把截止日期平滑收起（不是简单地 disabled/隐藏）
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

  function pageIndex() {
    topbar({ title: config.siteName || "作业", showTimemachine: true });
    if (!session()) {
      var banner = document.createElement("div");
      banner.className = "banner";
      banner.innerHTML = "<span>还没有登录：登录后可以用时光机查看以前的作业，也才能发布或修改（仅限未过期的作业）。</span>" +
        '<a class="pill primary" href="login.html">登录 / 注册</a>';
      document.body.insertBefore(banner, $("board"));
    } else {
      $("account-label").innerHTML = "个人中心";
      $("account-button").setAttribute("href", "#");
      $("account-button").onclick = function (event) {
        event.preventDefault();
        dialog({
          title: "个人中心",
          body: "<p>当前身份：<b>" + roleLabel(profile ? profile.role : "user") + "</b><br>" +
            escapeHtml((session() || {}).email || "") + "</p>",
          actions: [
            {
              label: "退出登录",
              onClick: function (close) {
                close();
                try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
                location.href = "login.html";
              }
            },
            { label: "关闭", primary: true }
          ]
        });
      };
    }
    bindAccount();
    fab(exportJson);
    bindBoard();
    bindAnnouncementBar();
    loadAnnouncements();

    api("publish_batches?select=published_on&order=published_on.desc&limit=400")
      .then(function (batches) {
        var dates = batches.map(function (row) { return row.published_on; });
        if (!dates.length) return void message("还没有发布过作业。");
        var today = todayString();
        currentDate = dates.indexOf(today) >= 0 ? today : dates[0];
        loadDay(currentDate);
      })
      .catch(function (error) { message("读取发布记录失败：" + error.message, true); });

    window.setInterval(function () {
      refreshProfile().then(function () {
        if (profile && profile.banned) return void (location.href = "ban.html");
        var next = canEdit();
        if (next !== manage) {
          manage = next;
          if (!manage) selectedId = null;
          renderBoard(rows, { canManage: manage, selectedId: selectedId });
          message(manage ? "权限已更新" : "你的修改权限已被撤销", !manage);
        }
      });
    }, 30000);
  }

  /* ------------------------------------------------------ 页面：时光机 */

  function pageTimemachine() {
    topbar({ title: (config.siteName || "作业") + " · 时光机", datePicker: true, back: "index.html" });
    if (!session()) return void (location.href = "login.html");

    var picker = $("date-picker");
    bindAccount();
    bindBoard();
    bindAnnouncementBar();
    loadAnnouncements();
    message("请选择一个日期");

    api("publish_batches?select=published_on&order=published_on.desc&limit=400")
      .then(function (batches) {
        var dates = batches.map(function (row) { return row.published_on; });
        if (!dates.length) return void message("还没有发布过作业。");
        picker.min = dates[dates.length - 1];
        picker.max = dates[0];
      })
      .catch(function (error) { message("读取发布记录失败：" + error.message, true); });

    var wrap = picker.parentNode;
    if (wrap) {
      wrap.style.cursor = "pointer";
      wrap.onclick = function (event) {
        if (event.target === picker) return;
        try {
          if (typeof picker.showPicker === "function") picker.showPicker();
          else picker.focus();
        } catch (error) {
          picker.focus();
        }
      };
    }

    picker.onchange = function () {
      if (!picker.value) return;
      message("正在加载…");
      api("homeworks?select=id,subject,content,content_html,tags,due_date,expired,sort_order&published_on=eq." + picker.value + "&order=subject.asc,sort_order.asc")
        .then(function (data) {
          rows = data;
          currentDate = picker.value;
          selectedId = null;
          // 时光机也能改未过期的作业：权限只看角色，过不过期逐条判定
          manage = canEdit();
          var editableCount = rows.filter(function (row) { return !isRowExpired(row); }).length;
          message(formatDate(picker.value) + " · 共 " + rows.length + " 条作业" +
            (manage ? (editableCount ? " · " + editableCount + " 条未过期可修改" : " · 这一天的作业都已过期") : ""));
          renderBoard(rows, { canManage: manage, selectedId: selectedId, emptyText: "这一天没有作业" });
        })
        .catch(function (error) { message("加载失败：" + error.message, true); });
    };
  }

  /* -------------------------------------------------- 页面：登录注册 */

  function pageLogin() {
    topbar({ title: config.siteName || "作业", hideAccount: true, backLink: "index.html", backLabel: "返回" });
    var mode = "login";
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<h2>登录 / 注册</h2>" +
      '<p class="status" id="status">登录后可以用时光机，也才能发布或修改作业（仅限未过期的作业）。</p>' +
      '<label class="field"><span>邮箱</span><input id="email" type="email" /></label>' +
      '<label class="field"><span>密码（至少 8 位）</span><input id="password" type="password" /></label>' +
      '<label class="field" id="confirm-row" style="display:none"><span>确认密码</span><input id="confirm" type="password" /></label>' +
      '<div class="tabs"><button class="pill primary" id="tab-login">登录</button>' +
      '<button class="pill" id="tab-register">注册</button></div>' +
      '<div class="dialogactions"><button class="pill primary" id="submit">登录</button></div>';
    document.body.appendChild(card);

    if (session()) return void refreshProfile().then(function () { location.href = "index.html"; });

    function setMode(next) {
      mode = next;
      var registering = next === "register";
      $("confirm-row").style.display = registering ? "block" : "none";
      $("submit").innerHTML = registering ? "注册并发送验证邮件" : "登录";
      $("tab-login").className = "pill" + (registering ? "" : " primary");
      $("tab-register").className = "pill" + (registering ? " primary" : "");
    }
    $("tab-login").onclick = function () { setMode("login"); };
    $("tab-register").onclick = function () { setMode("register"); };
    $("submit").onclick = function () {
      var email = $("email").value.replace(/^\s+|\s+$/g, "");
      var password = $("password").value;
      if (!email || !password) return void message("请填写邮箱和密码", true);
      if (mode === "register") {
        if (password.length < 8) return void message("密码至少 8 位", true);
        if (password !== $("confirm").value) return void message("两次输入的密码不一致", true);
        message("正在提交…");
        signUp(email, password)
          .then(function () { message("注册成功，验证邮件已发送，请到邮箱点开链接完成验证。"); })
          .catch(function (error) { message("注册失败：" + error.message, true); });
        return;
      }
      message("正在登录…");
      login(email, password)
        .then(function () {
          if (profile && profile.banned) return void (location.href = "ban.html");
          location.href = "index.html";
        })
        .catch(function (error) {
          if (String(error.message).toLowerCase().indexOf("confirm") >= 0) {
            dialog({ title: "邮箱还没有验证", body: "<p>请先到邮箱点开验证链接，再回来登录。</p>", actions: [{ label: "好", primary: true }] });
            return;
          }
          message("登录失败：" + error.message, true);
        });
    };
  }

  /* ---------------------------------------------------- 页面：发布作业 */

  function pagePublish() {
    topbar({ title: "发布作业", back: "index.html" });
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<p class="status" id="status">正在检查权限…</p><div id="form" style="display:none">' +
      '<label class="field"><span>归属日期（只能是今天）</span><input id="date" readonly /></label>' +
      '<label class="field"><span>或直接粘贴 JSON</span><textarea id="json"></textarea></label>' +
      '<label class="field"><span>或选择 JSON 文件</span><input id="file" type="file" accept="application/json,.json" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="submit">发布到这一天</button></div></div>';
    document.body.appendChild(card);
    $("date").value = todayString();

    if (!session()) return void (location.href = "404.html");
    refreshProfile().then(function () {
      if (!isPublisher()) return void (location.href = "404.html");
      message("在桌面端 StickyHomeworks2 里用「保存作业 → JSON」导出，然后在下面导入。同一天重复发布会覆盖当天记录。");
      $("form").style.display = "block";
    });

    $("file").onchange = function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { $("json").value = String(reader.result || ""); };
      reader.readAsText(file, "utf-8");
    };
    $("submit").onclick = function () {
      var payload;
      try {
        payload = JSON.parse($("json").value);
      } catch (error) {
        return void message("JSON 解析失败：" + error.message, true);
      }
      message("正在发布…");
      api("rpc/publish_homeworks", { method: "POST", body: { p_payload: payload, p_published_on: $("date").value } })
        .then(function (data) {
          message("发布成功：" + $("date").value + " 共 " + (data.homeworkCount || 0) + " 条作业 / " +
            (data.subjectCount || 0) + " 个科目");
        })
        .catch(function (error) { message("发布失败：" + error.message, true); });
    };
  }

  /* ---------------------------------------------------- 页面：安全中心 */

  function pageSecurity() {
    // 顶栏只留「返回看板」：不显示网站状态、不显示个人中心、也不用时光机那套「回到今天」
    topbar({ title: "安全中心", hideStatus: true, hideAccount: true, backLink: "index.html", backLabel: "返回看板" });
    if (!session()) return void (location.href = "login.html");

    /* —— 卡片 1：更改邮箱 —— */
    var emailCard = document.createElement("div");
    emailCard.className = "card";
    emailCard.innerHTML = "<h2>更改邮箱</h2>" +
      '<p class="status" id="status">当前账号：' + escapeHtml((session() || {}).email || "") + "</p>" +
      '<label class="field"><span>当前邮箱（旧）</span><input id="old-email" readonly /></label>' +
      '<label class="field"><span>新邮箱</span><input id="new-email" type="email" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-email">发送验证邮件到新邮箱</button></div>' +
      '<div class="dialogactions"><button class="pill text" id="appeal">旧邮箱不可用，去申诉</button></div>';
    document.body.appendChild(emailCard);
    $("old-email").value = (session() || {}).email || "";

    /* —— 卡片 2：更改密码 —— */
    var passwordCard = document.createElement("div");
    passwordCard.className = "card";
    passwordCard.innerHTML = "<h2>更改密码</h2>" +
      '<p class="hint">需要邮箱验证：提交后系统会向你的当前邮箱发送验证邮件，点开链接后即可设置新密码。</p>' +
      '<label class="field"><span>新密码（至少 8 位）</span><input id="new-password" type="password" /></label>' +
      '<label class="field"><span>确认新密码</span><input id="confirm-password" type="password" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-password">发送验证邮件到当前邮箱</button></div>';
    document.body.appendChild(passwordCard);

    /* —— 卡片 3：注销账号 —— */
    var PHRASE = "我确认注销账号，并允许服务器将我的账号数据继续存放60天";
    var block = document.createElement("div");
    block.className = "card";
    block.innerHTML = "<h2>注销账号</h2>" +
      '<p class="status" id="deletion-status">注销不可逆。提交后你会从所有设备退出登录，账号将在 3 天后进入已注销状态。</p>' +
      '<div id="deletion-send"><div class="dialogactions"><button class="pill primary" id="ask-deletion">申请注销，先验证邮箱</button></div></div>' +
      '<div id="deletion-code-box" style="display:none"><label class="field"><span>邮箱验证码</span><input id="deletion-code" inputmode="numeric" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-deletion-code">验证并继续</button></div></div>' +
      '<div id="deletion-confirm" style="display:none"><p>邮箱已验证。请把下面这句话<strong>原样输入</strong>（含标点）：</p>' +
      '<p class="status" id="deletion-phrase">' + PHRASE + "</p>" +
      '<label class="field"><span>在此输入上面那句话</span><input id="deletion-input" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-deletion">确认注销</button>' +
      '<button class="pill text" id="undo-deletion">我改主意了，取消</button></div></div>';
    document.body.appendChild(block);

    function deletionStatus(text, isError) {
      var el = $("deletion-status");
      if (!el) return;
      el.className = isError ? "status error" : "status";
      el.innerHTML = escapeHtml(text);
    }

    $("ask-deletion").onclick = function () {
      var current = session();
      if (!current) return void (location.href = "login.html");
      deletionStatus("正在发送验证邮件…", false);
      // 验证邮件只做验证：走 recovery 验证码（reauthenticate 的 nonce 校验不稳定）
      fetch(config.supabaseUrl + "/auth/v1/recover", {
        method: "POST",
        headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: current.email })
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(readError(text, response.status));
          document.getElementById("deletion-code-box").style.display = "block";
          deletionStatus("验证邮件已发送到 " + current.email + "：请把邮件里的数字验证码填到下面。", false);
        });
      }).catch(function (error) { deletionStatus("发送失败：" + error.message, true); });
    };

    $("do-deletion-code").onclick = function () {
      var token = ($("deletion-code").value || "").replace(/^\s+|\s+$/g, "");
      if (!/^\d{6,8}$/.test(token)) return void deletionStatus("请输入邮件里的数字验证码。", true);
      deletionStatus("正在校验…", false);
      fetch(config.supabaseUrl + "/auth/v1/verify", {
        method: "POST",
        headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "recovery", email: (session() || {}).email || "", token: token })
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(readError(text, response.status));
          $("deletion-code-box").style.display = "none";
          $("deletion-send").style.display = "none";
          $("deletion-confirm").style.display = "block";
          deletionStatus("邮箱已验证，请按下面的提示输入确认短语。", false);
        });
      }).catch(function (error) { deletionStatus("验证码不正确或已过期：" + error.message, true); });
    };

    $("do-deletion").onclick = function () {
      if ($("deletion-input").value.replace(/^\s+|\s+$/g, "") !== PHRASE) {
        return void deletionStatus("输入的内容与确认短语不一致，请原样输入（注意标点）。", true);
      }
      deletionStatus("正在提交注销申请…", false);
      var mine = session();
      var accessToken = mine ? mine.accessToken : "";
      var myEmail = mine ? mine.email : "";

      api("rpc/request_account_deletion", { method: "POST", body: {} })
        .then(function () {
          // 申请已记录 → 发通知邮件（Magic link，含"取消注销"）
          var redirect = location.href.replace(/[^/]*$/, "security.html?deletion=cancelled");
          return fetch(config.supabaseUrl + "/auth/v1/otp?redirect_to=" + encodeURIComponent(redirect), {
            method: "POST",
            headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
            body: JSON.stringify({ email: myEmail, create_user: false })
          });
        })
        .catch(function () { /* 通知邮件失败不影响注销 */ })
        .then(function () {
          // 提交后即在所有地方退出登录
          return fetch(config.supabaseUrl + "/auth/v1/logout?scope=global", {
            method: "POST",
            headers: { apikey: config.supabaseKey, Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }
          }).catch(function () {});
        })
        .then(function () {
          try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) {}
          location.href = "deleted.html?state=requested";
        })
        .catch(function (error) { deletionStatus("提交失败：" + error.message, true); });
    };

    $("undo-deletion").onclick = function () {
      api("rpc/cancel_account_deletion", { method: "POST", body: {} })
        .then(function () {
          deletionStatus("已取消注销申请，账号保持正常。", false);
          $("deletion-confirm").style.display = "none";
          $("deletion-send").style.display = "block";
        })
        .catch(function (error) { deletionStatus("取消失败：" + error.message, true); });
    };

    if (String(location.search).indexOf("deletion=confirm") >= 0) {
      $("deletion-send").style.display = "none";
      $("deletion-confirm").style.display = "block";
      deletionStatus("邮箱已验证，请按下面的提示输入确认短语。", false);
    }

    $("appeal").onclick = function () { appealDialog(); };
    $("do-email").onclick = function () {
      var next = $("new-email").value.replace(/^\s+|\s+$/g, "");
      if (!next) return void message("请填写新的邮箱地址", true);
      message("正在发送验证邮件…");
      fetch(config.supabaseUrl + "/auth/v1/user", {
        method: "PUT",
        headers: { apikey: config.supabaseKey, Authorization: "Bearer " + (session() || {}).accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ email: next })
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(readError(text, response.status));
          message("已向 " + next + " 发送验证邮件，点开确认后才会生效；确认前旧邮箱仍然可用。");
        });
      }).catch(function (error) { message("发送失败：" + error.message, true); });
    };
    $("do-password").onclick = function () {
      var next = $("new-password").value;
      if (next.length < 8) return void message("密码至少 8 位", true);
      if (next !== $("confirm-password").value) return void message("两次输入的密码不一致", true);
      message("正在发送验证邮件…");
      fetch(config.supabaseUrl + "/auth/v1/recover", {
        method: "POST",
        headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: (session() || {}).email || "" })
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(readError(text, response.status));
          message("确认邮件已发送到 " + ((session() || {}).email || "你的邮箱") + "，点开链接后即可设置新密码。");
        });
      }).catch(function (error) { message("发送失败：" + error.message, true); });
    };
  }

  /** 旧邮箱不可用申诉：与「申请管理员」同一套界面 */
  function appealDialog() {
    var oldEmail = (session() || {}).email || "";
    dialog({
      title: "旧邮箱不可用申诉",
      body: '<label class="field"><span>管理员邮箱</span><input readonly value="' + escapeHtml(config.adminEmail || "") + '" /></label>' +
        "<p>如果旧邮箱已经无法登录、收不到验证邮件，可以给管理员发一封申诉邮件，说明情况并附上可用的新邮箱。</p>",
      actions: [
        { label: "关闭" },
        {
          label: "打开「电子邮件」",
          primary: true,
          onClick: function (close) {
            close();
            openMailto(
              config.adminEmail,
              "邮箱不可用申诉",
              "我的账号旧邮箱已经无法使用，申请协助。\n\n账号（旧邮箱）：" + oldEmail + "\n\n可用的新邮箱："
            );
          }
        }
      ]
    });
  }
  /* ---------------------------------------------------- 页面：验证结果 */

  function pageAuth() {
    topbar({ title: "邮箱验证" });
    var hash = String(location.hash || "").replace(/^#/, "");
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<h2 id="title">邮箱验证</h2><p class="status" id="status">正在读取验证结果…</p>' +
      '<div class="dialogactions"><a class="pill primary" href="index.html">进入作业看板</a></div>';
    document.body.appendChild(card);

    if (hash.indexOf("error") >= 0) {
      var code = (hash.match(/error_code=([^&]+)/) || [])[1] || "";
      $("title").innerHTML = "验证失败";
      message(code === "otp_expired" ? "验证链接已经过期，请回到登录页重新发送验证邮件。" : "验证链接无法使用，请重新发送验证邮件。", true);
    } else if (hash.indexOf("access_token") >= 0 || hash.indexOf("type=") >= 0) {
      $("title").innerHTML = "验证成功";
      message("邮箱已验证，现在可以登录查看作业了。");
    } else {
      message("如果你刚注册，请点开邮箱里的验证链接；已经验证过就直接登录。");
    }
  }

  /* ---------------------------------------------------------------- 启动 */

  function render(page) {
    injectStyle();
    rememberView();
    lowBar();
    var pages = {
      index: pageIndex,
      timemachine: pageTimemachine,
      login: pageLogin,
      publish: pagePublish,
      security: pageSecurity,
      auth: pageAuth
    };
    refreshProfile().then(function () {
      if (profile && profile.banned && page !== "auth") {
        location.href = "ban.html";
        return;
      }
      if (profile && profile.deleted_at && page !== "auth") {
        location.href = "deleted.html";
        return;
      }
      if (profile && profile.deletion_requested_at && page !== "auth") {
        // 3 天内登录 = 取消注销
        api("rpc/cancel_account_deletion", { method: "POST", body: {} })
          .then(function () {
            dialog({
              title: "欢迎回来",
              body: "<p>检测到你在这段时间内登录了，注销申请已经自动取消，账号与作业都保持原样。</p>",
              actions: [{ label: "知道了", primary: true }]
            });
          })
          .catch(function () {});
      }
      (pages[page] || pageIndex)();
    });
  }

  window.hsSimple = {
    icon: icon,
    api: api,
    session: session,
    refreshProfile: refreshProfile,
    roleLabel: roleLabel,
    render: render,
    dialog: dialog,
    message: message
  };
})();
