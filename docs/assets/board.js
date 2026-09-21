/**
 * 作业看板
 *
 * 两种模式，由 <body data-board-mode="..."> 决定：
 *   latest —— 主界面：只显示最近一次发布里「还没过期」的作业，没有日期筛选
 *   date   —— 时光机：按发布日筛选，看那天发布的整批作业（含已过期）
 *
 * 渲染出的标记与桌面端 HomeworkBoard.vue 一致（m3e-list / m3e-list-action / m3e-chip），
 * 因此外观由同一套 M3E 组件决定。
 * 普通用户只读：界面上不提供修改/删除入口。
 */
(function () {
  const { client } = hs;
  const mode = document.body.dataset.boardMode === "date" ? "date" : "latest";

  const datePicker = document.getElementById("date-picker");
  const latestButton = document.getElementById("latest-button");
  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const accountButton = document.getElementById("account-button");
  const accountPanel = document.getElementById("account-panel");
  const accountEmail = document.getElementById("account-email");
  const accountRole = document.getElementById("account-role");
  const logoutButton = document.getElementById("logout-button");
  const publishLink = document.getElementById("publish-link");
  const timemachineButton = document.getElementById("timemachine-button");
  const backButton = document.getElementById("back-button");
  const accountButtonLabel = document.getElementById("account-button-label");
  const loginBanner = document.getElementById("login-banner");
  const bannerLoginButton = document.getElementById("banner-login-button");

  let availableDates = [];
  let profile = null;
  let selectedId = null;
  let canManage = false;
  let currentRows = [];
  let currentDate = "";

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDateLabel(value) {
    const [y, m, d] = String(value).split("-");
    return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  }

  /** 过期与否以「期限」为准，并用当天日期实时判断，不看发布时写死的标记。 */
  function isExpired(dueDate) {
    if (!dueDate) return false;
    return String(dueDate) < todayString();
  }

  function showStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("status--error", isError);
    statusEl.hidden = !message;
  }

  function renderEmpty(message) {
    boardEl.classList.remove("homework-board--prompt");
    boardEl.innerHTML = `
      <div class="homework-empty-state">
        <m3e-icon variant="outlined" name="assignment"></m3e-icon>
        <m3e-heading variant="title" size="large" level="2">${hs.escapeHtml(message)}</m3e-heading>
      </div>`;
  }

  /** 时光机刚进来时：不加载任何一天，提示居中显示，等用户选日期 */
  function showPickPrompt() {
    boardEl.classList.add("homework-board--prompt");
    boardEl.innerHTML = `
      <div class="homework-empty-state homework-empty-state--prompt">
        <m3e-icon variant="outlined" name="calendar_today"></m3e-icon>
        <m3e-heading variant="title" size="large" level="2">请选择一个日期</m3e-heading>
      </div>`;
    showStatus("");
  }

  function renderBoard(rows) {
    if (!rows.length) {
      renderEmpty(mode === "latest" ? "今天没有需要做的作业" : "这一天没有作业");
      return;
    }
    boardEl.classList.remove("homework-board--prompt");

    const groups = new Map();
    for (const row of rows) {
      const subject = (row.subject || "其它").trim() || "其它";
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push(row);
    }

    const sections = [];
    for (const [subject, homeworks] of groups) {
      const items = homeworks.map((homework) => {
        const content = homework.content_html
          ? hs.sanitizeHtml(homework.content_html)
          : hs.escapeHtml(homework.content).replace(/\n/g, "<br>");
        const expired = isExpired(homework.due_date);
        const selected = selectedId === homework.id;
        const tags = (homework.tags || []).length
          ? `<div slot="supporting-text" class="homework-tags">${homework.tags
              .map((tag) => `<m3e-chip variant="outlined">${hs.escapeHtml(tag)}</m3e-chip>`)
              .join("")}</div>`
          : "";
        // 只有发布者/管理员、且看的是当天，才在选中后给出修改与删除
        const actions = selected && canManage
          ? `<div slot="supporting-text" class="homework-actions">
              <m3e-icon-button data-action="edit" data-id="${homework.id}" aria-label="修改作业" title="修改作业"><m3e-icon variant="outlined" name="edit"></m3e-icon></m3e-icon-button>
              <m3e-icon-button data-action="delete" data-id="${homework.id}" aria-label="删除作业" title="删除作业"><m3e-icon variant="outlined" name="delete"></m3e-icon></m3e-icon-button>
            </div>`
          : "";
        return `
          <m3e-list-action class="homework-item${expired ? " homework-item--expired" : ""}${selected ? " homework-item--selected" : ""}${canManage ? " homework-item--clickable" : ""}" data-id="${homework.id}">
            <span class="homework-content">
              <span class="homework-marker" aria-hidden="true"></span>
              <span class="homework-text">${content}</span>
            </span>
            ${tags}
            ${actions}
          </m3e-list-action>`;
      }).join("");

      sections.push(`
        <section class="subject-group">
          <m3e-heading variant="headline" size="small" level="2">${hs.escapeHtml(subject)}</m3e-heading>
          <m3e-list class="subject-homework-list" variant="segmented">${items}</m3e-list>
        </section>`);
    }

    boardEl.innerHTML = `<div class="masonry-columns">${sections.join("")}</div>`;
  }

  async function loadDates() {
    const { data, error } = await hs.withTimeout(
      client
        .from("publish_batches")
        .select("published_on,homework_count,subject_count,published_at")
        .order("published_on", { ascending: false })
        .limit(400),
      15000,
      "读取发布记录",
    );
    if (error) {
      showStatus(`读取发布记录失败：${error.message}`, true);
      hs.fatal(`读取发布记录失败：${error.message}`);
      return [];
    }
    availableDates = (data || []).map((row) => row.published_on).filter(Boolean);
    return data || [];
  }

  async function fetchDay(date) {
    const { data, error } = await hs.withTimeout(
      client
        .from("homeworks")
        .select("id,subject,content,content_html,tags,due_date,sort_order")
        .eq("published_on", date)
        .order("subject", { ascending: true })
        .order("sort_order", { ascending: true }),
      15000,
      "读取作业",
    );
    if (error) {
      showStatus(`加载失败：${error.message}`, true);
      hs.fatal(`加载作业失败：${error.message}`);
      return null;
    }
    return data || [];
  }

  async function loadLatest() {
    const today = todayString();
    const batch = availableDates.includes(today) ? today : availableDates.find((date) => date <= today) || availableDates[0];

    if (!batch) {
      renderEmpty("还没有发布过作业");
      showStatus("后端还没有任何作业记录。");
      return;
    }

    showStatus("正在加载…");
    const rows = await fetchDay(batch);
    if (!rows) return;

    const pending = rows.filter((row) => !isExpired(row.due_date));
    currentRows = pending;
    currentDate = batch;
    selectedId = null;
    canManage = Boolean(profile && hs.canEditToday(profile) && batch === todayString());
    showStatus(
      pending.length === rows.length
        ? `${formatDateLabel(batch)} · 共 ${pending.length} 条作业`
        : `${formatDateLabel(batch)} · ${pending.length} 条未过期（另有 ${rows.length - pending.length} 条已过期，可去时光机查看）`,
    );
    renderBoard(pending);
  }

  async function loadDate(date) {
    datePicker.value = date;
    const dateLabel = document.getElementById("date-label");
    if (dateLabel) dateLabel.textContent = formatDateLabel(date);
    const url = new URL(location.href);
    url.searchParams.set("date", date);
    history.replaceState(null, "", url);

    if (!availableDates.includes(date)) {
      renderEmpty("这一天没有作业记录");
      showStatus(availableDates[0] ? `最近一次发布是 ${formatDateLabel(availableDates[0])}。` : "后端还没有任何作业记录。");
      return;
    }

    showStatus("正在加载…");
    const rows = await fetchDay(date);
    if (!rows) return;
    currentRows = rows;
    currentDate = date;
    selectedId = null;
    // 只有发布者/管理员可以改，而且只能改当天
    canManage = Boolean(profile && hs.canEditToday(profile) && date === todayString());
    const manageHint = profile && hs.canEditToday(profile) && !canManage ? "（非当天，只能查看）" : "";
    showStatus(`${formatDateLabel(date)} · 共 ${rows.length} 条作业${manageHint}`);
    renderBoard(rows);
  }

  async function init() {
    // 依赖没准备好的话，直接把原因显示出来，别让页面停在「正在加载」
    if (!window.hs || !window.hs.client) {
      renderEmpty("页面依赖没有加载完成");
      showStatus("依赖脚本未就绪：可能是 vendor/ 下的文件没有加载成功，刷新重试。", true);
      return;
    }

    // 主界面未登录也能看；时光机必须登录
    const session = await hs.getSession();
    if (mode === "date" && !session) {
      location.replace(`login.html?next=${encodeURIComponent(`timemachine.html${location.search}`)}`);
      return;
    }

    profile = session ? await hs.getProfile() : null;

    if (!profile) {
      // 未登录：右上角按钮变成「登录」，顶部给一条红色横幅
      if (accountButtonLabel) accountButtonLabel.textContent = "登录";
      accountButton.addEventListener("click", () => location.assign("login.html"));
      if (loginBanner) loginBanner.hidden = false;
      if (bannerLoginButton) bannerLoginButton.addEventListener("click", () => location.assign("login.html"));
    } else {
      accountEmail.textContent = profile.email;
      accountRole.textContent = hs.roleLabel(profile.role);
      if (publishLink) publishLink.hidden = !hs.isPublisher(profile);

      accountButton.addEventListener("click", () => {
        accountPanel.hidden = !accountPanel.hidden;
      });
      document.addEventListener("click", (event) => {
        if (!accountPanel.hidden && !event.target.closest(".account")) accountPanel.hidden = true;
      });
      logoutButton.addEventListener("click", () => void hs.signOut());
      if (publishLink) publishLink.addEventListener("click", () => location.assign("publish.html"));
    }

    if (timemachineButton) {
      timemachineButton.addEventListener("click", () => location.assign(session ? "timemachine.html" : "login.html"));
    }
    if (backButton) backButton.addEventListener("click", () => location.assign("index.html"));

    // ---------- 选中与编辑/删除（只有发布者/管理员，且只有当天） ----------

    const editDialog = document.getElementById("edit-dialog");
    const deleteDialog = document.getElementById("delete-dialog");

    function findRow(id) {
      return currentRows.find((row) => String(row.id) === String(id)) || null;
    }

    function setDialogMessage(id, text, isError = true) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("status--error", isError);
      el.hidden = !text;
    }

    async function refresh() {
      if (mode === "date" && currentDate) await loadDate(currentDate);
      else await loadLatest();
    }

    function openEdit(id) {
      const row = findRow(id);
      if (!row || !editDialog) return;
      document.getElementById("edit-subject").value = row.subject || "";
      document.getElementById("edit-due").value = row.due_date || "";
      document.getElementById("edit-tags").value = (row.tags || []).join(", ");
      document.getElementById("edit-content").value = row.content || "";
      setDialogMessage("edit-message", "");
      editDialog.dataset.id = id;
      editDialog.show();
    }

    async function saveEdit() {
      if (!editDialog) return;
      const id = editDialog.dataset.id;
      const subject = document.getElementById("edit-subject").value.trim() || "其它";
      const due = document.getElementById("edit-due").value;
      const tags = document.getElementById("edit-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
      const content = document.getElementById("edit-content").value;
      const saveButton = document.getElementById("edit-save");

      saveButton.setAttribute("disabled", "");
      // content_html 置空：网页端按纯文本编辑，展示与编辑结果保持一致
      const { error } = await client
        .from("homeworks")
        .update({
          subject,
          content,
          content_html: null,
          tags,
          due_date: due || null,
          due_time: due ? `${due}T00:00:00` : null,
        })
        .eq("id", id);
      saveButton.removeAttribute("disabled");

      if (error) {
        setDialogMessage(
          "edit-message",
          String(error.message).includes("row-level security") || error.code === "42501"
            ? "保存失败：只能修改当天发布的内容。"
            : `保存失败：${error.message}`,
        );
        return;
      }
      editDialog.hide();
      hs.toast("已保存");
      await refresh();
    }

    function openDelete(id) {
      if (!deleteDialog) return;
      setDialogMessage("delete-message", "");
      deleteDialog.dataset.id = id;
      deleteDialog.show();
    }

    async function confirmDelete() {
      if (!deleteDialog) return;
      const id = deleteDialog.dataset.id;
      const button = document.getElementById("delete-confirm");
      button.setAttribute("disabled", "");
      const { error } = await client.from("homeworks").delete().eq("id", id);
      button.removeAttribute("disabled");
      if (error) {
        setDialogMessage(
          "delete-message",
          String(error.message).includes("row-level security") || error.code === "42501"
            ? "删除失败：只能修改当天发布的内容。"
            : `删除失败：${error.message}`,
        );
        return;
      }
      deleteDialog.hide();
      hs.toast("已删除");
      await refresh();
    }

    if (editDialog) {
      document.getElementById("edit-save")?.addEventListener("click", () => void saveEdit());
      document.getElementById("edit-cancel")?.addEventListener("click", () => editDialog.hide());
    }
    if (deleteDialog) {
      document.getElementById("delete-confirm")?.addEventListener("click", () => void confirmDelete());
      document.getElementById("delete-cancel")?.addEventListener("click", () => deleteDialog.hide());
    }

    boardEl.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (action) {
        event.stopPropagation();
        if (action.dataset.action === "edit") openEdit(action.dataset.id);
        else if (action.dataset.action === "delete") openDelete(action.dataset.id);
        return;
      }
      if (!canManage) return;
      const item = event.target.closest(".homework-item");
      if (!item) return;
      // 再点一下取消选中，和桌面端一致
      selectedId = selectedId === item.dataset.id ? null : item.dataset.id;
      renderBoard(currentRows);
    });

    const batches = await loadDates();
    if (!batches.length) {
      renderEmpty("还没有发布过作业");
      showStatus("后端还没有任何作业记录。");
      return;
    }

    const today = todayString();
    if (datePicker) {
      datePicker.min = availableDates[availableDates.length - 1];
      datePicker.max = availableDates[0] > today ? availableDates[0] : today;
    }

    if (mode === "date") {
      const dateTrigger = document.getElementById("date-trigger");
      const dateLabel = document.getElementById("date-label");

      // 只允许通过系统日历选择，不接受键盘直接输入
      if (datePicker) {
        datePicker.addEventListener("keydown", (event) => {
          if (event.key !== "Tab" && event.key !== "Escape") event.preventDefault();
        });
        datePicker.addEventListener("change", () => {
          if (datePicker.value) void loadDate(datePicker.value);
        });
      }

      // 点触发器任意位置都弹出系统日期选择器
      if (dateTrigger && datePicker) {
        dateTrigger.addEventListener("click", () => {
          if (typeof datePicker.showPicker === "function") {
            try {
              datePicker.showPicker();
              return;
            } catch {
              /* 某些环境不允许 showPicker，退回 click */
            }
          }
          datePicker.focus();
          datePicker.click();
        });
      }

      const fromUrl = new URLSearchParams(location.search).get("date");
      if (fromUrl && availableDates.includes(fromUrl)) {
        await loadDate(fromUrl);
      } else {
        // 进来先不加载任何一天，提示选日期
        if (dateLabel) dateLabel.textContent = "选择日期";
        showPickPrompt();
      }
      return;
    }

    await loadLatest();
  }

  void init();
})();

