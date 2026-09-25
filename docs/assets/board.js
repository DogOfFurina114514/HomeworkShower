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

  /**
   * 图片超过这个天数，404 就按"已被容量清理"来解释。
   * 后端是按 1 GB 上限从最早的日期开始清的（homework_image_purge_dates），
   * 前端拿不到实时清理清单，所以用天数做个保守判断：
   * 老图 404 → 已过期；近期图 404 → 多半是网络问题，给重试。
   */
  const IMAGE_KEEP_DAYS = 60;

  /** 过期与否以「期限」为准，并用当天日期实时判断，不看发布时写死的标记。 */
  function isExpired(dueDate) {
    if (!dueDate) return false;
    return String(dueDate) < todayString();
  }

  /**
   * 一整行是否过期 = 发布者显式作废 或 期限已过。
   * 这套判定必须和后端 RLS 的 can_edit_homework(expired, due_date) 完全一致，
   * 否则会出现「按钮点了却报 42501」这种前后端各说各话的情况。
   */
  function isRowExpired(row) {
    if (!row) return false;
    return Boolean(row.expired) || isExpired(row.due_date);
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

/** 选中导致的局部重绘：跳过入场动画，只让卡片自己缩放 */
  let skipEnterAnimation = false;
  /** 渲染序号：异步分栏回来时用它判断"这次渲染是不是已经过期了" */
  let renderToken = 0;

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
        const expired = isRowExpired(homework);
        // 权限按「单条是否过期」判定：有过期标记或期限已过的，任何人都只能看。
        // 与后端 RLS 的 can_edit_homework(expired, due_date) 一一对应。
        const editable = canManage && !expired;
        // dataset.id 是字符串，数据库 id 是数字，必须统一成字符串比较
        const selected = String(selectedId) === String(homework.id);
        const tags = (homework.tags || []).length
          ? `<div slot="supporting-text" class="homework-tags">${homework.tags
              .map((tag) => `<m3e-chip variant="outlined">${hs.escapeHtml(tag)}</m3e-chip>`)
              .join("")}</div>`
          : "";
        // 操作按钮常驻卡片内（绝对定位浮在右下角，不占布局），选中时用 CSS 淡入
        const actions = editable
          ? `<span class="homework-actions">
              <m3e-icon-button data-action="edit" data-id="${homework.id}" aria-label="修改作业" title="修改作业"><m3e-icon variant="outlined" name="edit"></m3e-icon></m3e-icon-button>
              <m3e-icon-button data-action="delete" data-id="${homework.id}" aria-label="删除作业" title="删除作业"><m3e-icon variant="outlined" name="delete"></m3e-icon></m3e-icon-button>
            </span>`
          : "";
        return `
          <m3e-list-action style="--i: ${homeworks.indexOf(homework)}" class="homework-item${expired ? " homework-item--expired" : ""}${selected ? " homework-item--selected" : ""}${editable ? " homework-item--clickable" : ""}" data-id="${homework.id}">
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

    // 先把内容整块插进页面（还没分栏），藏起来量到版面稳定，再分栏、再显示。
    // 这样用户看到的永远是"排好了的结果"，不会先看到一版错的再跳一下。
    const noAnimClass = skipEnterAnimation ? " masonry-columns--no-anim" : "";
    boardEl.innerHTML = `<div class="masonry-columns${noAnimClass}">${sections.join("")}</div>`;
    const wrap = boardEl.querySelector(".masonry-columns");
    const token = ++renderToken;
    boardEl.classList.add("homework-board--measuring");
    Promise.all([whenImagesSettled(wrap), whenLayoutStable(wrap)]).then(() => {
      // 期间又渲染了一次，或者这块 DOM 已经被换掉，就交给新的那次去做
      if (token !== renderToken || !document.contains(wrap)) return;
      splitIntoColumns(wrap);
      boardEl.classList.remove("homework-board--measuring");
    });
    skipEnterAnimation = false;
  }

  /**
   * 把已经插进 DOM 的科目组重新分配到各列。
   *
   * 分两步：
   *   1. 先按列宽把内容量出真实高度（测量期间内容是隐藏的，用户看不到）；
   *   2. 用装箱算法算出分配，一次性重建各列。
   * 也就是说用户看到的永远只是"已经分好的结果"。
   */
  /**
   * 估算一个科目组的"内容量"（与字体无关）。
   *
   * 为什么不用实测像素高度：m3e 组件与字体是异步就绪的，刚插入 DOM 时
   * 卡片还没长开（实测 394px 的作文卡当时只有 56px），量出来偏小且不稳定；
   * 而"卡片数 + 文字长度 + 图片数"这些是内容本身的特征，
   * 字体怎么变都只是整体缩放，相对大小不变 —— 用它排序就稳。
   */
  function contentWeight(group) {
    const items = group.querySelectorAll(".homework-item");
    let weight = 40; // 科目标题
    items.forEach((item) => {
      const text = (item.textContent || "").trim();
      const images = item.querySelectorAll("img").length;
      weight += 56 + text.length * 2.4 + images * 220;
    });
    return weight;
  }

  /**
   * 等"能量准高度"的那一刻：m3e 组件升级完 + 字体加载完。
   *
   * 为什么值得等：分栏装箱和"高列放左边"都要靠真实高度，这两件事没就绪时
   * 量出来的卡片是瘪的（实测一张 394px 的作文卡当时只有 56px）。
   * 等待有上限（1.5 秒），超时就用内容权重估算兜底 ——
   * 宁可排得差一点，也不能让页面一直空着。
   */
  let layoutReadyPromise = null;
  function layoutReady() {
    if (!layoutReadyPromise) {
      const parts = [];
      try {
        parts.push(customElements.whenDefined("m3e-list-action"));
      } catch (error) {
        /* 浏览器不支持就跳过 */
      }
      try {
        if (document.fonts && document.fonts.ready) parts.push(document.fonts.ready);
      } catch (error) {
        /* 忽略 */
      }
      layoutReadyPromise = Promise.race([
        Promise.all(parts).catch(() => undefined),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    }
    return layoutReadyPromise;
  }

  /**
   * 等正文里的图片加载完。
   *
   * 为什么单独等：没加载完的 <img> 高度很小但**很稳定**，
   * 「连续两帧高度不变」这个判据会被它骗过去 —— 实测一张图能顶 340px，
   * 少了它，那一列会被算矮，装箱也就不匀了。
   * 上限 2000ms：图再多再慢也不能一直不显示。
   */
  function whenImagesSettled(root) {
    const images = Array.from(root.querySelectorAll("img")).filter((img) => !img.complete);
    if (!images.length) return Promise.resolve();
    const all = Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
      )
    );
    return Promise.race([all, new Promise((resolve) => window.setTimeout(resolve, 2000))]);
  }

  /**
   * 等版面稳定下来（连续两帧高度不变）再去分栏。
   *
   * 为什么不能"插进 DOM 就量"：m3e 的组件是异步升级的，它的样式还放在 shadow root
   * 里另外加载 —— 实测 1034ms 时每个科目组量出来是 0 高（只剩 margin-bottom 的 36），
   * 真实尺寸要再等一会儿才长出来。量早了装箱和排序都是错的。
   *
   * 上限 2000ms：网慢或组件一直不 ready 时也不能让页面永远空着，
   * 到点就按当时量到的尺寸分栏（拿不到就退回内容权重兜底）。
   */
  function whenLayoutStable(element) {
    return new Promise((resolve) => {
      const started = performance.now();
      let last = -1;
      let sameCount = 0;
      const tick = () => {
        const height = Math.round(element.getBoundingClientRect().height);
        if (height > 0 && height === last) sameCount += 1;
        else sameCount = 0;
        last = height;
        if (sameCount >= 2 || performance.now() - started > 2000) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function splitIntoColumns(wrap) {
    if (!wrap) return;
    const groups = Array.from(wrap.querySelectorAll(".subject-group"));
    if (!groups.length) return;

    const boardWidth = boardEl.clientWidth || window.innerWidth || 1024;
    const count = Math.max(1, Math.min(groups.length, Math.floor((boardWidth - 48) / 358) || 1));

    // 权重：内容特征，与字体无关（量不到真实高度时的兜底）
    const weights = groups.map((group) => contentWeight(group));
    // 同时量一遍真实高度，用来装箱 + 把"高列排到左边"
    const probe = document.createElement("div");
    // 必须带上 --js：否则会命中 app.css 里那条"原生多列兜底"规则
    // （.masonry-columns:not(.masonry-columns--js) 是 display:block + column-count:3），
    // 探针里每列宽度会变成 1/3 而不是 1/count，量出来的高度就是错的。
    probe.className = "masonry-columns masonry-columns--js";
    probe.style.position = "absolute";
    probe.style.left = "-100000px";
    probe.style.top = "0";
    probe.style.width = `${wrap.getBoundingClientRect().width || boardWidth}px`;
    probe.style.visibility = "hidden";
    probe.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i += 1) {
      const phantom = document.createElement("div");
      phantom.className = "masonry-column";
      probe.appendChild(phantom);
    }
    document.body.appendChild(probe);
    const sources = groups.map((group) => group.parentNode);
    groups.forEach((group) => probe.children[0].appendChild(group));
    void probe.offsetHeight;
    const measured = groups.map((group) => {
      const marginBottom = parseFloat(window.getComputedStyle(group).marginBottom) || 0;
      return group.getBoundingClientRect().height + marginBottom;
    });
    groups.forEach((group, index) => {
      const back = sources[index];
      if (back) back.appendChild(group);
    });
    probe.remove();

    // 装箱依据：优先**实测高度**（准），量不出来时才退回内容权重（稳）。
    // 权重只是"内容量"的估算，和真实像素高度差得远：实测同一页里
    // 「3 张卡 293 字 + 1 张图」=530px，而「3 张卡 304 字」只有 210px ——
    // 一张图就顶 300 多像素，权重里的固定值根本反映不出来，
    // 于是按权重装出来的列实际是 566/246/325/403，既不匀、也不是从高到低。
    const trustMeasured = measured.length === groups.length &&
      measured.every((value) => value > 0) && measured.some((value) => value > 120);
    const sizes = trustMeasured ? measured : weights;

    // 装箱：让"最高的一列"尽量矮，同高时让各列尽量均匀
    const assign = solveAssignment(sizes, count);

    // 一次性重建
    wrap.classList.add("masonry-columns--js");
    wrap.innerHTML = "";
    const columns = [];
    for (let i = 0; i < count; i += 1) {
      const column = document.createElement("div");
      column.className = "masonry-column";
      wrap.appendChild(column);
      columns.push(column);
    }
    groups.forEach((group, index) => {
      columns[assign[index]].appendChild(group);
    });
    wrap.querySelectorAll(".subject-group, .homework-item").forEach((node) => {
      node.style.animation = "none";
    });

    // 高的一列放左边。
    //
    // 依据是**实测列高**，不是权重。
    // 之前用"该列里最重的那个组"当代表值，理由是权重不随字体变化、排序稳；
    // 但它和眼睛看到的东西对不上 —— 实测过 566/246/325/403 这种：权重那边
    // 排好了，屏幕上还是乱的。列已经建好，这里只是换顺序、不改任何一列的内容，
    // 所以不会出现"加载后又动一下"。
    const columnLead = new Array(count).fill(0);
    weights.forEach((weight, index) => {
      const bin = assign[index];
      if (weight > columnLead[bin]) columnLead[bin] = weight;
    });
    const columnHeight = columns.map((column) => column.getBoundingClientRect().height);
    const orderOk = columnHeight.every((value) => value > 0) &&
      columnHeight.some((value) => value > 120);
    const rank = (index) => (orderOk ? columnHeight[index] : columnLead[index]);
    const order = columns
      .map((column, index) => ({ column, index }))
      .sort((a, b) => rank(b.index) - rank(a.index));
    order.forEach(({ column }) => wrap.appendChild(column));
    window.__hsColumns = {
      count,
      trustMeasured,
      orderOk,
      atMs: Math.round(performance.now()),
      wrapWidth: Math.round(wrap.getBoundingClientRect().width),
      boardWidth,
      measured: measured.map((v) => Math.round(v)),
      measuredNamed: groups.map((group, index) => {
        const heading = group.querySelector("m3e-heading");
        return `${heading ? heading.textContent.trim() : "?"}=${Math.round(measured[index])}`;
      }),
      columnLead: columnLead.map((v) => Math.round(v)),
      columnHeight: columnHeight.map((v) => Math.round(v)),
      order: order.map((o) => o.index),
      firstOfColumn: order.map(({ column }) => {
        const heading = column.querySelector("m3e-heading");
        return heading ? heading.textContent.trim() : "?";
      }),
    };
  }

  /**
   * 装箱：组数不多就穷举，多则按高度降序放进最矮的列（LPT 近似）。
   *
   * 两个目标，按先后比较（不是加权求和）：
   *   1. 最高的一列尽量矮 —— 页面高度由它决定；
   *   2. 一样高的话，各列离平均值的平方偏差越小越好 —— 否则会出现
   *      550/431/266/266 这种：最高列是压住了，中间那列却还高出一截。
   * 之前把两条揉成 max*10000 + (max-min)，只看"最高和最低之差"，
   * 550/431/266/266 和 550/376/321/266 得分完全一样，于是挑中了前者。
   */
  function solveAssignment(sizes, count) {
    const evaluate = (totals) => {
      const max = Math.max(...totals);
      const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
      let spread = 0;
      totals.forEach((value) => {
        spread += (value - mean) * (value - mean);
      });
      return { max, spread };
    };
    const isBetter = (candidate, best) => {
      if (!best) return true;
      if (candidate.max !== best.max) return candidate.max < best.max;
      return candidate.spread < best.spread;
    };

    if (sizes.length <= 12) {
      const total = Math.pow(count, sizes.length);
      let best = null;
      let bestAssign = null;
      for (let code = 0; code < total; code += 1) {
        const totals = new Array(count).fill(0);
        const assign = new Array(sizes.length);
        let rest = code;
        for (let i = 0; i < sizes.length; i += 1) {
          const bin = rest % count;
          rest = Math.floor(rest / count);
          assign[i] = bin;
          totals[bin] += sizes[i];
        }
        const current = evaluate(totals);
        if (isBetter(current, best)) {
          best = current;
          bestAssign = assign;
        }
      }
      if (bestAssign) return bestAssign;
    }

    const totals = new Array(count).fill(0);
    const assign = new Array(sizes.length).fill(0);
    sizes
      .map((_, i) => i)
      .sort((a, b) => sizes[b] - sizes[a])
      .forEach((i) => {
        let target = 0;
        for (let c = 1; c < count; c += 1) {
          if (totals[c] < totals[target] - 1) target = c;
        }
        assign[i] = target;
        totals[target] += sizes[i];
      });
    return assign;
  }

  let layoutTimer = 0;

  /** 安排分栏：越晚触发，内容越稳定、量得越准；后一次会取消前一次，只留最后一次 */
  function scheduleLayout() {
    [400, 1200].forEach((delay) => {
      window.setTimeout(() => {
        window.clearTimeout(layoutTimer);
        layoutTimer = window.setTimeout(() => layoutColumns(), 0);
      }, delay);
    });
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
        .select("id,subject,content,content_html,tags,due_date,expired,sort_order")
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
    await layoutReady();

    const pending = rows.filter((row) => !isRowExpired(row));
    currentRows = pending;
    currentDate = batch;
    selectedId = null;
    // 主界面只列未过期的作业 —— 这里每一条都可以改
    canManage = Boolean(profile && hs.canEditToday(profile));
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
    await layoutReady();
    currentRows = rows;
    currentDate = date;
    selectedId = null;
    // 时光机也能改：只要这一天的作业还没过期（后端 RLS 与这里同一套判定）。
    // 已过期的行不带 homework-item--clickable，点了不会进选中态。
    canManage = Boolean(profile && hs.canEditToday(profile));
    const editableCount = rows.filter((row) => !isRowExpired(row)).length;
    showStatus(
      `${formatDateLabel(date)} · 共 ${rows.length} 条作业` +
        (canManage
          ? editableCount
            ? ` · ${editableCount} 条未过期可修改`
            : " · 这一天的作业都已过期"
          : ""),
    );
    renderBoard(rows);
  }

  /**
   * 时光机顶栏的日期字段：只在启动时绑定一次。
   *
   * 为什么不能写在 renderBoard 里 —— 那里在没有作业记录时会提前 return，
   * 绑定就永远不会执行，于是"点任意处打开日历"时灵时不灵。
   *
   * 两个坑（都踩过）：
   *   1. 不能在 click 里同步调 iconButton.click()。M3E 在 document 上挂了"点浮层外面
   *      就关掉"的处理器，同步转发时它把这同一次点击也当成"外面"，刚打开的日历
   *      立刻又被关掉（画面表现为点了没反应）。要等本轮事件走完再转发。
   *   2. 判断"点的是不是右侧图标"要用 composedPath：input 在 M3E 的 shadow DOM 里，
   *      事件冒泡到外面时 target 会被重定向成 m3e-form-field，closest() 永远匹配不上。
   */
  function setupDateField() {
    const dateField = document.getElementById("date-field");
    const picker = document.getElementById("date-picker");
    if (!dateField || !picker) return;

    const iconButton = dateField.querySelector('m3e-icon-button[slot="suffix"]');
    const input = dateField.querySelector("input");
    if (!iconButton) return;

    const hitIcon = (event) =>
      typeof event.composedPath === "function" &&
      event.composedPath().some((node) => node === iconButton);

    // 等本轮事件结束再转发，避开 M3E 的"点外面关闭"逻辑
    const forward = () => setTimeout(() => iconButton.click(), 0);
    const onClick = (event) => {
      if (hitIcon(event)) return;
      event.stopPropagation();
      forward();
    };

    if (input) input.addEventListener("click", onClick);
    // 点到标签、留白也算"点这个字段"
    dateField.addEventListener("click", (event) => {
      if (event.target === input) return;
      onClick(event);
    });

    picker.addEventListener("change", () => {
      const picked = picker.date;
      if (!picked) return;
      const pad = (n) => String(n).padStart(2, "0");
      void loadDate(`${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`);
    });
  }

  /** 日期可用范围与黑名单：要等作业日期加载完才知道哪些日子有内容 */
  function applyDateLimits(today) {
    const picker = document.getElementById("date-picker");
    if (!picker) return;
    const toDate = (value) => new Date(`${value}T00:00:00`);
    if (availableDates.length) {
      picker.minDate = toDate(availableDates[availableDates.length - 1]);
      picker.maxDate = toDate(availableDates[0] > today ? availableDates[0] : today);
    } else {
      picker.minDate = null;
      picker.maxDate = null;
    }
    // 没有发布记录的日子直接在日历里禁掉
    picker.blackoutDates = (date) => {
      const pad = (n) => String(n).padStart(2, "0");
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return !availableDates.includes(key);
    };
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


  /**
   * 只在**宽度**变化时重排。
   *
   * 手机上向下滑会隐藏地址栏、向上滑又显示，innerHeight 一直在变，
   * 如果拿 resize 直接触发重排，就会不停重建 masonry 列
   * （重建 = 卡片被重新插入 DOM = 入场动画重播，看着像"每次滑动都在播动画"）。
   */
  let lastLayoutWidth = window.innerWidth;

  function onViewportResize() {
    if (window.innerWidth === lastLayoutWidth) return;
    lastLayoutWidth = window.innerWidth;
    window.clearTimeout(layoutColumns.timer);
    layoutColumns.timer = window.setTimeout(() => {
      if (boardEl.querySelector(".masonry-columns")) layoutColumns();
    }, 150);
  }

  window.addEventListener("resize", onViewportResize);


  /**
   * 固定分栏：按容器宽度算出列数，科目按顺序轮流分配到各列。
   * 与 CSS 多栏的区别：分配结果固定，卡片变高只影响自己这一列，
   * 不会让别的科目被挤到下一排。
   */
  /**
   * 分栏：按容器宽度算列数，再按**实际高度**把科目分配到各列。
   *
   * 之前的做法是"按顺序轮流放"（第 1 个进第 1 列、第 2 个进第 2 列…），
   * 完全不看高度 —— 于是内容多的科目堆在某列、其它列空着，整体很高。
   * 现在：
   *   1. 量出每个科目组的真实高度；
   *   2. 取"当前最矮的一列"放（贪心），把最高列压下来；
   *   3. 仍然大体保持科目的先后顺序（贪心遍历顺序就是原顺序）。
   * 列数没变时不销毁重建，只挪动分组 —— 否则卡片重新进 DOM 会重播入场动画。
   */
  /**
   * 分栏现在交给 CSS 的多列布局（见 app.css 里 .masonry-columns 的 column-count）。
   *
   * 为什么不再用 JS 分配：JS 方案要先量出每个科目组的高度再装箱，
   * 而"量高度"这件事在我们的页面上不可靠 —— m3e 组件是异步升级的，
   * 刚插入 DOM 时卡片还是空的（实测那张 394px 的作文卡当时只有 56px），
   * 量到的尺寸偏小，装箱结果自然不是最优，最高列反而更高。
   * 浏览器原生的多列平衡不需要测量，自己就会把内容均分到各列。
   */
  /** 重新分栏（供 resize 或内容稳定后调用）：只挪位置，不改结构 */
  function layoutColumns() {
    const wrap = boardEl.querySelector(".masonry-columns");
    if (!wrap) return;
    // 先把已有列里的分组提回顶层，再统一重新分配
    const oldColumns = Array.from(wrap.querySelectorAll(":scope > .masonry-column"));
    oldColumns.forEach((column) => {
      while (column.firstChild) wrap.appendChild(column.firstChild);
      column.remove();
    });
    wrap.classList.remove("masonry-columns--js");
    splitIntoColumns(wrap);
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

    // 有登录态、但身份没读出来（/rest/v1/profiles 那一下失败）：
    // 重试一次；还不行就明确报错 + 给重试按钮。
    // 绝不能落到下面的「未登录」分支 —— 那会让人以为掉登录了；
    // 更不能当成普通用户 —— 那等于把发布者悄悄降成只读。
    if (session && !profile) {
      profile = await hs.getProfile();
    }
    if (session && !profile) {
      boardEl.classList.add("homework-board--prompt");
      boardEl.innerHTML = `
        <div class="homework-empty-state homework-empty-state--prompt">
          <m3e-icon variant="outlined" name="error"></m3e-icon>
          <m3e-heading variant="title" size="large" level="2">没读到你的身份</m3e-heading>
          <m3e-button variant="filled" id="retry-profile-button">重试</m3e-button>
        </div>`;
      showStatus("登录状态是好的，但读取角色失败了（多半是网络抖动）。点「重试」即可。", true);
      document.getElementById("retry-profile-button")?.addEventListener("click", () => location.reload());
      return;
    }

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
      const manageUsersButton = document.getElementById("manage-users-button");
      if (manageUsersButton) manageUsersButton.hidden = !hs.isPublisher(profile);
      const securityLink = document.getElementById("security-link");
      if (securityLink) {
        securityLink.hidden = false;
        securityLink.addEventListener("click", () => location.assign("security.html"));
      }

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

    /** 编辑/新建共用一个对话框：标题与保存动作按 dataset.id 区分 */
    function setEditDialogMode(creating) {
      const title = document.getElementById("edit-dialog-title");
      if (title) title.textContent = creating ? "新建作业" : "修改作业";
    }

    function openEdit(id) {
      if (!ensureCanManage()) {
        hs.toast("你的修改权限已被撤销");
        return;
      }
      const row = findRow(id);
      if (!row || !editDialog) return;
      if (isRowExpired(row)) {
        hs.toast("已过期的作业不能修改");
        return;
      }
      setEditDialogMode(false);
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

    /**
     * 在真正要用权限的时候，拿"当前角色"再对一次账。
     *
     * canManage 是页面加载时算出来的缓存值，中间任何一次角色同步出岔子都可能让它停在
     * false —— 表现就是"我明明是发布者，新建作业却说没权限"。
     * 这里只做"恢复"（角色确实还是发布者/管理员就把它放回来），不做"撤销"
     * （撤销由 syncPermissions 在角色真的变了时负责）。
     * 后端 RLS 仍然是最终关卡，所以这里放宽不会造成越权。
     */
    function ensureCanManage() {
      if (!canManage && profile && hs.canEditToday(profile)) canManage = true;
      return canManage;
    }

    /**
     * 新建作业：和「修改作业」用的是同一个对话框，只是标题换成「新建」、字段清空。
     * 保存时走 create_homework（单条插入），不会像发布页那样覆盖当天整批作业。
     */
    function openCreate() {
      if (!ensureCanManage() || !editDialog) {
        if (!canManage) hs.toast("你没有新建作业的权限");
        return;
      }
      setEditDialogMode(true);
      document.getElementById("edit-subject").value = "";
      document.getElementById("edit-tags").value = "";
      const duePicker = document.getElementById("edit-due-picker");
      const dueInput = document.getElementById("edit-due-input");
      if (dueInput) dueInput.value = "";
      if (duePicker) duePicker.date = null;
      const editor = document.getElementById("edit-content");
      editor.innerHTML = "";
      setDialogMessage("edit-message", "");
      delete editDialog.dataset.id;
      editDialog.show();
      window.setTimeout(() => editor.focus(), 80);
    }

    async function saveEdit() {
      if (!editDialog || !ensureCanManage()) return;
      const id = editDialog.dataset.id;
      const creating = !id;
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

      if (!content && !contentHtml) {
        setDialogMessage("edit-message", "内容不能为空。");
        return;
      }

      saveButton.setAttribute("disabled", "");

      // 新建走 RPC（单条插入）；修改就是普通的 update
      const { error } = creating
        ? await client.rpc("create_homework", {
            p_subject: subject,
            p_content: content,
            p_content_html: contentHtml || null,
            p_tags: tags,
            p_due_date: due || null,
          })
        : await client
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
        const denied = String(error.message).includes("row-level security") || error.code === "42501";
        // 被拒时把"页面认为你是什么身份"写出来 —— 这类问题多半出在
        // 前端拿到的角色不对（比如某次角色读取失败），只说"没权限"根本查不下去。
        const who = `${hs.roleLabel(profile?.role || "user")}${profile?.email ? `（${profile.email}）` : ""}`;
        setDialogMessage(
          "edit-message",
          denied
            ? creating
              ? `新建失败：只有发布者与管理员可以新建作业。页面当前认为你是：${who}。`
              : `保存失败：只能修改未过期的作业。页面当前认为你是：${who}。`
            : `${creating ? "新建" : "保存"}失败：${error.message}`,
        );
        return;
      }
      editDialog.hide();
      hs.toast(creating ? "已新建" : "已保存");
      await refresh();
    }

    function openDelete(id) {
      if (!ensureCanManage()) {
        hs.toast("你的修改权限已被撤销");
        return;
      }
      const row = findRow(id);
      if (row && isRowExpired(row)) {
        hs.toast("已过期的作业不能删除");
        return;
      }
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
            ? "删除失败：只能删除未过期的作业。"
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

    // ---------- 图片放大查看（灯箱） ----------

    const lightboxEl = document.getElementById("image-lightbox");
    const lightboxImage = document.getElementById("lightbox-image");
    const lightboxDownloadLabel = document.getElementById("lightbox-download-label");
    let lightboxSrc = "";
    /** 触发这次放大的那张原图：关闭时用它算"飞回原位"的目标位置 */
    let lightboxSourceImage = null;

    /**
     * 只有**应用内**才写「保存到手机」（那里点了会走系统下载管理器）。
     * 不能用"是不是触屏"来判断 —— 带触摸屏的电脑同样会被判成触屏，
     * 结果桌面端也显示「保存到手机」，很怪。
     */
    const isInApp = location.hostname === "appassets.androidplatform.net";
    if (lightboxDownloadLabel && isInApp) lightboxDownloadLabel.textContent = "保存到手机";

    let lightboxCleanup = null;
    /** 正在播关闭动画：这段时间内忽略重复的关闭请求，避免动画被打断 */
    let closingLightbox = false;

    /**
     * 是不是"真有鼠标"的设备。
     *
     * 只看媒体查询 + 有没有触摸事件：手机上 ontouchstart 一定存在，
     * 而且媒体查询会报 hover: none，所以手机（含手机浏览器打开网页）拿不到这个效果。
     * 不使用 navigator.maxTouchPoints —— 无头浏览器/个别桌面浏览器会给出很大的值，
     * 会把桌面误判成触屏。
     */
    function hasFinePointer() {
      if ("ontouchstart" in window) return false;
      for (const query of ["(hover: hover) and (pointer: fine)", "(any-hover: hover) and (any-pointer: fine)"]) {
        if (window.matchMedia && window.matchMedia(query).matches) return true;
      }
      return false;
    }

    /**
     * "电子收藏卡"式的跟随倾斜。
     *
     * 桌面：鼠标在图片里 → 鼠标所在那一角朝用户靠近；移出 → 平滑回正。
     * 手机：按住图片约 0.26 秒后同样进入倾斜，手指拖动改变倾角，松手回正
     *       （这样手机上也能玩到这个效果）。
     *
     * 两个手感细节：
     *   1. 所有变化都走缓动逼近，不做"即时赋值" —— 移入/移出不会生硬；
     *   2. 缓动系数取小一点（0.14），拖动时有一点点"重量感"，
     *      完全跟手反而很假。
     */
    function attachCardTilt() {
      const fine = hasFinePointer();
      const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
      if (!fine && !hasTouch) return () => {};

      const MAX_TILT = 8;   // 度；再大就假了
      const LIFT = 6;       // 抬起多少像素
      // 缓动系数：0.14 太小了 —— 每帧只走 14%，要十几帧（200ms+）才追上，
      // 手感上就是"很卡、拖不动"。0.45 仍有一点重量感，但基本跟手。
      const EASE = 0.45;
      const HOLD_MS = 120;  // 手机：按住一小会儿进入倾斜（轻点关闭不会误触发）
      // 手指移动超过这个距离就直接进入倾斜，不用等长按
      const DRAG_SLOP = 6;

      let frame = 0;
      let curX = 0;
      let curY = 0;
      let curLift = 0;
      let wantX = 0;
      let wantY = 0;
      let wantLift = 0;
      let holdTimer = 0;

      const tick = () => {
        curX += (wantX - curX) * EASE;
        curY += (wantY - curY) * EASE;
        curLift += (wantLift - curLift) * EASE;
        lightboxImage.style.transform =
          `rotateX(${curX.toFixed(3)}deg) rotateY(${curY.toFixed(3)}deg) translateZ(${curLift.toFixed(2)}px)`;
        // 足够接近就停帧，省电；重新有目标时会再启动
        const settled =
          Math.abs(wantX - curX) < 0.02 &&
          Math.abs(wantY - curY) < 0.02 &&
          Math.abs(wantLift - curLift) < 0.02;
        if (settled) {
          curX = wantX;
          curY = wantY;
          curLift = wantLift;
          lightboxImage.style.transform =
            `rotateX(${curX.toFixed(3)}deg) rotateY(${curY.toFixed(3)}deg) translateZ(${curLift.toFixed(2)}px)`;
          frame = 0;
          return;
        }
        frame = requestAnimationFrame(tick);
      };

      const ensureRunning = () => {
        if (!frame) frame = requestAnimationFrame(tick);
      };

      const neutral = () => {
        wantX = 0;
        wantY = 0;
        wantLift = 0;
        ensureRunning();
      };

      /** 把屏幕坐标换算成倾角目标值；不在图片内就回正 */
      const aim = (clientX, clientY, active) => {
        if (!active) {
          neutral();
          return;
        }
        const rect = lightboxImage.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const inside =
          clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom;
        if (!inside) {
          neutral();
          return;
        }
        const px = (clientX - rect.left) / rect.width;
        const py = (clientY - rect.top) / rect.height;
        wantY = (px - 0.5) * 2 * MAX_TILT;
        wantX = (0.5 - py) * 2 * MAX_TILT;
        wantLift = LIFT;
        ensureRunning();
      };

      let touching = false;
      let tiltActive = false;
      let startX = 0;
      let startY = 0;

      const onPointerMove = (event) => {
        if (event.pointerType === "touch") return; // 触摸走下面那套
        aim(event.clientX, event.clientY, true);
      };

      const onPointerLeave = () => {
        if (touching) return;
        neutral();
      };

      const onTouchStart = (event) => {
        touching = true;
        tiltActive = false;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        window.clearTimeout(holdTimer);
        // 按住一小会儿就进入倾斜（轻点关闭浮层时不会误触发）
        holdTimer = window.setTimeout(() => {
          if (!touching) return;
          tiltActive = true;
          aim(touch.clientX, touch.clientY, true);
        }, HOLD_MS);
      };

      const onTouchMove = (event) => {
        if (!touching) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;

        // 手指一动就进入倾斜（不必等长按），并**阻止页面跟着滚**。
        // 之前这里注册的是 { passive: true }，等于放弃了 preventDefault，
        // 所以拖动图片时页面会一起上下滚。
        if (!tiltActive) {
          const dx = Math.abs(touch.clientX - startX);
          const dy = Math.abs(touch.clientY - startY);
          if (dx > DRAG_SLOP || dy > DRAG_SLOP) {
            tiltActive = true;
            window.clearTimeout(holdTimer);
          }
        }
        if (tiltActive) {
          event.preventDefault();
          aim(touch.clientX, touch.clientY, true);
        }
      };

      const onTouchEnd = () => {
        touching = false;
        tiltActive = false;
        window.clearTimeout(holdTimer);
        neutral();
      };

      if (fine) {
        lightboxEl.addEventListener("pointermove", onPointerMove);
        lightboxEl.addEventListener("pointerleave", onPointerLeave);
      }
      if (hasTouch) {
        // touchmove 必须是 passive: false 才能 preventDefault（阻止滚动）
        lightboxEl.addEventListener("touchstart", onTouchStart, { passive: true });
        lightboxEl.addEventListener("touchmove", onTouchMove, { passive: false });
        lightboxEl.addEventListener("touchend", onTouchEnd, { passive: true });
        lightboxEl.addEventListener("touchcancel", onTouchEnd, { passive: true });
      }

      return () => {
        window.clearTimeout(holdTimer);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lightboxEl.removeEventListener("pointermove", onPointerMove);
        lightboxEl.removeEventListener("pointerleave", onPointerLeave);
        lightboxEl.removeEventListener("touchstart", onTouchStart);
        lightboxEl.removeEventListener("touchmove", onTouchMove);
        lightboxEl.removeEventListener("touchend", onTouchEnd);
        lightboxEl.removeEventListener("touchcancel", onTouchEnd);
      };
    }

    /**
     * 打开灯箱：
     *   1. 图片从它在卡片里的位置"飞"到屏幕中间放大（用 clip-path 裁剪展开，
     *      这样图片本身不用变形，也就不和后面的 3D 倾斜打架）；
     *   2. 落地后开启跟随鼠标的倾斜。
     */
    function openLightbox(image) {
      if (!lightboxEl || !lightboxImage) return;
      lightboxSrc = image.currentSrc || image.src || "";
      lightboxSourceImage = image;

      const from = image.getBoundingClientRect();
      // 上一轮如果还在收尾（或动画留了 fill 残留），先全部取消，
      // 否则第二次打开会被旧动画的内联样式盖住：看着像没打开
      closingLightbox = false;
      clearLightboxAnimations();
      lightboxEl.hidden = false;
      lightboxImage.src = lightboxSrc;
      lightboxImage.alt = image.alt || "放大的图片";
      // 清掉上一轮可能留下的内联尺寸，否则终态会算不准
      lightboxImage.style.width = "";
      lightboxImage.style.height = "";
      lightboxImage.style.transition = "";
      lightboxImage.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0px)";
      lightboxImage.style.opacity = "";

      const playFlip = () => {
        const to = lightboxImage.getBoundingClientRect();
        const fromWidth = from.width || to.width;
        const fromHeight = from.height || to.height;
        if (to.width <= 0 || to.height <= 0 || fromWidth <= 0 || fromHeight <= 0) return;

        // 大图已经就位，这时候才把卡片里那张原图藏起来。
        // 藏早了（大图还在加载）会出现"两张都看不见"的空档；
        // 不藏的话，放大图飞到中间后原位置还留着一张小图 —— 看着就像没动过。
        hideSourceImage();

        const dx = (from.left + fromWidth / 2) - (to.left + to.width / 2);
        const dy = (from.top + fromHeight / 2) - (to.top + to.height / 2);
        const scale = Math.min(fromWidth / to.width, fromHeight / to.height);

        // 用 Web Animations：第一帧就带着"从原位置+原大小"出发，
        // 浏览器一定播得出来（之前用 clip-path 配 requestAnimationFrame，
        // 样式在同一帧里被合并，动画根本没触发）。
        try {
          const animation = lightboxImage.animate(
            [
              { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: "8px" },
              { transform: "translate(0px, 0px) scale(1)", borderRadius: "12px" },
            ],
            {
              duration: 320,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
              fill: "both",
            }
          );
          animation.addEventListener("finish", () => {
            try {
              animation.cancel();
            } catch (ignored) {
              /* 忽略 */
            }
          });
        } catch (error) {
          /* 不支持 Web Animations 就直接显示终态 */
        }
      };

      if (lightboxImage.complete) playFlip();
      else lightboxImage.addEventListener("load", playFlip, { once: true });

      // 背景变暗+模糊、底部按钮淡入上浮
      animateLightboxIn();

      const detachTilt = attachCardTilt();

      // 飞入过程中如果窗口尺寸变了，直接落到终态，避免错位
      const onResize = () => {
        lightboxImage.style.transition = "";
      };
      window.addEventListener("resize", onResize);

      lightboxCleanup = () => {
        window.removeEventListener("resize", onResize);
        detachTilt();
        lightboxCleanup = null;
      };
    }

    /**
     * 灯箱打开期间把卡片里的原图藏起来。
     * 用 visibility 而不是 display/opacity：visibility 保留盒子，
     * 关闭时那张图"飞回来"要用的 getBoundingClientRect() 才不会变成 0。
     */
    function hideSourceImage() {
      if (lightboxSourceImage) lightboxSourceImage.style.visibility = "hidden";
    }

    function showSourceImage() {
      if (lightboxSourceImage) lightboxSourceImage.style.visibility = "";
    }

    /** 真正收尾：停掉动画、清掉 src 与残留，避免大图占内存、下次打开带旧位移 */
    function finishCloseLightbox() {
      lightboxCleanup?.();
      // 出场动画用 fill:both，结束后必须显式取消，否则它留下的内联样式
      // 会盖在元素上 —— 表现就是"第二次打开什么都没了，只有关闭动画"
      clearLightboxAnimations();
      lightboxEl.hidden = true;
      showSourceImage();
      if (lightboxImage) {
        lightboxImage.removeAttribute("src");
        lightboxImage.style.transition = "";
        lightboxImage.style.transform = "rotateX(0deg) rotateY(0deg) translateZ(0px)";
        lightboxImage.style.opacity = "";
      }
      const actions = lightboxEl.querySelector(".lightbox__actions");
      if (actions) actions.style.opacity = "";
      lightboxSrc = "";
      lightboxSourceImage = null;
    }

    /** 取消灯箱上所有还在生效的动画（含 fill 残留） */    function clearLightboxAnimations() {
      if (!lightboxEl) return;
      try {
        if (lightboxEl.getAnimations) {
          lightboxEl.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
        }
      } catch (error) {
        /* 忽略 */
      }
    }

    /** 关闭：先播淡出动画，动画结束再隐藏 */
    function closeLightbox() {
      if (!lightboxEl || lightboxEl.hidden) return;
      if (closingLightbox) return;
      closingLightbox = true;
      animateLightboxOut(() => {
        closingLightbox = false;
        finishCloseLightbox();
      });
    }

    function guessImageName(src) {
      const raw = String(src || "").split("?")[0].split("#")[0];
      const last = decodeURIComponent(raw.split("/").pop() || "");
      if (last && last.includes(".")) return last;
      return `作业图片-${todayString()}.jpg`;
    }

    /**
     * 保存图片。
     *
     * 两种环境分开处理：
     *   - App 内：`a[download]` 会被 WebView 的 DownloadListener 接住，交给系统下载管理器；
     *   - 普通浏览器：跨域地址上的 download 属性会被忽略（点了根本不下载，只会跳转），
     *     所以先用 fetch 取成 blob 再下载；取不到就退化成新标签打开，让用户长按保存。
     */
    async function downloadLightboxImage() {
      if (!lightboxSrc) return;
      const name = guessImageName(lightboxSrc);
      const button = document.getElementById("lightbox-download");
      const originalText = lightboxDownloadLabel ? lightboxDownloadLabel.textContent : "";

      const saveBlob = (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      };

      if (isInApp) {
        // App 里交给系统下载管理器（DownloadListener → DownloadManager）
        const link = document.createElement("a");
        link.href = lightboxSrc;
        link.download = name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        hs.toast("已交给系统下载管理器保存");
        return;
      }

      button?.setAttribute("disabled", "");
      if (lightboxDownloadLabel) lightboxDownloadLabel.textContent = "正在保存…";
      try {
        const response = await fetch(lightboxSrc, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        saveBlob(await response.blob());
        hs.toast("已开始下载");
      } catch (error) {
        // 取不到就退化成"打开图片"，至少用户可以长按保存
        hs.toast("已在新标签打开，长按图片即可保存");
        window.open(lightboxSrc, "_blank", "noopener");
      } finally {
        button?.removeAttribute("disabled");
        if (lightboxDownloadLabel) lightboxDownloadLabel.textContent = originalText || "下载图片";
      }
    }

    if (lightboxEl) {
      document.getElementById("lightbox-close")?.addEventListener("click", closeLightbox);
      document.getElementById("lightbox-download")?.addEventListener("click", downloadLightboxImage);
      // 点图片以外的空白处关闭
      lightboxEl.addEventListener("click", (event) => {
        if (event.target === lightboxEl) closeLightbox();
      });
      // Esc 关闭
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !lightboxEl.hidden) closeLightbox();
      });
    }

    /** 灯箱入场：背景由透明变暗并渐显模糊，图片飞入，底部按钮随后淡入上浮 */
    function animateLightboxIn() {
      try {
        lightboxEl.animate(
          [
            { backgroundColor: "rgba(12, 18, 20, 0)", backdropFilter: "blur(0px)", webkitBackdropFilter: "blur(0px)" },
            { backgroundColor: "rgba(12, 18, 20, 0.88)", backdropFilter: "blur(2px)", webkitBackdropFilter: "blur(2px)" },
          ],
          { duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "both" }
        );
      } catch (error) {
        /* 不支持就保持静态样式 */
      }

      const actions = lightboxEl.querySelector(".lightbox__actions");
      if (actions && actions.animate) {
        actions.animate(
          [
            { opacity: 0, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0px)" },
          ],
          { duration: 260, delay: 120, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "both" }
        );
      }
    }

    /** 灯箱出场：按钮与图片先淡出，背景再褪成透明 —— 播完才真正隐藏 */
    function animateLightboxOut(onDone) {
      // 让图片"飞回它原来在卡片里的位置"，而不是原地淡出。
      // 卡片可能已经滚出视口，那就先把页面滚回去（平滑滚动），滚动完再飞 ——
      // 否则图片会飞向屏幕外，看着莫名其妙。
      const target = lightboxSourceImage;
      const rect = target && document.contains(target) ? target.getBoundingClientRect() : null;
      const inView = rect && rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth;

      if (target && rect && !inView) {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (error) {
          target.scrollIntoView();
        }
        window.setTimeout(() => playOut(onDone), 320);
        return;
      }
      playOut(onDone);
    }

    function playOut(onDone) {
      const actions = lightboxEl.querySelector(".lightbox__actions");
      const animations = [];

      if (actions && actions.animate) {
        animations.push(
          actions.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" }
          )
        );
      }

      // 图片：按原位置/原大小飞回去（FLIP 的逆过程）
      const target = lightboxSourceImage;
      const rect = target && document.contains(target) ? target.getBoundingClientRect() : null;
      let flying = false;
      if (rect && lightboxImage && lightboxImage.animate && rect.width > 0 && rect.height > 0) {
        const here = lightboxImage.getBoundingClientRect();
        if (here.width > 0 && here.height > 0) {
          const dx = (rect.left + rect.width / 2) - (here.left + here.width / 2);
          const dy = (rect.top + rect.height / 2) - (here.top + here.height / 2);
          const scale = Math.min(rect.width / here.width, rect.height / here.height);
          flying = true;
          animations.push(
            lightboxImage.animate(
              [
                { transform: "translate(0px, 0px) scale(1)", opacity: 1, borderRadius: "12px" },
                { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.15, borderRadius: "8px" },
              ],
              { duration: 340, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "both" }
            )
          );
        }
      }
      if (!flying && lightboxImage && lightboxImage.animate) {
        // 找不到原图就退回淡出
        animations.push(
          lightboxImage.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: 180, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "both" }
          )
        );
      }

      if (lightboxEl.animate) {
        // 背景等图片飞得差不多了再褪掉
        animations.push(
          lightboxEl.animate(
            [
              { backgroundColor: "rgba(12, 18, 20, 0.88)", backdropFilter: "blur(2px)", webkitBackdropFilter: "blur(2px)" },
              { backgroundColor: "rgba(12, 18, 20, 0)", backdropFilter: "blur(0px)", webkitBackdropFilter: "blur(0px)" },
            ],
            {
              duration: 220,
              delay: flying ? 160 : 60,
              easing: "cubic-bezier(0.4, 0, 1, 1)",
              fill: "both",
            }
          )
        );
      }

      if (!animations.length) {
        onDone();
        return;
      }
      let remaining = animations.length;
      let settled = false;
      const finish = () => {
        if (settled) return;
        remaining -= 1;
        if (remaining <= 0) {
          settled = true;
          onDone();
        }
      };
      animations.forEach((animation) => {
        animation.addEventListener("finish", finish);
        animation.addEventListener("cancel", finish);
      });
    }

    /** 图片桶路径是 "YYYY-MM-DD/uuid.ext"，日期说明它属于哪一天 */
    function imageOwnDate(src) {
      const match = String(src || "").match(/\/(\d{4}-\d{2}-\d{2})\//);
      return match ? match[1] : "";
    }

    function daysSince(dateText) {
      if (!dateText) return 0;
      const then = new Date(`${dateText}T00:00:00`);
      if (Number.isNaN(then.getTime())) return 0;
      const today = new Date(`${todayString()}T00:00:00`);
      return Math.round((today - then) / 86400000);
    }

    /**
     * 图片加载失败时分两种，别让用户误会：
     *   - 很久以前的图片：桶是 1 GB 上限，装不下时会从最早的日期开始清理，
     *     所以老图 404 基本就是被清掉了 → 「图片已过期」；
     *   - 近期图片：多半只是网络/临时故障 → 「图片加载失败」并可以点一下重试。
     *
     * 注意图片的 error 事件不冒泡，必须用捕获阶段监听。
     */
    boardEl.addEventListener(
      "error",
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        if (image.dataset.failedPlaceholder === "1") return;

        const url = image.currentSrc || image.src || "";
        const age = daysSince(imageOwnDate(url));
        const expired = age > IMAGE_KEEP_DAYS;

        const box = document.createElement("span");
        box.className = expired ? "image-expired" : "image-failed";
        box.innerHTML = expired
          ? '<m3e-icon variant="outlined" name="broken_image"></m3e-icon><span>图片已过期（旧图片会按容量自动清理）</span>'
          : '<m3e-icon variant="outlined" name="broken_image"></m3e-icon><span>图片加载失败，点这里重试</span>';

        if (!expired) {
          // 点一下就重新加载同一张图
          box.dataset.retrySrc = url;
          box.setAttribute("role", "button");
          box.tabIndex = 0;
        }
        image.dataset.failedPlaceholder = "1";
        image.replaceWith(box);
      },
      true,
    );

    /** 点「加载失败」的占位块 = 重试 */
    const retryImage = (target) => {
      const box = target.closest(".image-failed");
      if (!box || !box.dataset.retrySrc) return false;
      const image = document.createElement("img");
      image.src = box.dataset.retrySrc;
      image.alt = "作业图片";
      box.replaceWith(image);
      return true;
    };

    boardEl.addEventListener("click", (event) => {
      if (retryImage(event.target)) {
        event.stopPropagation();
        event.preventDefault();
      }
    });
    boardEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (retryImage(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    /**
     * 鼠标停在图片上时给卡片打个标记，让卡片的悬停/按下反馈让位给图片自己的
     * 伪 3D 上浮（见 app.css 里的 [data-hover-image]）。触摸设备不会有 hover。
     */
    const setImageHover = (on, item) => {
      if (!item) return;
      if (on) item.dataset.hoverImage = "1";
      else delete item.dataset.hoverImage;
    };

    boardEl.addEventListener("mouseover", (event) => {
      const image = event.target.closest(".homework-text img");
      if (!image || !boardEl.contains(image)) return;
      setImageHover(true, image.closest(".homework-item"));
    });

    boardEl.addEventListener("mouseout", (event) => {
      const image = event.target.closest(".homework-text img");
      if (!image || !boardEl.contains(image)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && image.contains(next)) return;
      setImageHover(false, image.closest(".homework-item"));
    });

    boardEl.addEventListener("click", (event) => {
      // 点正文里的图片 → 放大查看（灯箱）；不这么做的话会被下面的作业项选中逻辑吃掉
      const image = event.target.closest("img");
      if (image && boardEl.contains(image)) {
        event.stopPropagation();
        openLightbox(image);
        return;
      }

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
      if (item.classList.contains("homework-item--expired")) {
        hs.toast("已过期的作业不能修改");
        return;
      }
      if (!item.classList.contains("homework-item--clickable")) {
        hs.toast("你没有修改这条作业的权限");
        return;
      }
      // 只切 class：不重绘 → 多栏布局不重排、过渡能真正播放
      const nextId = selectedId === item.dataset.id ? null : item.dataset.id;
      selectedId = nextId;
      const items = boardEl.querySelectorAll(".homework-item");
      for (const node of items) {
        node.classList.toggle("homework-item--selected", nextId !== null && node.dataset.id === nextId);
      }
    });


    // ---------- 权限实时核对 ----------
    /**
     * 角色可能被管理员随时改掉：定时、回到页面、以及每次操作前都重新核对，
     * 避免"撤销管理员后不刷新仍能继续修改"。
     */
    async function syncPermissions() {
      if (!currentDate) return;
      try {
        const latest = await hs.getProfile();
        if (!latest) return;
        // 「可编辑」只看角色，不看日期：过不过期是逐条判定的（RLS 与前端同一套规则）
        const nextCanManage = Boolean(hs.canEditToday(latest));
        const changed = !profile || latest.role !== profile.role || nextCanManage !== canManage;
        profile = latest;
        if (!changed) return;

        canManage = nextCanManage;
        if (!canManage) selectedId = null;
        if (accountRole) accountRole.textContent = hs.roleLabel(latest.role);
        const manageUsersButton = document.getElementById("manage-users-button");
        if (manageUsersButton) manageUsersButton.hidden = !hs.isPublisher(latest);
        if (publishLink) publishLink.hidden = !hs.isPublisher(latest);
        renderBoard(currentRows);
        hs.toast(nextCanManage ? "权限已更新" : "你的修改权限已被撤销");
      } catch (error) {
        /* 网络抖动忽略，下次再核对 */
      }
    }

    // 交互即查（点一下就核对权限，节流 2 秒）+ 30 秒轮询兜底
    let lastSync = 0;
    function syncThrottled() {
      const now = Date.now();
      if (now - lastSync < 2000) return;
      lastSync = now;
      void syncPermissions();
    }
    window.setInterval(() => void syncPermissions(), 30000);
    window.addEventListener("focus", () => void syncPermissions());
    document.addEventListener("pointerdown", syncThrottled);
    document.addEventListener("keydown", syncThrottled);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void syncPermissions();
    });
    // ---------- 管理用户（仅发布者） ----------
    const usersDialog = document.getElementById("users-dialog");
    const usersList = document.getElementById("users-list");

    async function loadUsers() {
      if (!usersList) return;
      usersList.innerHTML = '<p class="hint">正在加载…</p>';
      const { data, error } = await client.rpc("admin_list_users");
      if (error) {
        usersList.innerHTML = `<p class="status status--error">${hs.escapeHtml(error.message)}</p>`;
        return;
      }
      const users = data || [];
      if (!users.length) {
        usersList.innerHTML = '<p class="hint">还没有其他用户。</p>';
        return;
      }
      usersList.innerHTML = users
        .map((user) => {
          const isPublisherRow = user.role === "publisher";
          const roleAction = user.role === "admin" ? "user" : "admin";
          return `
            <div class="user-row">
              <div class="user-row__info">
                <strong>${hs.escapeHtml(user.email || "（无邮箱）")}</strong>
                <span class="role-chip">${hs.roleLabel(user.role)}${user.banned ? " · 已封禁" : ""}</span>
              </div>
              ${isPublisherRow
                ? '<span class="hint">不可修改</span>'
                : `<div class="user-row__actions">
                     <m3e-button variant="text" data-uid="${user.id}" data-act="role" data-role="${roleAction}">${user.role === "admin" ? "移除管理员" : "设为管理员"}</m3e-button>
                     <m3e-button variant="text" data-uid="${user.id}" data-act="ban" data-ban="${user.banned ? "false" : "true"}">${user.banned ? "解封" : "封禁"}</m3e-button>
                   </div>`}
            </div>`;
        })
        .join("");

      usersList.querySelectorAll("[data-act]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.setAttribute("disabled", "");
          const { error: actionError } =
            button.dataset.act === "role"
              ? await client.rpc("admin_set_role", { p_user_id: button.dataset.uid, p_role: button.dataset.role })
              : await client.rpc("admin_set_banned", { p_user_id: button.dataset.uid, p_banned: button.dataset.ban === "true" });
          button.removeAttribute("disabled");
          if (actionError) {
            hs.toast(actionError.message);
            return;
          }
          hs.toast("已更新");
          await loadUsers();
        });
      });
    }

    document.getElementById("manage-users-button")?.addEventListener("click", () => {
      usersDialog?.show();
      void loadUsers();
    });
    document.getElementById("users-close")?.addEventListener("click", () => usersDialog?.hide());

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

    // 把右下角按钮移出 <m3e-theme>：主题元素会建立包含块，导致 fixed 定位跟着页面滚动"飞"
    if (fabHost && fabHost.parentElement !== document.body) document.body.appendChild(fabHost);

    if (fabHost && mode === "latest") {
      if (profile && hs.canEditToday(profile)) {
        // 新建作业 = 打开发布页；只有发布者能发布，所以这一项也只给发布者看
        const canPublish = hs.isPublisher(profile);
        fabHost.innerHTML = `
          <m3e-fab variant="primary" aria-label="编辑">
            <m3e-fab-menu-trigger for="fab-menu">
              <m3e-icon variant="outlined" name="edit"></m3e-icon>
            </m3e-fab-menu-trigger>
          </m3e-fab>
          <m3e-fab-menu id="fab-menu" variant="primary">
            ${canPublish ? `<m3e-fab-menu-item id="fab-new">
              <m3e-icon variant="outlined" slot="icon" name="assignment"></m3e-icon>
              新建作业
            </m3e-fab-menu-item>` : ""}
            ${canPublish ? `<m3e-fab-menu-item id="fab-publish">
              <m3e-icon variant="outlined" slot="icon" name="upload_file"></m3e-icon>
              发布作业
            </m3e-fab-menu-item>` : ""}
            <m3e-fab-menu-item id="fab-save">
              <m3e-icon variant="outlined" slot="icon" name="ios_share"></m3e-icon>
              导出作业
            </m3e-fab-menu-item>
            
          </m3e-fab-menu>`;
        document.getElementById("fab-new")?.addEventListener("click", () => openCreate());
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
              expired: isRowExpired(row),
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
    const today = todayString();

    // 日期字段的绑定已经在 setupDateField() 里做过一次，这里只更新可选范围
    applyDateLimits(today);

    if (!batches.length) {
      if (mode === "date") showPickPrompt();
      else {
        renderEmpty("还没有发布过作业");
        showStatus("后端还没有任何作业记录。");
      }
      return;
    }

    if (mode === "date") {
      // 每次打开都从「请选择一个日期」开始，不按地址栏里的 date 自动加载
      showPickPrompt();
      return;
    }

    await loadLatest();
  }

  // 日期字段在这里就绑好（不放进 init 的 await 之后）：M3E 组件升级和会话检查
  // 都要花时间，绑晚了开屏这几秒点日期框会没反应。
  setupDateField();

  void init();
})();























