/**
 * 发布页：把桌面端导出的 JSON 整份发布到某一天（仅发布者 / 管理员）
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

  function showMessage(text, isError = true) {
    messageEl.textContent = text;
    messageEl.classList.toggle("status--error", isError);
    messageEl.hidden = !text;
  }

  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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

  async function readFile(file) {
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
      const payload = JSON.parse(text);
      const summary = summarize(payload);
      if (!summary) {
        previewEl.textContent = "JSON 里没有 subjects 数组，可能不是桌面端导出的作业文件。";
        previewEl.hidden = false;
        return;
      }
      previewEl.textContent = `共 ${summary.homeworkCount} 条作业 / ${summary.subjectCount} 个科目：${summary.lines.join("、")}`;
      previewEl.hidden = false;
    } catch (error) {
      previewEl.textContent = `JSON 解析失败：${error.message}`;
      previewEl.hidden = false;
    }
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

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
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

    submitButton.disabled = true;
    showMessage("正在发布…", false);
    const { data, error } = await client.rpc("publish_homeworks", {
      p_payload: payload,
      p_published_on: date,
    });
    submitButton.disabled = false;

    if (error) {
      showMessage(`发布失败：${error.message}`);
      return;
    }

    const pruned = data && data.pruned;
    showMessage(
      `发布成功：${date} 共 ${data.homeworkCount} 条作业 / ${data.subjectCount} 个科目（批号 ${data.batchId}）。` +
        (pruned && pruned.removedDays ? ` 存储超限，已删除最旧的 ${pruned.removedDays} 天记录。` : ""),
      false,
    );
  });

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
    dateInput.value = todayString();
  })();
})();
