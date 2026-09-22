/**
 * 公共客户端与工具：会话、角色、内容清洗。
 * 依赖：vendor/supabase.js（UMD，暴露全局 supabase）、assets/config.js
 */
(function () {
  const config = window.HOMEWORK_SHOWER_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      storageKey: config.authStorageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const ROLE_LABELS = { publisher: "发布者", admin: "管理员", user: "用户" };

  const ALLOWED_TAGS = new Set([
    "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SPAN", "DIV",
    "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "A",
  ]);
  const ALLOWED_ATTRS = { A: ["href", "title"], IMG: ["src", "alt", "style"] };

  /** 发布者导入的富文本来自他人，这里按白名单清洗后再插入页面，避免 XSS。 */
  function sanitizeHtml(html) {
    if (!html) return "";
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = parsed.body.firstElementChild;
    if (!root) return "";

    const walk = (node) => {
      for (const child of Array.from(node.children)) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }
        for (const attr of Array.from(child.attributes)) {
          const allowed = ALLOWED_ATTRS[child.tagName] || [];
          if (!allowed.includes(attr.name.toLowerCase()) || attr.name.toLowerCase().startsWith("on")) {
            child.removeAttribute(attr.name);
          }
        }
        if (child.tagName === "A") {
          const href = child.getAttribute("href") || "";
          if (!/^https?:|^mailto:/i.test(href)) child.removeAttribute("href");
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        }
        if (child.tagName === "IMG") {
          const src = child.getAttribute("src") || "";
          const isInlineImage = /^data:image\/(png|jpeg|gif|webp);base64,/i.test(src);
          // 允许本项目的图片桶地址（图片存在 Storage 里，不占数据库）
          const isBucketImage = src.startsWith(`${config.supabaseUrl}/storage/v1/object/public/homework-images/`);
          if (!isInlineImage && !isBucketImage) {
            child.remove();
            continue;
          }
        }
        walk(child);
      }
    };
    walk(root);
    return root.innerHTML;
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  async function getSession() {
    // 加超时：supabase 的 getSession 在个别环境（navigator.locks 被占用）会一直不返回，
    // 那样整页就卡在「正在加载」了
    const { data } = await withTimeout(client.auth.getSession(), 8000, "读取登录状态");
    return data.session ?? null;
  }

  async function getProfile() {
    const { data: userData } = await withTimeout(client.auth.getUser(), 10000, "读取账号信息");
    const user = userData?.user;
    if (!user) return null;
    const { data } = await withTimeout(
      client.from("profiles").select("role,email").eq("id", user.id).maybeSingle(),
      10000,
      "读取角色",
    );
    return {
      user,
      email: data?.email || user.email || "",
      role: data?.role || "user",
    };
  }

  /** 未登录直接跳登录页，并记住来路。 */
  async function requireSession() {
    const session = await getSession();
    if (!session) {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.replace(`login.html?next=${next}`);
      return null;
    }
    return session;
  }

  async function signOut() {
    await client.auth.signOut();
    location.replace("login.html");
  }

  /** 只有发布者能发布作业 */
  function isPublisher(profile) {
    return profile?.role === "publisher";
  }

  /** 发布者与管理员都能修改，但后端只允许改当天的 */
  function canEditToday(profile) {
    return profile?.role === "publisher" || profile?.role === "admin";
  }

  function toast(message) {
    if (window.M3eSnackbar && typeof window.M3eSnackbar.open === "function") window.M3eSnackbar.open(message);
    else console.log(message);
  }

  /**
   * 把错误直接画到页面顶部：这个站点在手机/别人电脑上没法开控制台，
   * 出问题时至少截图就能定位。
   */
  function fatal(message) {
    const text = String(message || "未知错误");
    let bar = document.getElementById("fatal-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "fatal-bar";
      bar.className = "banner banner--fatal";
      bar.setAttribute("role", "alert");
      document.body.prepend(bar);
    }
    bar.textContent = `出错了：${text}`;
    console.error("[HomeworkShower]", text);
  }

  /**
   * 给网络请求加超时，避免请求悬挂时页面一直停在「正在加载」。
   * 注意：Supabase 的查询构造器是 thenable（只有 then，没有 finally），
   * 所以这里只依赖 Promise.resolve 包装后的 then，不能用 .finally。
   */
  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`)), ms);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  window.addEventListener("error", (event) => {
    const message = String(event.message || "");
    // 跨域脚本（通常是浏览器扩展注入的）出错时浏览器只会给 "Script error."，
    // 既没有文件名也没有行号，对排查没帮助，就别弹红条吓人了，只写控制台。
    if (!message || message === "Script error.") {
      console.warn("[HomeworkShower] 忽略了无来源的脚本错误（多半来自浏览器扩展）");
      return;
    }
    const where = event.filename ? `（${String(event.filename).split("/").pop()}:${event.lineno}）` : "";
    fatal(message + where);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    fatal(reason instanceof Error ? reason.message : String(reason));
  });

  window.hs = {
    client,
    config,
    getSession,
    getProfile,
    requireSession,
    signOut,
    isPublisher,
    canEditToday,
    todayString,
    toast,
    fatal,
    withTimeout,
    sanitizeHtml,
    escapeHtml,
    roleLabel: (role) => ROLE_LABELS[role] || role,
  };
})();

