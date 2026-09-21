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
          if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) {
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

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session ?? null;
  }

  async function getProfile() {
    const { data: userData } = await client.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const { data } = await client.from("profiles").select("role,email").eq("id", user.id).maybeSingle();
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
    sanitizeHtml,
    escapeHtml,
    roleLabel: (role) => ROLE_LABELS[role] || role,
  };
})();
