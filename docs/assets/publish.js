/**
 * 发布页：把桌面端导出的 JSON 整份发布到某一天（仅发布者）
 *
 * 组件用 M3E，与桌面端同款；按钮是自定义元素，因此提交逻辑挂在 click 上，
 * 同时保留表单的 submit 事件以便在输入框里按回车也能提交。
 */
(function () {
  const { client } = hs;

  const gateEl = document.getElementById("gate");
  const formEl = document.getElementById("publish-form");
  const dateInput = document.getElementById("publish-date");
  const fileInput = document.getElementById("publish-file");
  const textarea = document.getElementById("publish-json");
  const submitButton = document.getElementById("publish-submit");
  const messageEl = document.getElementById("message");
  const previewEl = document.getElementById("preview");
  const backButton = document.getElementById("back-button");

  function showMessage(text, isError = true) {
    messageEl.textContent = text;
    messageEl.classList.toggle("status--error", isError);
    messageEl.hidden = !text;
  }

  function summarize(payload) {
    const subjects = Array.isArray(payload?.subjects) ? payload.subjects : null;
    if (!subjects) return null;
    let homeworkCount = 0;
    const lines = subjects.map((subject) => {
      const count = Array.isArray(subject.homeworks) ? subject.homeworks.length : 0;
      homeworkCount += count;
      return `${subject.subject || "其它"}：${count} 条`;
    });
    return { subjectCount: subjects.length, homeworkCount, lines };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsText(file, "utf-8");
    });
  }

  function updatePreview() {
    const text = textarea.value.trim();
    if (!text) {
      previewEl.hidden = true;
      return;
    }
    try {
      const summary = summarize(JSON.parse(text));
      previewEl.textContent = summary
        ? `共 ${summary.homeworkCount} 条作业 / ${summary.subjectCount} 个科目：${summary.lines.join("、")}`
        : "JSON 里没有 subjects 数组，可能不是桌面端导出的作业文件。";
      previewEl.classList.remove("status--error");
      previewEl.hidden = false;
    } catch (error) {
      previewEl.textContent = `JSON 解析失败：${error.message}`;
      previewEl.classList.add("status--error");
      previewEl.hidden = false;
    }
  }

  async function doPublish() {
    const date = dateInput.value;
    if (!date) {
      showMessage("请选择这批作业归属的日期。");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(textarea.value);
    } catch (error) {
      showMessage(`JSON 解析失败：${error.message}`);
      return;
    }

    submitButton.setAttribute("disabled", "");
    showMessage("正在发布…", false);

    const { data, error } = await client.rpc("publish_homeworks", { p_payload: payload, p_published_on: date });

    submitButton.removeAttribute("disabled");
    if (error) {
      showMessage(
        String(error.message || "").includes("只有发布者")
          ? "发布失败：只有发布者可以发布作业。"
          : `发布失败：${error.message}`,
      );
      return;
    }

    const removed = data?.pruned?.removedDays || 0;
    showMessage(
      `发布成功：${date} 共 ${data.homeworkCount} 条作业 / ${data.subjectCount} 个科目（批号 ${data.batchId}）。` +
        (removed ? ` 存储超限，已删除最旧的 ${removed} 天记录。` : ""),
      false,
    );
    hs.toast("作业已发布");
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      textarea.value = await readFile(file);
      updatePreview();
      showMessage("");
    } catch (error) {
      showMessage(error.message);
    }
  });

  textarea.addEventListener("input", updatePreview);
  submitButton.addEventListener("click", () => void doPublish());
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    void doPublish();
  });
  if (backButton) backButton.addEventListener("click", () => location.assign("index.html"));

  void (async () => {
    const session = await hs.requireSession();
    if (!session) return;

    const profile = await hs.getProfile();
    if (!hs.isPublisher(profile)) {
      gateEl.hidden = false;
      formEl.hidden = true;
      return;
    }

    gateEl.hidden = true;
    formEl.hidden = false;
    dateInput.value = hs.todayString();
  })();
})();
