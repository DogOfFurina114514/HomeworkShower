/**
 * 登录 / 注册 / 邮箱验证
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

  const nextUrl = (() => {
    const next = new URLSearchParams(location.search).get("next");
    if (!next) return "index.html";
    // 只允许站内相对页面，避免被拼出站外跳转
    return /^[\w.-]+\.html(\?[^#]*)?$/.test(next) ? next : "index.html";
  })();

  function showMessage(text, isError = true) {
    messageEl.textContent = text;
    messageEl.classList.toggle("status--error", isError);
    messageEl.hidden = !text;
  }

  function switchTab(mode) {
    const isLogin = mode === "login";
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    loginTab.classList.toggle("primary", isLogin);
    registerTab.classList.toggle("primary", !isLogin);
    resendBox.hidden = true;
    showMessage("");
  }

  loginTab.addEventListener("click", () => switchTab("login"));
  registerTab.addEventListener("click", () => switchTab("register"));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    showMessage("正在登录…", false);

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      const text = error.message.toLowerCase();
      showMessage(
        text.includes("invalid login credentials")
          ? "邮箱或密码不正确；如果刚注册，请先点开验证邮件完成验证。"
          : text.includes("email not confirmed")
            ? "邮箱还未验证，请先点开验证邮件里的链接。"
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
        error.message.toLowerCase().includes("already registered")
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
    switchTab("login");
  })();
})();
