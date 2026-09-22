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
        // dataset.id 是字符串，数据库 id 是数字，必须统一成字符串比较
        const selected = String(selectedId) === String(homework.id);
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
          <m3e-list-action style="--i: ${homeworks.indexOf(homework)}" class="homework-item${expired ? " homework-item--expired" : ""}${selected ? " homework-item--selected" : ""}${canManage ? " homework-item--clickable" : ""}" data-id="${homework.id}">
            <span class="homework-content">
              <span class="homework-marker" aria-hidden="true"></span>
              <span class="homework-text">${content}</span>
            </span>
            ${tags}
            ${actions}
          </m3e-list-action>`;
      }).join("");

      sections.push(`
        <section class="subject-group" style="--i: ${sections.length}">
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
      (pending.length === rows.length
        ? `${formatDateLabel(batch)} · 共 ${pending.length} 条作业`
        : `${formatDateLabel(batch)} · ${pending.length} 条未过期（另有 ${rows.length - pending.length} 条已过期，可去时光机查看）`) +
        (canManage ? " · 点击作业可修改或删除" : ""),
    );
    renderBoard(pending);
  }

  async function loadDate(date) {
    const dateInput = document.getElementById("date-input");
    if (dateInput) dateInput.value = formatDateLabel(date);
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
    // 时光机是只读回看，不允许任何编辑；只有主界面（latest）才能改当天的内容
    canManage = false;
    showStatus(`${formatDateLabel(date)} · 共 ${rows.length} 条作业`);
    renderBoard(rows);
  }

  /**
   * 把图片压缩成 Blob：最长边 1280px，非 PNG 转 JPEG 0.8。
   * 图片存进 Supabase Storage 桶（1 GB 额度），不占数据库那 500 MB。
   */
  function shrinkImage(file, maxEdge = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error("图片太大（超过 12 MB）"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("这个图片格式浏览器读不了"));
        image.onload = () => {
          const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("当前环境不支持画布处理"));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          // PNG 可能带透明通道，保留 PNG；其余转 JPEG 压体积
          const keepPng = file.type === "image/png";
          const contentType = keepPng ? "image/png" : "image/jpeg";
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("图片处理失败"));
                return;
              }
              resolve({ blob, contentType, extension: keepPng ? "png" : "jpg" });
            },
            contentType,
            quality,
          );
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function init() {
    // 依赖没准备好的话，直接把原因显示出来，别让页面停在「正在加载」
    if (!window.hs || !window.hs.client) {
      renderEmpty("页面依赖没有加载完成");
      showStatus("依赖脚本未就绪：可能是 vendor/ 下的文件没有加载成功，刷新重试。", true);
      return;
    }

    showStatus("正在读取登录状态…");

    // 主界面未登录也能看；时光机必须登录
    let session = null;
    try {
      session = await hs.getSession();
    } catch (error) {
      showStatus(`读取登录状态失败：${error.message}`, true);
      session = null;
    }

    if (mode === "date" && !session) {
      // 不自动跳转，避免和登录页互相跳导致来回加载
      boardEl.classList.add("homework-board--prompt");
      boardEl.innerHTML = `
        <div class="homework-empty-state homework-empty-state--prompt">
          <m3e-icon variant="outlined" name="lock"></m3e-icon>
          <m3e-heading variant="title" size="large" level="2">时光机需要登录后使用</m3e-heading>
          <m3e-button variant="filled" id="prompt-login-button">去登录</m3e-button>
        </div>`;
      showStatus("");
      document.getElementById("prompt-login-button")?.addEventListener("click", () => {
        location.assign(`login.html?next=${encodeURIComponent("timemachine.html")}`);
      });
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
      const duePicker = document.getElementById("edit-due-picker");
      const dueInput = document.getElementById("edit-due-input");
      dueInput.value = row.due_date ? formatDateLabel(row.due_date) : "";
      if (duePicker) duePicker.date = row.due_date ? new Date(`${row.due_date}T00:00:00`) : null;
      document.getElementById("edit-tags").value = (row.tags || []).join(", ");
      // 保留富文本：有 content_html 就直接放进去，没有则把纯文本转成段落
      const editor = document.getElementById("edit-content");
      editor.innerHTML = row.content_html
        ? hs.sanitizeHtml(row.content_html)
        : hs.escapeHtml(row.content || "").replace(/\n/g, "<br>");
      setDialogMessage("edit-message", "");
      editDialog.dataset.id = id;
      editDialog.show();
      window.setTimeout(() => editor.focus(), 80);
    }

    async function saveEdit() {
      if (!editDialog) return;
      const id = editDialog.dataset.id;
      const subject = document.getElementById("edit-subject").value.trim() || "其它";
const duePickerEl = document.getElementById("edit-due-picker");
      const picked = duePickerEl && duePickerEl.date;
      const due = picked
        ? `${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, "0")}-${String(picked.getDate()).padStart(2, "0")}`
        : "";
      const tags = document.getElementById("edit-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
      const editor = document.getElementById("edit-content");
      const contentHtml = editor.innerHTML.trim();
      const content = (editor.innerText || "").replace(/\u00a0/g, " ").trim();
      const saveButton = document.getElementById("edit-save");

      saveButton.setAttribute("disabled", "");
      const { error } = await client
        .from("homeworks")
        .update({
          subject,
          content,
          content_html: contentHtml || null,
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

      // 期限：与应用同款 m3e-datepicker，点输入框任意处都能唤起日历
      {
        const dueInput = document.getElementById("edit-due-input");
        const duePickerCtl = document.getElementById("edit-due-picker");
        if (dueInput && duePickerCtl) {
          duePickerCtl.addEventListener("change", () => {
            const picked = duePickerCtl.date;
            dueInput.value = picked
              ? `${picked.getFullYear()} 年 ${picked.getMonth() + 1} 月 ${picked.getDate()} 日`
              : "";
          });
          dueInput.addEventListener("click", () => void duePickerCtl.show(dueInput, dueInput));
        }
      }

      // 富文本工具栏
      editDialog.querySelector(".rich-toolbar")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cmd]");
        if (!button) return;
        event.preventDefault();
        const editor = document.getElementById("edit-content");
        const command = button.dataset.cmd;

        if (command === "insertImage") {
          const fileInput = editDialog.querySelector(".rich-image-input");
          if (!fileInput) return;
          fileInput.value = "";
          fileInput.click();
          return;
        }

        editor.focus();
        if (command === "createLink") {
          const url = window.prompt("输入链接地址", "https://");
          if (url) document.execCommand("createLink", false, url);
        } else {
          document.execCommand(command, false, null);
        }
      });

      // 插图：先压缩，再上传到图片桶（不占数据库配额），最后插入公共地址
      editDialog.querySelector(".rich-image-input")?.addEventListener("change", async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          setDialogMessage("edit-message", "正在处理图片…", false);
          const shrunk = await shrinkImage(file);
          const path = `${hs.todayString()}/${crypto.randomUUID()}.${shrunk.extension}`;
          const { error } = await client.storage
            .from("homework-images")
            .upload(path, shrunk.blob, { contentType: shrunk.contentType, upsert: false });
          if (error) throw new Error(error.message);

          const { data } = client.storage.from("homework-images").getPublicUrl(path);
          const editor = document.getElementById("edit-content");
          editor.focus();
          document.execCommand("insertImage", false, data.publicUrl);
          setDialogMessage("edit-message", `已插入图片（${Math.round(shrunk.blob.size / 1024)} KB）`, false);
        } catch (error) {
          setDialogMessage("edit-message", `插入图片失败：${error.message}`);
        }
      });
    }
    if (deleteDialog) {
      document.getElementById("delete-confirm")?.addEventListener("click", () => void confirmDelete());
      document.getElementById("delete-cancel")?.addEventListener("click", () => deleteDialog.hide());
    }

    /**
     * 图片被清理后会 404：在原位置换成灰底占位块（裂图图标 + 「图片已过期」）。
     * 注意图片的 error 事件不冒泡，必须用捕获阶段监听。
     */
    boardEl.addEventListener(
      "error",
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        if (image.dataset.expiredPlaceholder === "1") return;
        const box = document.createElement("span");
        box.className = "image-expired";
        box.innerHTML = '<m3e-icon variant="outlined" name="broken_image"></m3e-icon><span>图片已过期</span>';
        image.dataset.expiredPlaceholder = "1";
        image.replaceWith(box);
      },
      true,
    );

    boardEl.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (action) {
        event.stopPropagation();
        if (action.dataset.action === "edit") openEdit(action.dataset.id);
        else if (action.dataset.action === "delete") openDelete(action.dataset.id);
        return;
      }      const item = event.target.closest(".homework-item");
      if (!item) return;

      // 说清楚为什么点了没反应，而不是静默忽略
      if (!profile) {
        hs.toast("登录后可以修改作业");
        return;
      }
      if (!hs.canEditToday(profile)) {
        hs.toast("只有发布者和管理员可以修改作业");
        return;
      }
      if (!canManage) {
        hs.toast("只能修改当天发布的作业");
        return;
      }
      // 再点一下取消选中，和桌面端一致
      selectedId = selectedId === item.dataset.id ? null : item.dataset.id;
      renderBoard(currentRows);
    });

    // ---------- 右下角编辑按钮 ----------
    const fabHost = document.getElementById("fab-host");
    const permissionDialog = document.getElementById("permission-dialog");
    const applyDialog = document.getElementById("apply-dialog");

    function openPermissionDialog() {
      const roleEl = document.getElementById("permission-role");
      if (roleEl) roleEl.textContent = profile ? hs.roleLabel(profile.role) : "未登录";
      permissionDialog?.show();
    }

    function openApplyDialog() {
      const emailEl = document.getElementById("apply-email");
      if (emailEl) emailEl.value = hs.config.adminEmail || "";
      applyDialog?.show();
    }

    /** 打开发信应用：收件人与主题已填好 */
    function openApplyMail() {
      const to = hs.config.adminEmail || "";
      const subject = "申请作业管理员";
      const body = [
        "你好，我想申请成为作业管理员（可以发布与修改作业）。",
        "",
        `我的账号邮箱：${profile?.email || "（未填写）"}`,
        `申请时间：${new Date().toLocaleString("zh-CN")}`,
        "",
        "申请理由：",
      ].join("\n");
      location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    if (fabHost && mode === "latest") {
      if (profile && hs.canEditToday(profile)) {
        fabHost.innerHTML = `
          <m3e-fab variant="primary" aria-label="编辑">
            <m3e-fab-menu-trigger for="fab-menu">
              <m3e-icon variant="outlined" name="edit"></m3e-icon>
            </m3e-fab-menu-trigger>
          </m3e-fab>
          <m3e-fab-menu id="fab-menu" variant="primary">
            <m3e-fab-menu-item id="fab-publish">
              <m3e-icon variant="outlined" slot="icon" name="upload_file"></m3e-icon>
              发布作业
            </m3e-fab-menu-item>
            <m3e-fab-menu-item id="fab-save">
              <m3e-icon variant="outlined" slot="icon" name="ios_share"></m3e-icon>
              导出作业
            </m3e-fab-menu-item>
            
          </m3e-fab-menu>`;
        document.getElementById("fab-publish")?.addEventListener("click", () => location.assign("publish.html"));
        document.getElementById("fab-save")?.addEventListener("click", () => {
          const subjects = [];
          for (const row of currentRows) {
            let group = subjects.find((item) => item.subject === (row.subject || "其它"));
            if (!group) {
              group = { subject: row.subject || "其它", homeworks: [] };
              subjects.push(group);
            }
            group.homeworks.push({
              content: row.content,
              contentHtml: row.content_html ?? null,
              tags: row.tags || [],
              dueDate: row.due_date,
              expired: isExpired(row.due_date),
            });
          }
          const payload = { format: "stickyhomeworks2.homeworks", publishedOn: currentDate, subjects };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `作业-${currentDate || "latest"}.json`;
          link.click();
          URL.revokeObjectURL(url);
          hs.toast("已导出 JSON");
        });
        
      } else {
        fabHost.innerHTML = `
          <m3e-fab variant="primary" id="fab-request" aria-label="申请修改权限">
            <m3e-icon variant="outlined" name="edit"></m3e-icon>
          </m3e-fab>`;
        document.getElementById("fab-request")?.addEventListener("click", openPermissionDialog);
      }
    }

    document.getElementById("permission-ok")?.addEventListener("click", () => permissionDialog?.hide());
    document.getElementById("permission-apply")?.addEventListener("click", () => {
      permissionDialog?.hide();
      openApplyDialog();
    });
    document.getElementById("apply-close")?.addEventListener("click", () => applyDialog?.hide());
    document.getElementById("apply-mail")?.addEventListener("click", openApplyMail);

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
      const dateField = document.getElementById("date-field");
      const picker = document.getElementById("date-picker");

      if (picker) {
        // 与桌面端同一套：m3e-datepicker + datepicker-toggle
        const toDate = (value) => new Date(`${value}T00:00:00`);
        if (availableDates.length) {
          picker.minDate = toDate(availableDates[availableDates.length - 1]);
          picker.maxDate = toDate(availableDates[0] > today ? availableDates[0] : today);
        }
        // 没有发布记录的日子直接在日历里禁掉
        picker.blackoutDates = (date) => {
          const pad = (n) => String(n).padStart(2, "0");
          const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
          return !availableDates.includes(key);
        };
        picker.addEventListener("change", () => {
          const picked = picker.date;
          if (!picked) return;
          const pad = (n) => String(n).padStart(2, "0");
          void loadDate(`${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`);
        });
      }

      // 点字段任意处都能打开日历（应用里只有右侧图标能点，这里放宽）
      if (dateField && picker) {
        dateField.addEventListener("click", (event) => {
          if (event.target.closest("m3e-datepicker-toggle")) return;
          void picker.show(dateField, dateField);
        });
      }

      // 每次打开都从「请选择一个日期」开始，不按地址栏里的 date 自动加载
      showPickPrompt();
      return;
    }

    await loadLatest();
  }

  void init();
})();












