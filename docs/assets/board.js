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

  let availableDates = [];
  let profile = null;

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
    boardEl.innerHTML = `
      <div class="homework-empty-state">
        <m3e-icon name="assignment"></m3e-icon>
        <m3e-heading variant="title" size="large" level="2">${hs.escapeHtml(message)}</m3e-heading>
      </div>`;
  }

  function renderBoard(rows) {
    if (!rows.length) {
      renderEmpty(mode === "latest" ? "今天没有需要做的作业" : "这一天没有作业");
      return;
    }

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
        const tags = (homework.tags || []).length
          ? `<div slot="supporting-text" class="homework-tags">${homework.tags
              .map((tag) => `<m3e-chip variant="outlined">${hs.escapeHtml(tag)}</m3e-chip>`)
              .join("")}</div>`
          : "";
        return `
          <m3e-list-action class="homework-item${expired ? " homework-item--expired" : ""}">
            <span class="homework-content">
              <span class="homework-marker" aria-hidden="true"></span>
              <span class="homework-text">${content}</span>
            </span>
            ${tags}
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
    const { data, error } = await client
      .from("publish_batches")
      .select("published_on,homework_count,subject_count,published_at")
      .order("published_on", { ascending: false })
      .limit(400);
    if (error) {
      showStatus(`读取发布记录失败：${error.message}`, true);
      return [];
    }
    availableDates = (data || []).map((row) => row.published_on).filter(Boolean);
    return data || [];
  }

  async function fetchDay(date) {
    const { data, error } = await client
      .from("homeworks")
      .select("subject,content,content_html,tags,due_date,sort_order")
      .eq("published_on", date)
      .order("subject", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) {
      showStatus(`加载失败：${error.message}`, true);
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
    showStatus(
      pending.length === rows.length
        ? `${formatDateLabel(batch)} · 共 ${pending.length} 条作业`
        : `${formatDateLabel(batch)} · ${pending.length} 条未过期（另有 ${rows.length - pending.length} 条已过期，可去时光机查看）`,
    );
    renderBoard(pending);
  }

  async function loadDate(date) {
    datePicker.value = date;
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
    showStatus(`${formatDateLabel(date)} · 共 ${rows.length} 条作业`);
    renderBoard(rows);
  }

  async function init() {
    const session = await hs.requireSession();
    if (!session) return;

    profile = await hs.getProfile();
    if (profile) {
      accountEmail.textContent = profile.email;
      accountRole.textContent = hs.roleLabel(profile.role);
      if (publishLink) publishLink.hidden = !hs.isPublisher(profile);
    }

    accountButton.addEventListener("click", () => {
      accountPanel.hidden = !accountPanel.hidden;
    });
    document.addEventListener("click", (event) => {
      if (!accountPanel.hidden && !event.target.closest(".account")) accountPanel.hidden = true;
    });
    logoutButton.addEventListener("click", () => void hs.signOut());
    if (publishLink) publishLink.addEventListener("click", () => location.assign("publish.html"));
    if (timemachineButton) timemachineButton.addEventListener("click", () => location.assign("timemachine.html"));
    if (backButton) backButton.addEventListener("click", () => location.assign("index.html"));

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
      const fromUrl = new URLSearchParams(location.search).get("date");
      const initial = fromUrl || (availableDates.includes(today) ? today : availableDates[0]);
      datePicker.addEventListener("change", () => {
        if (datePicker.value) void loadDate(datePicker.value);
      });
      if (latestButton) {
        latestButton.addEventListener("click", () => {
          void loadDate(availableDates.includes(today) ? today : availableDates[0]);
        });
      }
      await loadDate(initial);
      return;
    }

    await loadLatest();
  }

  void init();
})();
