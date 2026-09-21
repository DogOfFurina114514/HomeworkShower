/**
 * 主页：日期选择 + 作业看板（只按「导入/发布日期」查看）
 */
(function () {
  const { client } = hs;

  const titleEl = document.getElementById("site-title");
  const datePicker = document.getElementById("date-picker");
  const todayButton = document.getElementById("today-button");
  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const accountButton = document.getElementById("account-button");
  const accountPanel = document.getElementById("account-panel");
  const accountEmail = document.getElementById("account-email");
  const accountRole = document.getElementById("account-role");
  const logoutButton = document.getElementById("logout-button");
  const publishLink = document.getElementById("publish-link");

  let availableDates = [];
  let currentDate = "";

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDateLabel(value) {
    const [y, m, d] = value.split("-");
    return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  }

  function showStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("status--error", isError);
    statusEl.hidden = !message;
  }

  function setUrlDate(date) {
    const url = new URL(location.href);
    url.searchParams.set("date", date);
    history.replaceState(null, "", url);
  }

  function renderEmpty(message) {
    boardEl.innerHTML = `<div class="empty-state"><div>${hs.escapeHtml(message)}</div></div>`;
  }

  function renderBoard(rows) {
    if (!rows.length) {
      renderEmpty("这一天没有作业");
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
        const markerColor = homework.expired ? "var(--md-sys-color-error)" : "var(--md-sys-color-primary)";
        const tags = (homework.tags || []).length
          ? `<div class="homework-item__tags">${homework.tags.map((tag) => `<span class="tag">${hs.escapeHtml(tag)}</span>`).join("")}</div>`
          : "";
        const due = homework.due_date
          ? `<div class="homework-item__due">期限 ${hs.escapeHtml(homework.due_date)}${homework.expired ? " · 已过期" : ""}</div>`
          : "";
        return `
          <article class="homework-item">
            <div class="homework-item__row">
              <span class="homework-item__marker" style="background:${markerColor}"></span>
              <div class="homework-item__text">${content}</div>
            </div>
            ${tags}
            ${due}
          </article>`;
      }).join("");

      sections.push(`
        <section class="subject-group">
          <h2 class="subject-group__name">${hs.escapeHtml(subject)}</h2>
          <div class="homework-list">${items}</div>
        </section>`);
    }

    boardEl.innerHTML = `<div class="board__columns">${sections.join("")}</div>`;
  }

  async function loadDate(date) {
    currentDate = date;
    datePicker.value = date;
    setUrlDate(date);

    if (!availableDates.includes(date)) {
      const nearest = availableDates[0];
      renderEmpty("这一天没有作业记录");
      showStatus(nearest ? `最近一次发布是 ${formatDateLabel(nearest)}，点「最新」可跳过去。` : "后端还没有任何作业记录。");
      return;
    }

    showStatus("正在加载…");
    const { data, error } = await client
      .from("homeworks")
      .select("subject,content,content_html,tags,due_date,due_time,expired,sort_order")
      .eq("published_on", date)
      .order("subject", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) {
      showStatus(`加载失败：${error.message}`, true);
      renderEmpty("加载失败");
      return;
    }

    const batch = await client
      .from("publish_batches")
      .select("published_at,homework_count,subject_count,publisher_email")
      .eq("published_on", date)
      .maybeSingle();

    const info = batch.data;
    showStatus(
      info
        ? `${formatDateLabel(date)} · 共 ${info.homework_count} 条作业 / ${info.subject_count} 个科目 · 发布于 ${new Date(info.published_at).toLocaleString("zh-CN")}`
        : formatDateLabel(date),
    );
    renderBoard(data || []);
  }

  async function init() {
    const session = await hs.requireSession();
    if (!session) return;

    titleEl.textContent = hs.config.siteName;

    const profile = await hs.getProfile();
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

    const { data: batches, error } = await client
      .from("publish_batches")
      .select("published_on,homework_count")
      .order("published_on", { ascending: false })
      .limit(400);

    if (error) {
      showStatus(`读取发布记录失败：${error.message}`, true);
      return;
    }

    availableDates = (batches || []).map((row) => row.published_on).filter(Boolean);
    const today = todayString();
    const fromUrl = new URLSearchParams(location.search).get("date");
    const initial = fromUrl || (availableDates.includes(today) ? today : availableDates[0]) || today;

    if (availableDates.length) {
      datePicker.min = availableDates[availableDates.length - 1];
      datePicker.max = availableDates[0] > today ? availableDates[0] : today;
    }

    datePicker.addEventListener("change", () => {
      if (datePicker.value) void loadDate(datePicker.value);
    });
    todayButton.addEventListener("click", () => {
      const target = availableDates.includes(today) ? today : availableDates[0] || today;
      void loadDate(target);
    });

    await loadDate(initial);
  }

  void init();
})();
