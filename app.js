const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const reportRow = (report) => `
  <article class="report-row">
    <span class="report-file-icon" aria-hidden="true">PDF</span>
    <div class="report-info"><strong>${escapeHtml(report.name || report.id)}</strong><span>Generated ${escapeHtml(formatDate(report.created_at))}</span></div>
    <span class="report-size">${escapeHtml((report.size_bytes / 1024).toFixed(0))} KB</span>
    <a class="download-link" href="${escapeHtml(report.download_url)}" download aria-label="Download report ${escapeHtml(report.name || report.id)}">Download <span aria-hidden="true">&#8595;</span></a>
  </article>`;

async function getReports() {
  const response = await fetch("/api/reports");
  if (!response.ok) throw new Error("Could not load reports.");
  return response.json();
}

async function loadHome() {
  const reportContainer = document.querySelector("#recent-reports");
  try {
    const reports = await getReports();
    document.querySelector("#report-count").textContent = reports.length;
    reportContainer.innerHTML = reports.length
      ? reports.slice(0, 4).map(reportRow).join("")
      : '<div class="empty-state"><span class="empty-symbol">+</span><strong>No reports yet</strong><p>Confirmed incident reports will appear here.</p><a class="text-link" href="/analyze">Analyze a video <span aria-hidden="true">&#8594;</span></a></div>';
  } catch {
    reportContainer.innerHTML = '<p class="error-copy">Reports could not be loaded. Check that the API is running.</p>';
    document.querySelector("#report-count").textContent = "—";
  }
}

async function loadReports() {
  const container = document.querySelector("#reports-list");
  container.innerHTML = '<p class="muted">Loading reports...</p>';
  try {
    const reports = await getReports();
    container.innerHTML = reports.length
      ? reports.map(reportRow).join("")
      : '<div class="empty-state"><span class="empty-symbol">+</span><strong>Your archive is ready</strong><p>Reports are added here when an analysis confirms an incident.</p><a class="button button-dark" href="/analyze">Analyze a video <span aria-hidden="true">&#8594;</span></a></div>';
  } catch {
    container.innerHTML = '<div class="empty-state"><strong>Archive unavailable</strong><p>Check that the API is running, then refresh.</p></div>';
  }
}

