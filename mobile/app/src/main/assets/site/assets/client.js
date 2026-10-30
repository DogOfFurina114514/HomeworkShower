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
      // 兼容 /deleted 与 /deleted.html，避免在无后缀地址上反复重定向
      if (!/\/deleted(?:\.html)?$/.test(location.pathname)) location.replace("deleted.html");
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

  /** 未登录直接跳登录页，并记住来路（来路只取页面名，不带扩展名）。 */
  async function requireSession() {
    const session = await getSession();
    if (!session) {
      // 页面名去掉 .html：地址栏和 next 参数都不该带后缀
      const pageName = location.pathname.split("/").pop().replace(/\.html$/, "");
      const next = encodeURIComponent(pageName + location.search);
      // 登录页同样走 pageUrl，否则地址栏会显示 /login.html
      location.replace(`${pageUrl("login")}?next=${next}`);
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
   * 顶栏按钮的排布策略：**先换行，两行都放不下才缩小**（最多缩到 75%）。
   *
   *   1 行放得下  → 保持原样
   *   1 行放不下  → 直接换成两行（不缩放，按钮保持自然大小）
   *   两行还放不下（排到第 3 行去了）→ 等比缩小，目标是压回两行，下限 75%
   *
   * 为什么缩放放最后：字体缩到 75% 之后可读性明显下降，
   * 而多一行只是占一点纵向空间。能靠换行解决就别缩字。
   *
   * 用 zoom 而不是 transform: scale() —— transform 不改变布局盒尺寸，
   * 视觉上缩小了但占位照旧，该溢出还是溢出。
   */
  const TOPBAR_MIN_SCALE = 0.75;
  const TOPBAR_MAX_ROWS = 2;

  /**
   * 数整个顶栏排了几行。
   *
   * 不能只数 .topbar__controls 内部 —— 标题（"XXXX · 共 N 条作业"）自己也占一行，
   * 所以 390px 下"标题一行 + 按钮一行"已经是 2 行（允许的上限，不缩放），
   * 而 320px 下"标题一行 + 按钮两行"是 3 行，才该缩。
   */
  function countBarRows(bar) {
    const items = [];
    const title = bar.querySelector(".topbar__title") || bar.querySelector("h1");
    if (title && title.offsetParent !== null) items.push(title);
    const controls = bar.querySelector(".topbar__controls");
    if (controls) {
      for (const child of controls.children) {
        if (child.offsetParent !== null) items.push(child);
      }
    }
    const tops = [];
    for (const item of items) {
      const top = Math.round(item.getBoundingClientRect().top);
      if (!tops.some((t) => Math.abs(t - top) < 4)) tops.push(top);
    }
    return tops.length;
  }

  function fitTopbar() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const controls = bar.querySelector(".topbar__controls");
    if (!controls) return;

    // 每次先复位再测量，否则上一轮的 zoom 会被算进"自然尺寸"
    controls.style.zoom = "";
    controls.style.flexWrap = ""; // 交回 CSS（.topbar__controls 是 wrap）

    // 一行或两行都算正常 —— 单行放不下就直接换行，按钮保持自然大小
    if (countBarRows(bar) <= TOPBAR_MAX_ROWS) return;

    // 已经排到第 3 行：把按钮区压回单行，整体就回到两行
    const visible = [...controls.children].filter((c) => c.offsetParent !== null);
    if (!visible.length) return;

    const style = getComputedStyle(controls);
    const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 8;
    const totalWidth =
      visible.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0) +
      (visible.length - 1) * gap;
    const available = controls.clientWidth;
    if (!available || !totalWidth) return;

    const scale = available / totalWidth;
    if (scale >= 1) return; // 其实放得下（测量误差），不缩

    controls.style.zoom = String(Math.max(TOPBAR_MIN_SCALE, scale));
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

  /**
   * 把依赖视口定位、或会凭空撑高布局的浮层挪到 document.body。
   *
   * 两个原因：
   *   1. 展开底栏时框架被 translateY 顶起，而 transform 会让它成为内部
   *      position:fixed 元素的包含块 —— 灯箱（fixed inset:0）留在框架里，
   *      底栏一展开它就跟着往上飘、四周漏出背景。
   *   2. m3e-dialog 的 host 是 display:contents，它的 light DOM 内容
   *      （.edit-form 等）会直接参与父级布局 —— 即使对话框是关闭的。
   *      首页有八个对话框，实测凭空把框架撑高 561px：
   *      内容明明已经展示全了，页面却还能往下滚一大段空白。
   *
   * 挪到 body 就与框架无关：既不撑高滚动区，也不会被 transform 牵连。
   * 主题变量挂在 :root 上（已验证），移出 m3e-theme 后取色不受影响。
   */
  function moveFixedOverlaysToBody() {
    for (const id of ["image-lightbox"]) {
      const el = document.getElementById(id);
      if (el && el.parentElement !== document.body) document.body.appendChild(el);
    }
    for (const dialog of document.querySelectorAll("m3e-dialog")) {
      if (dialog.parentElement !== document.body) document.body.appendChild(dialog);
    }
  }

  /**
   * 底栏抽屉：把整个框架顶上去。
   *
   * 交互（按需求实现）：
   *   · 页面本身不滚，滚动发生在框架（m3e-theme）内部，配一条自绘滚动条
   *   · 框架滚到底 + 继续往下滑 → 底栏从视口下方滑入，框架整体 translateY 上移
   *     （是刚性位移、含标题栏一起上去，不是内容被压缩）
   *   · 底栏展开时往上滑 → 先收起底栏；收起之后才轮到框架滚动
   *   · 右下角按钮与滚动条轨道跟着底栏边缘同步移动（同一个 --footer-shift 值、
   *     同时长同曲线），所以是被"顶着走"而不是各飞各的
   */
  /**
   * 主内容底部余量按需保留。
   *
   * main 有 padding-bottom:96px，本意是让右下角那个悬浮编辑按钮不压住最后一行作业。
   * 但内容本来就少、最后一行离按钮还远时，这 96px 会变成"没有内容却还能往下滚"
   * 的空滚，还会让自绘滚动条凭空出现 —— 用户看到的就是"我都展示全了为什么要滚动"。
   * 宽屏多列一行放完时尤其明显。
   *
   * 阈值刻意用"框架可视底 − 余量"这种静态算法，而不是去读按钮的实时位置：
   * 底栏展开时按钮会跟着上移，若以它为基准，padding 会在展开瞬间变化、引发布局抖动。
   */
  function tuneBoardBottomGutter() {
    const frame = document.querySelector("body > m3e-theme");
    const board = frame && frame.querySelector(":scope > main");
    if (!board) return;

    const base = 24; // 与 .homework-board 原本的上下内边距一致
    const room = 96; // 按钮 80px + 一点呼吸

    // 真实内容底部：只看 main 的子元素，不含它自己的 padding
    let contentBottom = 0;
    for (const el of board.children) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) contentBottom = Math.max(contentBottom, r.bottom);
    }
    if (!contentBottom) return;

    const frameBottom = frame.getBoundingClientRect().bottom;
    // 内容底边已经伸到"按钮会占的那一排"（框架底往上 96px 以内）→ 需要余量
    const needsRoom = contentBottom > frameBottom - room;
    const next = needsRoom ? `${room}px` : `${base}px`;
    if (board.style.paddingBottom !== next) board.style.paddingBottom = next;
  }

  function setupLicenseFooterDrawer() {
    const footer = document.querySelector("body > .license-footer");
    const frame = document.querySelector("body > m3e-theme");
    if (!footer || !frame) return;

    // 观察这个元素的高度变化来重算余量与滚动条（main 里没有内容时它也会变）
    const boardHost = frame.querySelector(":scope > main") || frame;

    // 由 JS 加类来启用抽屉布局（而不是 CSS :has）——
    // :has 在旧浏览器不支持时，框架不会变成滚动容器，
    // 而底栏是 fixed + translateY(100%) 收在视口下方，许可证就永远看不见了。
    document.body.classList.add("footer-drawer");

    let open = false;
    let animating = false;
    let animTimer = 0;

    // 底栏是 fixed 且用 translateY 收起，所以任何时候都能量到真实高度
    const footerHeight = () => Math.round(footer.offsetHeight);

    const setOpen = (next) => {
      if (next === open) return;
      open = next;
      const h = open ? footerHeight() : 0;
      // 只写这一个变量：框架位移、按钮抬升、滚动条轨道缩短都由它派生。
      // 挂在 documentElement 而不是 body —— 右下角按钮会被 board.js 挪到
      // document.body 下，父级不固定，挂在根上才能保证一定继承得到。
      document.documentElement.style.setProperty("--footer-shift", `${h}px`);
      footer.classList.toggle("is-open", open);
      animating = true;
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(() => {
        animating = false;
        updateScrollbar();
      }, 340);
      updateScrollbar();
    };

    /* ------------------------------------------------- 自绘滚动条 */

    const bar = document.createElement("div");
    bar.className = "frame-scrollbar";
    const thumb = document.createElement("div");
    thumb.className = "frame-scrollbar__thumb";
    bar.appendChild(thumb);
    document.body.appendChild(bar);

    function updateScrollbar() {
      const scrollable = frame.scrollHeight - frame.clientHeight;
      if (scrollable <= 1) {
        bar.classList.remove("is-visible");
        return;
      }
      // 轨道长度固定，不扣底栏高度 —— 向上平移交给 CSS 的
      // transform: translateY(-var(--footer-shift)) 做整条刚体位移。
      // 之前这里还减着 shift（缩短轨道的旧模型留下的），
      // 于是展开底栏时可用轨道被凭空砍短一截，thumb 按变短的比例算出更小的 top，
      // 看起来就是"跳到了最上面"，收起时 shift 归零又掉回来。
      const track = window.innerHeight - 16;
      const ratio = frame.clientHeight / frame.scrollHeight;
      const thumbH = Math.max(32, Math.round(track * ratio));
      const progress = frame.scrollTop / scrollable;
      thumb.style.height = `${thumbH}px`;
      thumb.style.top = `${8 + Math.round(progress * (track - thumbH))}px`;
      bar.classList.add("is-visible");
    }

    /* ------------------------------------------------- 滚动手势接力 */

    const atFrameBottom = () =>
      frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 1;

    /**
     * 一次滚动的归属判定（滚轮与触屏共用，delta 正数 = 想看下面的内容）。
     * 返回 true 表示这次滚动被抽屉吃掉、不该再传给浏览器原生滚动。
     *
     * 优先级按需求来：底栏开着的时候，向上滚**先用来收起底栏**，
     * 收起之后才轮到框架滚动 —— 所以这里不再附加"框架必须已滚到顶"之类的条件。
     */
    const handleWheel = (delta, src) => {
      if (animating) return true;
      const down = delta > 0;

      if (open) {
        // 底栏内容超过 70vh 时它自己能滚；先让内部滚到边界，再谈收起
        const footerScrollable = footer.scrollHeight - footer.clientHeight > 1;
        if (footerScrollable && src === footer) {
          if (down) {
            // 底栏内部已滚到底：再向下滚没意义，吃掉
            return footer.scrollTop + footer.clientHeight >= footer.scrollHeight - 1;
          }
          if (footer.scrollTop <= 0) {
            // 底栏内部已在顶部：向上滚 = 收起底栏
            setOpen(false);
            return true;
          }
          return false; // 交给底栏自己滚
        }
        if (down) return true; // 展开状态下框架本就贴底，向下滚没意义
        setOpen(false);
        return true;
      }

      // 收起状态：只有框架已滚到底、且继续向下滚，才拉出底栏
      if (down && atFrameBottom()) {
        setOpen(true);
        return true;
      }
      return false;
    };

    const bindWheel = (el) => {
      el.addEventListener(
        "wheel",
        (event) => {
          if (handleWheel(event.deltaY, el)) event.preventDefault();
        },
        { passive: false }
      );
    };
    bindWheel(frame);
    bindWheel(footer); // 底栏展开后鼠标常停在它上面，收不起来的问题就出在漏了这条

    // 触屏（手机上 wheel 不触发，必须单独接）
    let touchY = 0;
    let touchHandled = false;
    const bindTouch = (el) => {
      el.addEventListener(
        "touchstart",
        (event) => {
          touchY = event.touches[0].clientY;
          touchHandled = false;
        },
        { passive: true }
      );
      el.addEventListener(
        "touchmove",
        (event) => {
          if (animating) {
            event.preventDefault();
            return;
          }
          const dy = touchY - event.touches[0].clientY; // >0 = 手指上滑 = 想看下面
          if (Math.abs(dy) < 6 || touchHandled) return;
          if (handleWheel(dy, el)) {
            touchHandled = true;
            event.preventDefault();
          }
        },
        { passive: false }
      );
    };
    bindTouch(frame);
    bindTouch(footer);

    /* ------------------------------------------------- 尺寸变化 */

    frame.addEventListener("scroll", updateScrollbar, { passive: true });
    footer.addEventListener("scroll", updateScrollbar, { passive: true });
    window.addEventListener("resize", () => {
      // 底栏 max-height 是 70vh，视口变化时它的高度也会变，位移量得重算
      if (open) {
        document.documentElement.style.setProperty("--footer-shift", `${footerHeight()}px`);
      }
      tuneBoardBottomGutter();
      updateScrollbar();
    });

    // 作业卡片、公告栏是异步渲染的：内容高度一变，先重算底部余量，
    // 再更新滚动条（顺序反了会用旧高度算出新滚动条，闪一下）
    const relayout = () => {
      tuneBoardBottomGutter();
      updateScrollbar();
    };
    if ("ResizeObserver" in window) {
      new ResizeObserver(relayout).observe(boardHost || frame);
    }
    if ("MutationObserver" in window) {
      // 卡片被移除时框架高度未必变（padding 补上了），但内容底部会变
      new MutationObserver(relayout).observe(boardHost || frame, {
        childList: true,
        subtree: true,
      });
    }

    relayout();
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
    document.addEventListener("DOMContentLoaded", () => {
      setupTopbarFit();
      moveFixedOverlaysToBody();
      setupLicenseFooterDrawer();
    }, { once: true });
  } else {
    setupTopbarFit();
    moveFixedOverlaysToBody();
    setupLicenseFooterDrawer();
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

  /**
   * 点弹窗外面不关闭。
   *
   * m3e-dialog 带 dismissible 属性时，点背景会直接把它关掉 ——
   * 编辑作业时在内容区选中文本，鼠标很容易划出弹窗边框，一松手落在背景上，
   * 刚编辑的东西连弹窗一起没了。
   *
   * ⚠ 判定必须用 composedPath()[0]（真实目标），不能用 event.target：
   *   M3E 把右上角那个 X 关闭按钮画在自己的 shadow DOM 里
   *   （dialog.base > div.header > m3e-icon-button.close），
   *   事件穿出 shadow 边界时 event.target 会被重定向成宿主 m3e-dialog，
   *   于是点 X 也被当成"点背景"拦掉 —— 关闭按钮就再也关不掉弹窗了。
   *   而真正点遮罩时，原生 <dialog> 的 ::backdrop 事件目标就是 dialog 元素本身，
   *   所以"真实目标是 DIALOG 元素"才是"点了外面"的准确特征。
   *
   * 刻意不去删 dismissible —— 那是 M3E 管 Esc 关闭的开关之一，
   * 删了键盘用户就没法关窗。这里只挡背景，Esc 照旧。
   */
  function blockBackdropClose(event) {
    const target = event.target;
    if (!target || target.nodeType !== 1) return; // 只处理元素节点
    if (target.tagName !== "M3E-DIALOG") return; // 事件被重定向到宿主，才可能是背景

    const path = typeof event.composedPath === "function" ? event.composedPath() : null;
    const real = path && path.length ? path[0] : null;
    if (!real || real.nodeType !== 1) return;
    if (real.tagName !== "DIALOG") return; // 点在弹窗内部元素上（X 按钮、内容、按钮）→ 放行

    // 计数器：用于确认这条拦截确实被触发过（排查时有用，平时不显示）
    window.__hsBackdropBlocked = (window.__hsBackdropBlocked || 0) + 1;
    event.stopPropagation();
    event.preventDefault();
  }
  document.addEventListener("pointerdown", blockBackdropClose, true);
  document.addEventListener("mousedown", blockBackdropClose, true);
  document.addEventListener("click", blockBackdropClose, true);
})();







