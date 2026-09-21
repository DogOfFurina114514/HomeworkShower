/**
 * 登录 / 注册 / 邮箱验证
 *
 * 重点：
 * - 登录未验证的账号时用自绘弹窗提示，并允许原地重发验证邮件；
 * - 弹窗开启时锁住背景（inert）、Tab 在弹窗内循环、Esc 关闭、关闭后焦点归还；
 * - 登录/注册 tab 支持左右方向键切换（role=tab 的标准键盘行为）。
 */
(function () {
  const { client } = hs;

  const loginTab = document.getElementById("tab-login");
  const registerTab = document.getElementById("tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const messageEl = document.getElementById("message");
  const resendBox = document.getElementById("resend-box");
  const resendButton = document.getElementById("resend-button");
  const resendEmail = document.getElementById("resend-email");
  const panes = document.getElementById("auth-panes");
  const authCard = document.querySelector(".auth__card");

  const verifyModal = document.getElementById("verify-modal");
  const verifyCard = verifyModal.querySelector(".modal__card");
  const verifyEmailEl = document.getElementById("verify-email");
  const verifyMessage = document.getElementById("verify-message");
  const verifyResend = document.getElementById("verify-resend");
  const verifyClose = document.getElementById("verify-close");

  const nextUrl = (() => {
    const next = new URLSearchParams(location.search).get("next");
    if (!next) return "index.html";
    // 只允许站内相对页面，避免被拼出站外跳转
    return /^[\w.-]+\.html(\?[^#]*)?$/.test(next) ? next : "index.html";
  })();

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function showMessage(text, isError = true) {
    messageEl.textContent = text;
    messageEl.classList.toggle("status--error", isError);
    messageEl.hidden = !text;
  }

  function showVerifyMessage(text, isError = true) {
    verifyMessage.textContent = text;
    verifyMessage.classList.toggle("status--error", isError);
    verifyMessage.hidden = !text;
  }

  function isEmailUnverifiedError(error) {
    if (!error) return false;
    const code = String(error.code || "").toLowerCase();
    const text = String(error.message || "").toLowerCase();
    return code === "email_not_confirmed" || text.includes("email not confirmed") || text.includes("not confirmed");
  }

  // ---------------- 登录 / 注册面板切换（easeOutQuart 由 CSS 提供） ----------------

  function switchTab(mode, animate = true) {
    const isLogin = mode === "login";
    const show = isLogin ? loginForm : registerForm;
    const hide = isLogin ? registerForm : loginForm;

    loginTab.classList.toggle("primary", isLogin);
    registerTab.classList.toggle("primary", !isLogin);
    loginTab.setAttribute("aria-selected", String(isLogin));
    registerTab.setAttribute("aria-selected", String(!isLogin));
    loginTab.tabIndex = isLogin ? 0 : -1;
    registerTab.tabIndex = isLogin ? -1 : 0;
    resendBox.hidden = true;
    showMessage("");

    if (show === hide || show.classList.contains("is-active")) return;

    if (!animate) {
      show.classList.add("is-active");
      hide.classList.remove("is-active");
      panes.style.height = "";
      return;
    }

    const from = panes.offsetHeight;
    show.classList.add("is-active");
    hide.classList.remove("is-active");
    const to = panes.offsetHeight;

    panes.style.height = `${from}px`;
    requestAnimationFrame(() => {
      panes.style.height = `${to}px`;
    });
    window.setTimeout(() => {
      panes.style.height = "";
    }, 320);
  }

  function tabKeyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const isLogin = loginForm.classList.contains("is-active");
    const nextIsLogin = event.key === "ArrowLeft" || event.key === "Home" ? true : event.key === "ArrowRight" || event.key === "End" ? false : !isLogin;
    switchTab(nextIsLogin ? "login" : "register");
    (nextIsLogin ? loginTab : registerTab).focus();
  }

  loginTab.addEventListener("click", () => switchTab("login"));
  registerTab.addEventListener("click", () => switchTab("register"));
  loginTab.addEventListener("keydown", tabKeyboard);
  registerTab.addEventListener("keydown", tabKeyboard);

  // ---------------- 未验证邮箱弹窗 ----------------

  let lastFocused = null;

  function focusableInModal() {
    return Array.from(verifyModal.querySelectorAll(FOCUSABLE)).filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0);
  }

  function onModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeVerifyModal();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableInModal();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !verifyCard.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !verifyCard.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openVerifyModal(email) {
    lastFocused = document.activeElement;
    verifyEmailEl.textContent = email;
    verifyResend.disabled = false;
    showVerifyMessage("");
    verifyModal.hidden = false;
    // 背景整体不可聚焦，Tab 只能在弹窗内走
    if (authCard) authCard.inert = true;
    document.addEventListener("keydown", onModalKeydown, true);
    verifyResend.focus();
  }

  function closeVerifyModal() {
    verifyModal.hidden = true;
    if (authCard) authCard.inert = false;
    document.removeEventListener("keydown", onModalKeydown, true);
    if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
    else loginForm.querySelector("input")?.focus();
  }

  verifyClose.addEventListener("click", closeVerifyModal);
  verifyModal.addEventListener("click", (event) => {
    if (event.target === verifyModal) closeVerifyModal();
  });

  verifyResend.addEventListener("click", async () => {
    const email = verifyEmailEl.textContent.trim();
    if (!email) {
      showVerifyMessage("没有拿到邮箱地址，请返回上一页重新登录。");
      return;
    }
    verifyResend.disabled = true;
    showVerifyMessage("正在发送…", false);

    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: new URL("index.html", location.href).href },
    });

    verifyResend.disabled = false;
    if (error) {
      const text = String(error.message || "").toLowerCase();
      showVerifyMessage(
        text.includes("rate limit") || text.includes("too many")
          ? "发送太频繁了，请等一分钟再试。"
          : `发送失败：${error.message}`,
      );
      return;
    }
    showVerifyMessage("验证邮件已重新发送，请查收（也看看垃圾箱）。", false);
    verifyResend.blur();
    verifyClose.focus();
  });

  // ---------------- 表单提交 ----------------

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    showMessage("正在登录…", false);

    const { error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      if (isEmailUnverifiedError(error)) {
        showMessage("");
        openVerifyModal(email);
        return;
      }
      const text = String(error.message || "").toLowerCase();
      showMessage(
        text.includes("invalid login credentials")
          ? "邮箱或密码不正确；如果刚注册，请先完成邮箱验证。"
          : `登录失败：${error.message}`,
      );
      return;
    }
    location.replace(nextUrl);
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = registerForm.email.value.trim();
    const password = registerForm.password.value;
    const confirm = registerForm.confirm.value;

    if (password.length < 8) {
      showMessage("密码至少 8 位。");
      return;
    }
    if (password !== confirm) {
      showMessage("两次输入的密码不一致。");
      return;
    }

    showMessage("正在提交注册…", false);
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL("index.html", location.href).href },
    });

    if (error) {
      showMessage(
        String(error.message || "").toLowerCase().includes("already registered")
          ? "这个邮箱已经注册过了，直接登录即可；没收到验证邮件的话可以在下面重发。"
          : `注册失败：${error.message}`,
      );
      return;
    }

    if (data.session) {
      location.replace(nextUrl);
      return;
    }

    showMessage("注册成功，验证邮件已发送，请到邮箱点开链接完成验证。", false);
    resendEmail.value = email;
    resendBox.hidden = false;
  });

  resendButton.addEventListener("click", async () => {
    const email = resendEmail.value.trim();
    if (!email) {
      showMessage("请先填写邮箱。");
      return;
    }
    showMessage("正在重发…", false);
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: new URL("index.html", location.href).href },
    });
    showMessage(
      error ? `重发失败：${error.message}` : "验证邮件已重新发送，请稍等一两分钟查收（也看看垃圾箱）。",
      Boolean(error),
    );
  });

  // ---------------- 启动 ----------------

  void (async () => {
    const session = await hs.getSession();
    if (session) {
      location.replace(nextUrl);
      return;
    }
    // 从邮件链接点回来时，Supabase 把令牌放在地址栏 hash 里，客户端会自动建立会话
    client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_IN" && nextSession) location.replace(nextUrl);
    });
    switchTab("login", false);
  })();
})();
