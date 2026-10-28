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
    const { data, error } = await withTimeout(
      client.from("profiles").select("role,email,banned,deletion_requested_at,deleted_at").eq("id", user.id).maybeSingle(),
      10000,
      "读取角色",
    );
    // 读角色失败时**绝对不能**退回 "user"。
    //
    // 这个函数每次操作前都会被调一遍（board.js 的 syncPermissions，点一下就查、30 秒一轮询），
    // 只要有一次请求抖动读到 error，role 就变成 "user"，发布者当场被降权 ——
    // 用户看到的就是"我明明是发布者，怎么突然没权限了/新建作业也没权限了"。
    // 所以这里把"读失败"和"确实是普通用户"分开：读失败返回 null（身份未知），
    // 调用方会重试或报错，而不是拿一个编出来的 user 身份去覆盖已知的角色。
    if (error) {
      if (window.console) console.warn("[hs] 读取角色失败，按「身份未知」处理：", error.message);
      return null;
    }
    const profile = {
      user,
      email: data?.email || user.email || "",
      role: data?.role || "user",
      banned: Boolean(data?.banned),
      deletionRequestedAt: data?.deletion_requested_at || null,
      deletedAt: data?.deleted_at || null,
    };
    // 封禁账号：任何页面都跳到封禁提示页
    if (profile.banned) bannedRedirect();

    // 已注销：不再允许使用，送到注销说明页
    if (profile.deletedAt) {
      if (location.pathname.indexOf("deleted.html") < 0) location.replace("deleted.html");
      return null;
    }

    // 注销申请中：按约定"3 天内登录 = 取消注销"
    if (profile.deletionRequestedAt) {
      void client
        .rpc("cancel_account_deletion")
        .then(({ data }) => {
          if (data?.canceled) showWelcomeBack();
        })
        .catch(() => {});
      profile.deletionRequestedAt = null;
    }

    return profile;
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

  /** 被封禁：跳到封禁页，并且不允许通过退出登录绕过 */
  function bannedRedirect() {
    // 兼容 /ban 与 /ban.html（网页端已不带后缀）
    if (/\/ban(?:\.html)?$/.test(location.pathname)) return;
    location.replace(pageUrl("ban"));
  }

  async function signOut() {
    const profile = await getProfile().catch(() => null);
    if (profile && profile.banned) {
      bannedRedirect();
      return;
    }
    await client.auth.signOut();
    location.replace(pageUrl("login"));
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


  /** 登录后自动取消注销时的弹窗提示（M3E 对话框；组件未就绪时退回轻提示） */
  function showWelcomeBack() {
    try {
      if (!window.customElements || !window.customElements.get("m3e-dialog")) {
        toast("已为你取消注销申请，欢迎回来");
        return;
      }
      const dialog = document.createElement("m3e-dialog");
      // 自定义元素是异步升级的：立刻调用 .show() 会因为方法还不存在而失败，
      // 这里先把它标记为已升级，再显示。
      if (window.customElements && typeof window.customElements.upgrade === "function") {
        window.customElements.upgrade(dialog);
      }
      dialog.setAttribute("dismissible", "");
      dialog.innerHTML =
        '<m3e-heading slot="header" variant="headline" size="small" level="2">欢迎回来</m3e-heading>' +
        "<p>检测到你在这段时间内登录了，注销申请已经自动取消，账号与作业都保持原样。</p>" +
        '<div slot="actions" end><m3e-button variant="filled">知道了</m3e-button></div>';
      document.body.appendChild(dialog);
      dialog.querySelector("m3e-button")?.addEventListener("click", () => {
        dialog.hide();
        window.setTimeout(() => dialog.remove(), 300);
      });
      void dialog.show();
    } catch (error) {
      toast("已为你取消注销申请，欢迎回来");
    }
  }

  /**
   * 把 Supabase 的邮件/账号相关错误翻成人话。
   *
   * 原来各处直接把 error.message 贴出来，那是英文原文（"Email not sent"、
   * "Rate limit exceeded"…），用户根本看不懂；更要紧的是**看不出下一步该干什么**。
   * 这里按已知原因分类，明确给出"多半是邮箱不存在/拼错了"这类可行动的判断。
   */
  function describeAuthError(error, action = "发送") {
    if (!error) return "";
    const code = String(error.error_code || "").toLowerCase();
    const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();

    if (text.includes("rate limit") || text.includes("too many") || code === "over_document_limit") {
      return `${action}太频繁了，请等一分钟再试。`;
    }
    // 域名解析不了 / 邮件服务器拒收：几乎都是邮箱地址本身有问题
    if (
      text.includes("mx") || text.includes("resolve") || text.includes("domain") ||
      text.includes("smtp") || text.includes("recipient") || text.includes("not deliver") ||
      text.includes("mailbox") || text.includes("user unknown") || text.includes("does not exist")
    ) {
      return `${action}失败：邮箱解析失败，可能是邮箱不存在或地址拼写有误。请核对后再试。`;
    }
    if (text.includes("email not sent") || text.includes("send email")) {
      return `${action}失败：邮件没能发出去，可能是邮箱不存在或地址不可用。请核对邮箱后重试。`;
    }
    if (text.includes("invalid email") || text.includes("must be a valid") ||
      text.includes("invalid format") || text.includes("validate email")) {
      return "邮箱地址格式不正确，请检查是否填写完整（例如 name@example.com）。";
    }
    if (text.includes("already") && text.includes("regist")) {
      return "这个邮箱已经注册过了，请直接登录，或用「忘记密码」。";
    }
    if (text.includes("invalid login credentials")) {
      return "邮箱或密码不正确；如果刚注册，请先完成邮箱验证。";
    }
    if (text.includes("not confirmed") || text.includes("not verified")) {
      return "这个邮箱还没有完成验证，请先去邮箱点确认链接。";
    }
    if (text.includes("network") || text.includes("failed to fetch") || text.includes("timeout")) {
      return `${action}失败：连不上服务器，请检查网络后重试。`;
    }
    // 兜底也保留原文，方便截图反馈时定位
    return `${action}失败：${error.message || "未知错误"}`;
  }

  /**
   * 唤起邮件应用，并把"到底有没有走成"告诉用户。
   *
   * 原来各处都是直接 location.href = mailto:...，失败时**完全静默**：
   * 收件人地址没配、格式不对、或设备上根本没有能处理 mailto 的应用时，
   * 点了「打开电子邮件」什么都不会发生，用户只会以为按钮坏了。
   *
   * 检测办法：成功唤起邮件应用时页面会切到后台（visibilitychange → hidden）；
   * 若一段时间内页面还在前台，就认为没打开，给一条明确提示。
   * 不用 iframe 探针 —— 那样可能把邮件应用唤起两次。
   */
  function openMailto(to, subject, body) {
    const address = String(to || "").trim();
    if (!address) {
      toast("还没有配置收件人邮箱，请联系站点管理员");
      return false;
    }
    // 粗校验：明显不是邮箱地址（缺 @、缺域名点号）直接说清楚，
    // 免得用户以为"邮件发出去了"而其实根本没打开编辑器。
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      toast(`收件人邮箱地址无效（${address}），可能是邮箱不存在或配置有误`);
      return false;
    }
    const url = `mailto:${address}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;

    let left = false;
    const onHide = () => {
      // 只有真的切到后台才算"邮件应用起来了"
      if (document.visibilityState === "hidden") {
        left = true;
        cleanup();
      }
    };
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onHide);
    const timer = window.setTimeout(() => {
      cleanup();
      if (!left) toast("没能打开邮件应用：设备上可能没有安装邮件客户端");
    }, 2000);

    location.href = url;
    return true;
  }

  /**
   * 页面地址：一律省略 .html。
   *
   * 两端都支持无后缀：
   *   · 网页端 —— GitHub Pages 与 homework.fucku.top 都会把 /login 解析到 login.html
   *   · App 内 —— MainActivity.LocalSiteHandler 把 /login 回落到 login.html，
   *     把目录请求 /site/ 回落到 index.html
   * 所以这里不再按 host 分支，地址栏保持简洁。
   */
  function pageUrl(path) {
    // path 可以带查询串，如 "login?next=timemachine"
    const [name, query] = String(path).split("?");
    // 首页收敛成 "./"，地址栏不该出现 index.html
    if (name === "index" || name === "index.html") return query ? "./?" + query : "./";
    const clean = name.replace(/\.html$/, "");
    return query ? clean + "?" + query : clean;
  }

  /**
   * 顶栏按钮放不下时自动等比缩小，最多缩到 75%。
   *
   * 为什么需要：中文界面里按钮不少（时光机 / 网站状态 / 个人中心…），
   * 390px 宽的手机上纯排布会换到第二行，把首屏内容往下挤。
   * 这里改成不换行 + 按需缩放：只要缩到 75% 及以上能塞进一行，就缩；
   * 真的塞不下（比如 320px 小屏 + 按钮更多）就放弃缩放，让它照旧换行，
   * 免得把字挤到看不清。
   *
   * 用 zoom 而不是 transform: scale() —— transform 不改变布局盒尺寸，
   * 视觉上缩小了但占位还是原样，该溢出还是溢出。
   */
  const TOPBAR_MIN_SCALE = 0.75;

  function fitTopbar() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const controls = bar.querySelector(".topbar__controls");
    if (!controls) return;

    // 每次先复位再测量，否则上一轮的 zoom 会把"自然宽度"也算进去
    controls.style.zoom = "";
    controls.style.flexWrap = "nowrap";

    const barStyle = getComputedStyle(bar);
    const paddingX =
      (parseFloat(barStyle.paddingLeft) || 0) + (parseFloat(barStyle.paddingRight) || 0);
    const gap = parseFloat(barStyle.columnGap) || parseFloat(barStyle.gap) || 12;
    const title = bar.querySelector(".topbar__title") || bar.querySelector("h1");
    const titleWidth = title ? title.getBoundingClientRect().width : 0;

    const available = bar.clientWidth - paddingX - titleWidth - gap;
    if (available <= 0) return;

    // 按钮都是 M3E 组件（含 shadow DOM），scrollWidth 已经把它们算进去
    const needed = controls.scrollWidth;
    if (!needed || needed <= available) return;

    const scale = available / needed;
    if (scale < TOPBAR_MIN_SCALE) {
      // 缩到 75% 也放不下（比如 320px 小屏 + 标题本来就长）：
      // 不硬缩，改回换行。这里必须显式写 "wrap" —— CSS 里
      // .topbar__controls 本身是 nowrap，清空内联样式只会恢复 nowrap，
      // 结果控件区照样撑出顶栏右边界。
      controls.style.flexWrap = "wrap";
      return;
    }
    controls.style.zoom = String(scale);
  }

  /** 节流：一帧只量一次，避免 resize 时反复重排 */
  let topbarFitQueued = false;
  function queueTopbarFit() {
    if (topbarFitQueued) return;
    topbarFitQueued = true;
    requestAnimationFrame(() => {
      topbarFitQueued = false;
      fitTopbar();
    });
  }

  function setupTopbarFit() {
    queueTopbarFit();
    window.addEventListener("resize", queueTopbarFit);
    window.addEventListener("orientationchange", queueTopbarFit);

    // 顶栏按钮是各页面脚本异步填进去的（还有登录后才显示的按钮），
    // 所以内容一变就要重算。只盯 childList、不盯 attributes ——
    // 否则我们自己写 zoom 就会触发回调，来回打转。
    const bar = document.querySelector(".topbar");
    if (bar && "MutationObserver" in window) {
      new MutationObserver(queueTopbarFit).observe(bar, {
        childList: true,
        subtree: true,
      });
    }
    // 字体加载完宽度会变，补一枪
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueTopbarFit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupTopbarFit, { once: true });
  } else {
    setupTopbarFit();
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
    fatal,
    withTimeout,
    sanitizeHtml,
    escapeHtml,
    openMailto,
    describeAuthError,
    pageUrl,
    roleLabel: (role) => ROLE_LABELS[role] || role,
  };
})();







