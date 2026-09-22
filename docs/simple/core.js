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
    back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z"
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
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (rows) {
        profile = rows && rows[0] ? rows[0] : { id: current.userId, role: "user", banned: false, deletion_requested_at: null, deleted_at: null };
        return profile;
      })
      .catch(function () { return null; });
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
    if (options.datePicker) {
      html += '<label class="datewrap">' + icon("calendar", 18) + "<span>发布日期</span>" +
        '<input type="date" id="date-picker" /></label>';
    }
    if (options.back) {
      html += '<a class="pill text" href="' + options.back + '">' + icon("back", 18) + "回到今天</a>";
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
      (isPublisher() ? '<button type="button" id="menu-publish">' + icon("upload", 18) + "发布作业</button>" : "") +
      '<button type="button" id="menu-export">' + icon("export", 18) + "导出作业</button></div>" +
      '<button class="fab" id="fab" aria-label="编辑">' + icon("pencil", 26) + "</button>";
    document.body.insertAdjacentHTML("beforeend", html);
    $("fab").onclick = function () {
      var menu = $("fab-menu");
      menu.className = menu.className.indexOf("open") >= 0 ? "fabmenu" : "fabmenu open";
    };
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

  function message(text, isError) {
    var el = $("status");
    if (!el) return;
    el.innerHTML = escapeHtml(text);
    el.className = isError ? "status error" : "status";
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
            var expired = isExpired(item.due_date);
            var selected = options.selectedId && String(options.selectedId) === String(item.id);
            var content = item.content_html ? item.content_html : escapeHtml(item.content).replace(/\n/g, "<br>");
            var tags = (item.tags || []).length ? '<span class="tags">' + item.tags.map(function (tag) {
              return '<span class="tag">' + escapeHtml(tag) + "</span>";
            }).join("") + "</span>" : "";
            var actions = options.canManage ? '<span class="actions">' +
              '<button class="pill text" data-edit="' + item.id + '">' + icon("edit", 18) + "修改</button>" +
              '<button class="pill text" data-delete="' + item.id + '">' + icon("trash", 18) + "删除</button></span>" : "";
            return '<div class="item' + (expired ? " expired" : "") + (selected ? " selected" : "") +
              (options.canManage ? " clickable" : "") + '" data-id="' + item.id + '">' + content + tags + actions + "</div>";
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

  function pageIndex() {
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
      api("homeworks?select=id,subject,content,content_html,tags,due_date,sort_order&published_on=eq." + date + "&order=subject.asc,sort_order.asc")
        .then(function (data) {
          rows = data.filter(function (row) { return !isExpired(row.due_date); });
          manage = canEdit() && date === todayString();
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
        body: "<p>删除后无法恢复。只有当天发布的内容可以修改或删除。</p>",
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

    topbar({ title: config.siteName || "作业", showTimemachine: true });
    if (!session()) {
      var banner = document.createElement("div");
      banner.className = "banner";
      banner.innerHTML = "<span>还没有登录：登录后可以用时光机查看以前的作业，也才能发布或修改（仅限当天）。</span>" +
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

    $("board").onclick = function (event) {
      var editId = event.target.getAttribute && event.target.getAttribute("data-edit");
      var deleteId = event.target.getAttribute && event.target.getAttribute("data-delete");
      if (editId) return void editItem(editId);
      if (deleteId) return void deleteItem(deleteId);
      var node = event.target;
      while (node && node !== this && !(node.getAttribute && node.getAttribute("data-id"))) node = node.parentNode;
      if (!node || node === this || !node.getAttribute || !node.getAttribute("data-id")) return;
      if (!manage) {
        dialog({
          title: "仅管理员可修改作业",
          body: "<p>当前身份是「" + roleLabel(profile ? profile.role : "user") + "」。只有发布者与管理员可以修改作业，而且只能修改当天发布的内容。</p>",
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
                        location.href = "mailto:" + (config.adminEmail || "") +
                          "?subject=" + encodeURIComponent("申请作业管理员");
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
        var next = canEdit() && currentDate === todayString();
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
      api("homeworks?select=id,subject,content,content_html,tags,due_date,sort_order&published_on=eq." + picker.value + "&order=subject.asc,sort_order.asc")
        .then(function (rows) {
          message(formatDate(picker.value) + " · 共 " + rows.length + " 条作业");
          renderBoard(rows, { emptyText: "这一天没有作业" });
        })
        .catch(function (error) { message("加载失败：" + error.message, true); });
    };
  }

  /* -------------------------------------------------- 页面：登录注册 */

  function pageLogin() {
    topbar({ title: config.siteName || "作业", hideAccount: true });
    var mode = "login";
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<h2>登录 / 注册</h2>" +
      '<p class="status" id="status">登录后可以用时光机，也才能发布或修改作业（仅限当天）。</p>' +
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
    topbar({ title: "安全中心", back: "index.html" });
    if (!session()) return void (location.href = "login.html");
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<h2>更改邮箱</h2>" +
      '<p class="status" id="status">当前账号：' + escapeHtml((session() || {}).email || "") + "</p>" +
      '<label class="field"><span>当前邮箱（旧）</span><input id="old-email" readonly /></label>' +
      '<label class="field"><span>新邮箱</span><input id="new-email" type="email" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-email">发送验证邮件到新邮箱</button></div>' +
      '<div class="dialogactions"><button class="pill text" id="appeal">旧邮箱不可用，去申诉</button></div>' +
      "<h2 style='margin-top:22px'>更改密码</h2>" +
      '<label class="field"><span>新密码（至少 8 位）</span><input id="new-password" type="password" /></label>' +
      '<label class="field"><span>确认新密码</span><input id="confirm-password" type="password" /></label>' +
      '<div class="dialogactions"><button class="pill primary" id="do-password">发送验证邮件到当前邮箱</button></div>';
    document.body.appendChild(card);
    $("old-email").value = (session() || {}).email || "";
    // —— 注销账号：先验证邮箱，再逐字输入短语，提交后全平台登出 ——
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
            location.href = "mailto:" + (config.adminEmail || "") +
              "?subject=" + encodeURIComponent("邮箱不可用申诉") +
              "&body=" + encodeURIComponent("我的账号旧邮箱已经无法使用，申请协助。\n\n账号（旧邮箱）：" + oldEmail + "\n\n可用的新邮箱：");
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
          .then(function () { message("已为你取消注销申请，欢迎回来", false); })
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



























