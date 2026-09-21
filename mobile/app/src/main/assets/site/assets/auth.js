/**
 * 邮箱验证落地页（邮件里的链接验证完成后会跳到这里）
 * 正常情况：显示「验证成功」，并说明已经自动登录。
 * 链接过期或出错时：显示具体原因。
 */
(function () {
  const { client } = hs;
  const titleEl = document.getElementById("auth-title");
  const hintEl = document.getElementById("auth-hint");
  const continueButton = document.getElementById("auth-continue");

  if (continueButton) continueButton.addEventListener("click", () => location.assign("index.html"));

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(location.search);
  const errorCode = queryParams.get("error_code") || hashParams.get("error_code");
  const errorDescription = queryParams.get("error_description") || hashParams.get("error_description");

  function showError(message) {
    titleEl.textContent = "验证没有完成";
    hintEl.textContent = message;
    hintEl.classList.add("status--error");
  }

  if (errorCode) {
    const friendly =
      errorCode === "otp_expired"
        ? "这个验证链接已经过期了，请回到登录页点「重新发送验证邮件」。"
        : `验证失败：${(errorDescription || errorCode).replace(/\+/g, " ")}`;
    showError(friendly);
    return;
  }

  let settled = false;

  function succeed(email) {
    if (settled) return;
    settled = true;
    titleEl.textContent = "验证成功";
    hintEl.classList.remove("status--error");
    hintEl.textContent = email ? `${email} 已验证，并且已经自动登录，可以直接查看作业了。` : "邮箱已验证，现在可以查看作业了。";
  }

  // 客户端会自动解析地址栏里的令牌并建立会话，这里等它一下
  client.auth.onAuthStateChange((event, session) => {
    if (session) succeed(session.user?.email);
  });

  void (async () => {
    for (let attempt = 0; attempt < 10 && !settled; attempt += 1) {
      const { data } = await client.auth.getSession();
      if (data.session) {
        succeed(data.session.user?.email);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!settled) {
      // 没有令牌也没有会话：多半是直接打开了这个页面
      hintEl.textContent = "邮箱验证已经完成。如果你刚刚点过邮件里的链接，现在可以回到看板登录了。";
    }
  })();
})();
