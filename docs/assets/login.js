/**
 * 登录 / 注册 / 邮箱验证
 *
 * 组件全部使用 M3E（与桌面端同一套），所以按钮、输入框、对话框的外观天然一致：
 * - 未验证的账号登录时弹出 m3e-dialog 提示，并可在弹窗内重发验证邮件；
 * - 弹窗由组件自身做模态与焦点管理，这里额外兜底：焦点若跑到弹窗外会被拉回，
 *   关闭后焦点归还给打开它的元素；
 * - 登录/注册 tab 支持左右方向键切换（role=tab 的标准键盘行为）。
 */
(function () {
  const { client } = hs;
  const VERIFY_REDIRECT = new URL("auth.html", location.href).href;

  const loginTab = document.getElementById("tab-login");
  const registerTab = document.getElementById("tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginSubmit = document.getElementById("login-submit");
  const registerSubmit = document.getElementById("register-submit");
  const messageEl = document.getElementById("message");
  const resendBox = document.getElementById("resend-box");
  const resendButton = document.getElementById("resend-button");
  const resendEmail = document.getElementById("resend-email");
  const panes = document.getElementById("auth-panes");
  const authCard = document.getElementById("auth-card");

  const verifyDialog = document.getElementById("verify-dialog");
  const verifyEmailEl = document.getElementById("verify-email");
  const verifyMessage = document.getElementById("verify-message");
  const verifyResend = document.getElementById("verify-resend");
  const verifyClose = document.getElementById("verify-close");

  const nextUrl = (() => {
    const next = new URLSearchParams(location.search).get("next");
    if (!next) return "index.html";
    return /^[\w.-]+\.html(\?[^#]*)?$/.test(next) ? next : "index.html";
  })();

  let lastFocused = null;

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

    loginTab.setAttribute("variant", isLogin ? "filled" : "tonal");
    registerTab.setAttribute("variant", isLogin ? "tonal" : "filled");
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
    const goLogin = event.key === "ArrowLeft" || event.key === "Home" ? true : event.key === "ArrowRight" || event.key === "End" ? false : !isLogin;
    switchTab(goLogin ? "login" : "register");
    (goLogin ? loginTab : registerTab).focus();
  }

  loginTab.addEventListener("click", () => switchTab("login"));
  registerTab.addEventListener("click", () => switchTab("register"));
  loginTab.addEventListener("keydown", tabKeyboard);
  registerTab.addEventListener("keydown", tabKeyboard);

  /** 表单里回车即提交（m3e-button 是自定义元素，不是原生 submit 按钮） */
  function submitOnEnter(form, handler) {
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      void handler();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void handler();
    });
  }

  // ---------------- 未验证邮箱弹窗 ----------------

  function focusableInDialog() {
    return Array.from(verifyDialog.querySelectorAll('a[href], button, m3e-button, input, [tabindex]:not([tabindex="-1"])')).filter(
      (element) => !element.hasAttribute("disabled") && (element.offsetWidth > 0 || element.offsetHeight > 0),
    );
  }

  /** 只做兜底：M3E 的对话框自己会锁焦点，这里只在焦点真的跑到弹窗外时把它拉回来。 */
  function onDialogKeydown(event) {
    if (event.key !== "Tab") return;
    const items = focusableInDialog();
    if (!items.length) return;
    if (!verifyDialog.contains(document.activeElement)) {
      event.preventDefault();
      items[0].focus();
    }
  }

  function openVerifyModal(email) {
    lastFocused = document.activeElement;
    verifyEmailEl.textContent = email;
    verifyResend.removeAttribute("disabled");
    showVerifyMessage("");
    if (authCard) authCard.inert = true;
    verifyDialog.show();
    document.addEventListener("keydown", onDialogKeydown, true);
    window.setTimeout(() => verifyResend.focus(), 60);
  }

  function closeVerifyModal() {
    if (authCard) authCard.inert = false;
    document.removeEventListener("keydown", onDialogKeydown, true);
    if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
    else document.getElementById("login-email")?.focus();
  }

  verifyDialog.addEventListener("closed", closeVerifyModal);
  verifyClose.addEventListener("click", () => verifyDialog.hide());

  verifyResend.addEventListener("click", async () => {
    const email = verifyEmailEl.textContent.trim();
    if (!email) {
      showVerifyMessage("没有拿到邮箱地址，请返回上一页重新登录。");
      return;
    }
    verifyResend.setAttribute("disabled", "");
    showVerifyMessage("正在发送…", false);

    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: VERIFY_REDIRECT } });

    verifyResend.removeAttribute("disabled");
    if (error) {
      const text = String(error.message || "").toLowerCase();
      showVerifyMessage(
        text.includes("rate limit") || text.includes("too many") ? "发送太频繁了，请等一分钟再试。" : `发送失败：${error.message}`,
      );
      return;
    }
    showVerifyMessage("验证邮件已重新发送，请查收（也看看垃圾箱）。", false);
    verifyClose.focus();
  });

  // ---------------- 提交逻辑 ----------------

  async function doLogin() {
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
      showMessage(text.includes("invalid login credentials") ? "邮箱或密码不正确；如果刚注册，请先完成邮箱验证。" : `登录失败：${error.message}`);
      return;
    }
    location.replace(nextUrl);
  }

  async function doRegister() {
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
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: VERIFY_REDIRECT } });

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
  }

  submitOnEnter(loginForm, doLogin);
  submitOnEnter(registerForm, doRegister);
  loginSubmit.addEventListener("click", () => void doLogin());
  registerSubmit.addEventListener("click", () => void doRegister());

  resendButton.addEventListener("click", async () => {
    const email = resendEmail.value.trim();
    if (!email) {
      showMessage("请先填写邮箱。");
      return;
    }
    showMessage("正在重发…", false);
    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: VERIFY_REDIRECT } });
    showMessage(error ? `重发失败：${error.message}` : "验证邮件已重新发送，请稍等一两分钟查收（也看看垃圾箱）。", Boolean(error));
  });

  // ---------------- 启动 ----------------

  void (async () => {
    const session = await hs.getSession();
    if (session) {
      location.replace(nextUrl);
      return;
    }
    client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_IN" && nextSession) location.replace(nextUrl);
    });
    switchTab("login", false);
  })();
})();
