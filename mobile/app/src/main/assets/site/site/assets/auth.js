/*
 * 邮件验证落地页
 *
 * Supabase 把结果放在 URL 的 hash 里，所以成功与失败可以直接从地址判断：
 *   成功： .../auth.html#access_token=...&type=signup
 *   失败： .../auth.html#error=access_denied&error_code=otp_expired&error_description=...
 * 没有 hash 时说明是直接打开这个页面（中性提示）。
 */

(function () {
  const { client } = hs;

  const titleEl = document.getElementById("auth-title");
  const hintEl = document.getElementById("auth-hint");
  const continueButton = document.getElementById("auth-continue");
  const resendBox = document.getElementById("auth-resend-box");
  const resendInput = document.getElementById("auth-resend-email");
  const resendButton = document.getElementById("auth-resend-button");
  const messageEl = document.getElementById("auth-message");

  /** 把 hash 解析成键值对（值里的 + 要还原成空格） */
  function readHash() {
    const raw = String(location.hash || "").replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const result = {};
    for (const [key, value] of params.entries()) result[key] = value.replace(/\+/g, " ");
    return result;
  }

  function showMessage(text, isError = true) {
    if (!messageEl) return;
    messageEl.textContent = text;
    messageEl.classList.toggle("status--error", isError);
    messageEl.hidden = !text;
  }

  function setState(title, hint, { success = false, failure = false } = {}) {
    titleEl.textContent = title;
    hintEl.textContent = hint;
    continueButton.textContent = success ? "进入作业看板" : "返回登录";
    continueButton.dataset.target = success ? "index.html" : "login.html";
    document.body.dataset.authState = failure ? "failure" : success ? "success" : "neutral";
  }

  function showFailure(description) {
    setState("验证失败", description || "这个验证链接无法使用，可能已经过期或已经被点过了。", { failure: true });
    if (resendBox) resendBox.hidden = false;
    showMessage("在下面填写你的邮箱，可以重新发一封验证邮件。", false);
  }

  const hash = readHash();
  const errorCode = hash.error_code || hash.error || "";
  const hasToken = Boolean(hash.access_token || hash.token_hash || hash.code || hash.type);

  if (errorCode) {
    // otp_expired / access_denied 等
    const friendly =
      errorCode === "otp_expired"
        ? "验证链接已经过期（验证邮件有效期有限）。重新发一封即可。"
        : hash.error_description || "验证链接失效。";
    showFailure(friendly);
  } else if (hasToken) {
    setState("验证成功", "邮箱已验证，现在可以查看作业了。", { success: true });
    // 让 supabase 把 hash 里的会话落下来，之后跳看板就是已登录状态
    void client.auth.getSession().catch(() => {});
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(null, "", url);
  } else {
    setState("邮箱验证", "如果你刚注册，请点开邮箱里的验证链接；已经验证过就直接登录。");
  }

  continueButton.addEventListener("click", () => {
    location.assign(continueButton.dataset.target || "index.html");
  });

  resendButton?.addEventListener("click", async () => {
    const email = (resendInput?.value || "").trim();
    if (!email) {
      showMessage("请先填写注册时用的邮箱。");
      return;
    }
    resendButton.setAttribute("disabled", "");
    showMessage("正在发送…", false);
    const redirectTo = new URL("auth.html", location.href).href;
    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
    resendButton.removeAttribute("disabled");
    if (error) {
      const text = String(error.message || "").toLowerCase();
      showMessage(
        text.includes("rate limit") || text.includes("too many")
          ? "发送太频繁了，请等一分钟再试。"
          : `发送失败：${error.message}`,
      );
      return;
    }
    showMessage("验证邮件已重新发送，请查收（也看看垃圾箱）。", false);
  });
})();