function showAnalysisResult(result) {
  const panel = document.querySelector("#analysis-result");
  const confirmed = Boolean(result.incident_confirmed);
  const snapshots = (result.snapshot_urls || []).map((url) => `
    <a class="snapshot-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
      <img src="${escapeHtml(url)}" alt="Confirmed incident snapshot" loading="lazy">
      <span>Open snapshot <span aria-hidden="true">&#8599;</span></span>
    </a>`).join("");
  const evidence = (result.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const report = result.report_url
    ? `<a class="button button-dark" href="${escapeHtml(result.report_url)}" download>Download incident report <span aria-hidden="true">&#8595;</span></a>`
    : "";
  const chat = confirmed && result.chat_session_id ? `
    <section class="vlm-chat" aria-labelledby="chat-title">
      <div class="chat-heading"><div><p class="eyebrow">GEMMA 3</p><h3 id="chat-title">Ask about this incident</h3></div><span class="chat-context"><span class="status-dot"></span> Snapshot attached</span></div>
      <div class="chat-log" id="chat-log" aria-live="polite"><p class="chat-intro">Ask a follow-up about the confirmed snapshot. Gemma will answer using the image as context.</p></div>
      <form class="chat-form" id="chat-form"><label class="visually-hidden" for="chat-question">Ask Gemma about the snapshot</label><input id="chat-question" name="question" maxlength="1000" placeholder="Ask about visible details..." autocomplete="off" required><button class="button button-dark" type="submit" aria-label="Send question">Send <span aria-hidden="true">&#8594;</span></button></form>
      <p class="chat-footnote">Answers are limited to details visible in the snapshot.</p>
    </section>` : "";
  panel.innerHTML = `
    <div class="result-heading"><div><p class="eyebrow">ANALYSIS COMPLETE</p><h2>${confirmed ? "Incident confirmed" : "No incident confirmed"}</h2></div><span class="result-status ${confirmed ? "result-positive" : "result-neutral"}">${escapeHtml(String(result.classification).replaceAll("_", " "))}</span></div>
    <div class="result-metrics"><div><span>CONFIRMED FRAMES</span><strong>${escapeHtml(result.confirmed_votes)}</strong></div><div><span>GEMMA CHECKS</span><strong>${escapeHtml(result.vlm_calls)}</strong></div><div><span>REPEAT FRAMES SKIPPED</span><strong>${escapeHtml(result.vlm_skipped_during_cooldown)}</strong></div></div>
    ${evidence ? `<div class="result-evidence"><h3>Visible evidence</h3><ul>${evidence}</ul></div>` : ""}
    ${snapshots ? `<div class="result-snapshots"><h3>Confirmed snapshots</h3><div class="snapshot-grid">${snapshots}</div></div>` : ""}
    <div class="result-actions">${report}<a class="text-link" href="/reports">Open report archive <span aria-hidden="true">&#8594;</span></a></div>${chat}`;
  panel.hidden = false;
  if (chat) initVlmChat();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initVlmChat() {
  const form = document.querySelector("#chat-form");
  const input = document.querySelector("#chat-question");
  const log = document.querySelector("#chat-log");
  const button = form.querySelector("button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    log.insertAdjacentHTML("beforeend", `<div class="chat-message chat-user"><span>You</span><p>${escapeHtml(question)}</p></div><div class="chat-message chat-assistant chat-pending"><span>Gemma</span><p>Thinking...</p></div>`);
    const pending = log.lastElementChild;
    log.scrollTop = log.scrollHeight;
    input.value = "";
    input.disabled = true;
    button.disabled = true;
    try {
      const formData = new FormData();
      formData.append("question", question);
      const response = await fetch("/chat-with-vlm", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Gemma could not answer this question.");
      pending.classList.remove("chat-pending");
      pending.querySelector("p").textContent = payload.answer;
    } catch (error) {
      pending.classList.remove("chat-pending");
      pending.classList.add("chat-error");
      pending.querySelector("p").textContent = error.message;
    } finally {
      input.disabled = false;
      button.disabled = false;
      input.focus();
      log.scrollTop = log.scrollHeight;
    }
  });
}

function initAnalysis() {
  const form = document.querySelector("#analysis-form");
  const input = document.querySelector("#video-file");
  const zone = document.querySelector("#upload-zone");
  const fileName = document.querySelector("#file-name");
  const button = document.querySelector("#submit-analysis");
  const status = document.querySelector("#analysis-status");
  const result = document.querySelector("#analysis-result");

  input.addEventListener("change", () => {
    fileName.textContent = input.files[0]?.name || "Choose a video to analyze";
    zone.classList.toggle("has-file", Boolean(input.files.length));
  });
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
  }));
  zone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (!file || !file.type.startsWith("video/")) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.files.length) return;
    const formData = new FormData();
    formData.append("video", input.files[0]);
    formData.append("use_vlm_state_machine", document.querySelector("#state-machine").checked);
    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Analyzing footage...';
    status.hidden = false;
    status.innerHTML = '<span class="status-pulse"></span><div><strong>Analysis in progress</strong><p>Frames are being screened and candidate incidents verified. Keep this page open.</p></div>';
    result.hidden = true;
    try {
      const response = await fetch("/analyze-video", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Analysis could not be completed.");
      showAnalysisResult(payload);
      status.hidden = true;
    } catch (error) {
      status.classList.add("status-error");
      status.innerHTML = `<div><strong>Analysis could not be completed</strong><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      button.disabled = false;
      button.innerHTML = 'Analyze video <span aria-hidden="true">&#8594;</span>';
    }
  });
}

document.querySelectorAll("[data-nav]").forEach((link) => {
  if (link.dataset.nav === document.body.dataset.page) link.classList.add("is-active");
});

if (document.body.dataset.page === "home") loadHome();
if (document.body.dataset.page === "reports") {
  loadReports();
  document.querySelector("#refresh-reports").addEventListener("click", loadReports);
}
if (document.body.dataset.page === "analyze") initAnalysis();
