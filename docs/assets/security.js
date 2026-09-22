/**
 * 安全中心：更改邮箱 / 更改密码
 *
 * 两条流程都走 Supabase 官方接口，都需要先在邮箱里确认：
 *   - 更改邮箱：updateUser({ email })，Supabase 会向新旧邮箱各发一封确认信，
 *     两端都确认后才真正生效，所以"修改前必须验证邮箱"是平台保证的；
 *   - 更改密码：resetPasswordForEmail(当前邮箱)，走官方恢复链接，
 *     点开邮件后才设置新密码（落地页是 auth.html）。
 *
 * 旧邮箱不可用时，页面提供申诉入口：显示自己的邮箱 + 一键唤起邮件应用。
 */
(function () {
  const { client } = hs;

  const emailField = document.getElementById("current-email");
  const newEmailInput = document.getElementById("new-email");
  const changeEmailButton = document.getElementById("change-email");
  const emailMessage = document.getElementById("email-message");
  const emailPending = document.getElementById("email-pending");
  const resendButton = document.getElementById("resend-email");
  const appealButton = document.getElementById("appeal");

  const newPasswordInput = document.getElementById("new-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const changePasswordButton = document.getElementById("change-password");
  const passwordMessage = document.getElementById("password-message");

  let profile = null;
  let pendingEmail = "";

  function show(el, text, isError = true) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("status--error", isError);
    el.hidden = !text;
  }

  /** 旧邮箱不可用时的申诉：与「申请管理员」同一套界面逻辑 */
  function openAppeal() {
    const oldEmail = profile?.email || "（未获取到）";
    const dialog = document.createElement("div");
    dialog.className = "backdrop open";
    dialog.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>旧邮箱不可用申诉</h3>
        <div class="form-row">
          <span>我的邮箱（旧）</span>
          <input readonly value="${hs.escapeHtml(oldEmail)}" />
        </div>
        <p class="hint">
          如果旧邮箱已经无法登录、收不到验证邮件，可以给管理员发一封申诉邮件，
          说明情况并附上可用的新邮箱，管理员核实后会帮你处理。
        </p>
        <div class="dialog-actions">
          <button class="pill text" data-act="close">关闭</button>
          <button class="pill primary" data-act="mail">打开「电子邮件」</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const close = () => dialog.remove();
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) return close();
      const action = event.target.closest("[data-act]")?.dataset.act;
      if (action === "close") return close();
      if (action === "mail") {
        const to = hs.config.adminEmail || "";
        const subject = "邮箱不可用申诉";
        const body = [
          "你好，我的账号旧邮箱已经无法使用，无法自行修改邮箱，申请协助。",
          "",
          `账号（旧邮箱）：${oldEmail}`,
          `申请时间：${new Date().toLocaleString("zh-CN")}`,
          "",
          "可用的新邮箱：",
        ].join("\n");
        location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
    });
  }

  async function changeEmail() {
    const next = (newEmailInput?.value || "").trim();
    if (!next) return show(emailMessage, "请填写新的邮箱地址。");
    if (profile && next.toLowerCase() === String(profile.email || "").toLowerCase()) {
      return show(emailMessage, "新邮箱和当前邮箱相同，无需修改。");
    }

    changeEmailButton.setAttribute("disabled", "");
    show(emailMessage, "正在发送验证邮件…", false);
    const { error } = await client.auth.updateUser({ email: next });
    changeEmailButton.removeAttribute("disabled");

    if (error) {
      const text = String(error.message || "").toLowerCase();
      show(
        emailMessage,
        text.includes("already") ? "这个邮箱已经被其它账号使用了。" : `发送失败：${error.message}`,
      );
      return;
    }

    // A 方案：明确显示"等待确认"，并允许重发；旧邮箱在此之前仍然可用
    pendingEmail = next;
    show(emailMessage, "");
    if (resendButton) resendButton.hidden = false;
    if (emailPending) {
      emailPending.hidden = false;
      emailPending.textContent = `已向 ${next} 发送验证邮件：请点开邮件里的链接完成确认。` +
        `在确认完成之前，当前邮箱 ${profile?.email || ""} 仍然可以正常使用。`;
    }
  }

  async function resendEmail() {
    if (!pendingEmail) return;
    resendButton.setAttribute("disabled", "");
    const { error } = await client.auth.updateUser({ email: pendingEmail });
    resendButton.removeAttribute("disabled");
    show(emailMessage, error ? `重发失败：${error.message}` : "验证邮件已重新发送，请查收（也看看垃圾箱）。", Boolean(error));
  }

  async function changePassword() {
    const next = newPasswordInput?.value || "";
    const confirm = confirmPasswordInput?.value || "";
    if (next.length < 8) return show(passwordMessage, "密码至少 8 位。");
    if (next !== confirm) return show(passwordMessage, "两次输入的密码不一致。");

    changePasswordButton.setAttribute("disabled", "");
    show(passwordMessage, "正在发送验证邮件…", false);
    const redirectTo = new URL("auth.html", location.href).href;
    const { error } = await client.auth.resetPasswordForEmail(profile?.email || "", { redirectTo });
    changePasswordButton.removeAttribute("disabled");

    show(
      passwordMessage,
      error ? `发送失败：${error.message}` : `确认邮件已发送到 ${profile?.email || "你的邮箱"}，点开邮件里的链接后即可设置新密码。`,
      Boolean(error),
    );
  }

  void (async () => {
    const session = await hs.requireSession();
    if (!session) return;

    profile = await hs.getProfile();
    if (!profile) return;
    if (emailField) emailField.value = profile.email || "";
    document.getElementById("account-email")?.replaceChildren(document.createTextNode(profile.email || ""));

    changeEmailButton.addEventListener("click", () => void changeEmail());
    resendButton?.addEventListener("click", () => void resendEmail());
    appealButton?.addEventListener("click", openAppeal);
    changePasswordButton.addEventListener("click", () => void changePassword());
  })();
})();

