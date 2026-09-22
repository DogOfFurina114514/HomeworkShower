/*
 * 简版共享脚本（ES5 写法，老浏览器可用）
 *
 * 提供：
 *   hsSimple.api()        —— 直接调 Supabase REST（匿名读 / 带登录态读写）
 *   hsSimple.session()    —— 从 localStorage 读登录态
 *   hsSimple.renderBoard()—— 渲染作业看板（与完整版同样的分组与卡片结构）
 *   hsSimple.lowBar()     —— 顶部常驻红色提示条 + 「重试完整版」
 *   hsSimple.dialog()     —— 手绘 M3 风格弹窗
 * 账号密码走 Supabase Auth 的 REST 接口，不依赖 supabase-js。
 */
window.hsSimple = (function () {
  var config = window.HOMEWORK_SHOWER_CONFIG || {};
  var STORAGE_KEY = (config.authStorageKey || "homework-shower-auth") + "-simple";

  function todayString() {
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  function formatDate(value) {
    var parts = String(value).split("-");
    return parts[0] + " 年 " + Number(parts[1]) + " 月 " + Number(parts[2]) + " 日";
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isExpired(due) {
    return due ? String(due) < todayString() : false;
  }

  /** 登录态：存 access_token / refresh_token / email / role */
  function session() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveSession(data) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      /* 隐私模式下可能写不了，忽略 */
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {}
  }

  /** 调 REST：path 例如 "homeworks?select=*&limit=1" */
  function api(path, options) {
    options = options || {};
    var current = session();
    var token = options.token || (current && current.access_token) || config.supabaseKey;
    var headers = {
      apikey: config.supabaseKey,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    };
    if (options.headers) {
      for (var key in options.headers) {
        if (Object.prototype.hasOwnProperty.call(options.headers, key)) headers[key] = options.headers[key];
      }
    }
    return fetch(config.supabaseUrl + "/rest/v1/" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(extractError(text, response.status));
        });
      }
      if (response.status === 204) return null;
      return response.json();
    });
  }

  function extractError(text, status) {
    try {
      var parsed = JSON.parse(text);
      return parsed.message || parsed.error_description || parsed.error || "HTTP " + status;
    } catch (error) {
      return text || "HTTP " + status;
    }
  }

  /** 邮箱密码登录（Supabase Auth REST） */
  function login(email, password) {
    return fetch(config.supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error(extractError(text, response.status));
        var data = JSON.parse(text);
        return loadRole(data);
      });
    });
  }

  /** 注册（会触发验证邮件） */
  function signUp(email, password) {
    var redirect = config.supabaseUrl ? location.href.replace(/simple\/.*$/, "auth.html") : "";
    return fetch(config.supabaseUrl + "/auth/v1/signup", {
      method: "POST",
      headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password, options: { emailRedirectTo: redirect } })
    }).then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) throw new Error(extractError(text, response.status));
        return JSON.parse(text);
      });
    });
  }

  /** 用 access_token 取自己的角色 */
  function loadRole(data) {
    var payload = { access_token: data.access_token, refresh_token: data.refresh_token, email: data.user && data.user.email, role: "user" };
    return fetch(config.supabaseUrl + "/rest/v1/profiles?select=role&id=eq." + data.user.id, {
      headers: { apikey: config.supabaseKey, Authorization: "Bearer " + data.access_token }
    })
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (rows) {
        payload.role = (rows && rows[0] && rows[0].role) || "user";
        saveSession(payload);
        return payload;
      });
  }

  function canEdit(role) {
    return role === "publisher" || role === "admin";
  }

  function isPublisher(role) {
    return role === "publisher";
  }

  function roleLabel(role) {
    return { publisher: "发布者", admin: "管理员", user: "用户" }[role] || "用户";
  }

  /** 顶部常驻红色提示：说明这是简版，并提供「重试完整版」 */
  function lowBar() {
    var bar = document.createElement("div");
    bar.className = "low-browser-bar";
    var full = location.pathname.replace(/simple\/[^\/]*$/, "") + (location.pathname.match(/simple\/([\w.-]+)$/) ? location.pathname.match(/simple\/([\w.-]+)$/)[1] : "index.html");
    bar.innerHTML =
      '<b>你的浏览器版本过低</b>，当前是简版页面（功能与控件位置与完整版一致，但没有 M3 动效）。' +
      ' <a href="' + full + '">重试完整版</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /** 手绘 M3 风格弹窗 */
  function dialog(options) {
    var backdrop = document.createElement("div");
    backdrop.className = "backdrop open";
    var buttons = (options.actions || [])
      .map(function (action, index) {
        return '<button class="pill ' + (action.primary ? "primary" : "text") + '" data-index="' + index + '">' + escapeHtml(action.label) + "</button>";
      })
      .join("");
    backdrop.innerHTML =
      '<div class="dialog"><h3>' + escapeHtml(options.title) + "</h3>" +
      (options.body || "") +
      '<div class="dialog-actions">' + buttons + "</div></div>";
    document.body.appendChild(backdrop);

    function close() {
      document.body.removeChild(backdrop);
      if (options.onClose) options.onClose();
    }

    var nodes = backdrop.querySelectorAll("[data-index]");
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        node.onclick = function () {
          var action = options.actions[Number(node.getAttribute("data-index"))];
          if (action && action.onClick) action.onClick(close);
          else close();
        };
      })(nodes[i]);
    }
    backdrop.onclick = function (event) {
      if (event.target === backdrop) close();
    };
    return close;
  }

  function message(text, isError) {
    var el = document.getElementById("status");
    if (!el) return;
    el.innerHTML = escapeHtml(text);
    el.className = isError ? "status error" : "status";
  }

  /** 渲染看板：与完整版一致的分组 + 圆点卡片 + 标签芯片 + 过期标红 */
  function renderBoard(rows, options) {
    options = options || {};
    var boardEl = document.getElementById("board");
    if (!boardEl) return;
    if (!rows.length) {
      boardEl.innerHTML = '<p class="empty">' + (options.emptyText || "没有作业") + "</p>";
      return;
    }

    var groups = [];
    var index = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var subject = String(row.subject || "其它").replace(/^\s+|\s+$/g, "") || "其它";
      if (!index[subject]) {
        index[subject] = { subject: subject, items: [] };
        groups.push(index[subject]);
      }
      index[subject].items.push(row);
    }

    var html = "";
    for (var g = 0; g < groups.length; g++) {
      html += '<section class="group"><h2>' + escapeHtml(groups[g].subject) + "</h2>";
      for (var k = 0; k < groups[g].items.length; k++) {
        var item = groups[g].items[k];
        var expired = isExpired(item.due_date);
        var selected = options.selectedId && String(options.selectedId) === String(item.id);
        var content = item.content_html ? item.content_html : escapeHtml(item.content).replace(/\n/g, "<br>");
        var tags = "";
        if (item.tags && item.tags.length) {
          tags = '<span class="tags">';
          for (var t = 0; t < item.tags.length; t++) {
            tags += '<span class="tag">' + escapeHtml(item.tags[t]) + "</span>";
          }
          tags += "</span>";
        }
        var actions = selected && options.canManage
          ? '<span class="actions"><button class="pill text" data-edit="' + item.id + '">修改</button>' +
            '<button class="pill text" data-delete="' + item.id + '">删除</button></span>'
          : "";
        html +=
          '<div class="item' + (expired ? " expired" : "") + (selected ? " selected" : "") +
          (options.canManage ? " clickable" : "") + '" data-id="' + item.id + '">' +
          content + tags + actions + "</div>";
      }
      html += "</section>";
    }
    boardEl.innerHTML = html;
  }

  return {
    config: config,
    todayString: todayString,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    isExpired: isExpired,
    session: session,
    saveSession: saveSession,
    clearSession: clearSession,
    api: api,
    login: login,
    signUp: signUp,
    canEdit: canEdit,
    isPublisher: isPublisher,
    roleLabel: roleLabel,
    lowBar: lowBar,
    dialog: dialog,
    message: message,
    renderBoard: renderBoard
  };
})();

















