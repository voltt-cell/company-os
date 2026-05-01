// ─── State ───
const state = { departments: [], agents: [], tasks: [], reports: [], events: [], gitOps: [], chatMessages: [], ollamaHealth: null };
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const statusLabels = { proposed: "Proposed", approved: "Approved", in_progress: "In Progress", done: "Done", blocked: "Blocked", rejected: "Rejected" };

const deptColors = {
  ceo: "#a78bfa", hr: "#f472b6", developer: "#38bdf8", operations: "#fbbf24",
  testing: "#34d399", "ui-ux": "#e879f9", marketing: "#fb923c", "artist-success": "#fb923c"
};
const deptIcons = {
  ceo: "👔", hr: "📋", developer: "💻", operations: "⚙️",
  testing: "🧪", "ui-ux": "🎨", marketing: "📢", "artist-success": "🎨"
};

// ─── API ───
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res.json();
}

// ─── Bootstrap ───
function applyBootstrap(data) {
  const src = data.bootstrap || data;
  state.departments = src.departments || data.departments || [];
  state.agents = src.agents || data.agents || [];
  state.tasks = src.tasks || data.tasks || [];
  state.reports = normalizeReports(src.reports || data.reports || []);
  state.gitOps = src.gitOps || data.gitOps || [];
  state.ollamaHealth = src.ollamaHealth || data.ollamaHealth || null;
  if (data.report && !state.reports.find((r) => r.id === data.report.id)) {
    state.reports = normalizeReports([data.report, ...state.reports]);
  }
}

function normalizeReports(reports = []) {
  return reports.map((r) => {
    if (r.brief) return r;
    const p = r.payload || {};
    return {
      id: r.id, createdAt: r.createdAt || r.created_at,
      brief: { title: p.title || "Morning Analysis", summary: p.summary || "No summary.", topRisks: (p.findings || []).slice(0, 5).map((f) => f.title), byDepartment: [] },
      findings: p.findings || []
    };
  });
}

// ─── View Routing ───
function switchView(viewId) {
  $$(".section").forEach((s) => s.classList.remove("active"));
  $$(".sidebar nav a").forEach((a) => a.classList.remove("active"));
  const el = $(`#view-${viewId}`);
  if (el) el.classList.add("active");
  const link = $(`.sidebar nav a[data-view="${viewId}"]`);
  if (link) link.classList.add("active");
  // Close mobile sidebar
  $("#sidebar").classList.remove("open");
}

// ─── Render: Metrics ───
function renderMetrics() {
  $("#metric-proposed").textContent = state.tasks.filter((t) => t.status === "proposed").length;
  $("#metric-approved").textContent = state.tasks.filter((t) => t.status === "approved").length;
  $("#metric-active").textContent = state.tasks.filter((t) => t.status === "in_progress").length;
  $("#metric-done").textContent = state.tasks.filter((t) => t.status === "done").length;
}

// ─── Render: Brief ───
function renderBrief() {
  const r = state.reports[0];
  if (!r) return;
  $("#last-run").textContent = new Date(r.createdAt).toLocaleString();
  $("#brief-title").textContent = r.brief.title;
  $("#brief-summary").textContent = r.brief.summary;
  $("#top-risks").innerHTML = r.brief.topRisks.map((risk, i) =>
    `<div class="risk-item"><strong>${i + 1}.</strong> ${risk}</div>`
  ).join("");
}

// ─── Render: Task Card ───
function actionBtn(task, status, label, cls = "btn-ghost btn-sm") {
  return `<button class="btn ${cls}" data-action="${status}" data-id="${task.id}">${label}</button>`;
}

function renderTask(task) {
  const actions = [];
  if (task.status === "proposed") {
    actions.push(actionBtn(task, "approved", "✓ Approve", "btn-primary btn-sm"));
    actions.push(actionBtn(task, "rejected", "✕ Reject", "btn-danger btn-sm"));
  }
  if (task.status === "approved") {
    actions.push(actionBtn(task, "in_progress", "▶ Start", "btn-primary btn-sm"));
    actions.push(actionBtn(task, "blocked", "⏸ Block", "btn-ghost btn-sm"));
  }
  if (task.status === "in_progress" || task.status === "blocked") {
    actions.push(actionBtn(task, "done", "✓ Done", "btn-primary btn-sm"));
    if (task.status === "blocked") actions.push(actionBtn(task, "in_progress", "▶ Resume", "btn-ghost btn-sm"));
  }

  const deptName = state.departments.find((d) => d.id === task.department)?.name || task.department;
  return `
    <article class="task-card">
      <div class="task-title">
        <h4>${task.title}</h4>
        <span class="pill ${task.priority}">${task.priority}</span>
      </div>
      <div class="task-meta">
        <span class="pill" style="border-color:${deptColors[task.department] || '#555'}40;color:${deptColors[task.department] || '#999'}">${deptName}</span>
        <span class="pill">${statusLabels[task.status] || task.status}</span>
      </div>
      <p><strong>Risk:</strong> ${task.risk || "—"}</p>
      <p><strong>Action:</strong> ${task.proposedAction || "—"}</p>
      ${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
    </article>`;
}

// ─── Render: Approvals ───
function renderApprovals() {
  const proposed = state.tasks.filter((t) => t.status === "proposed");
  const countText = `${proposed.length} waiting`;
  $("#approval-count").textContent = countText;
  $("#approval-count-2").textContent = countText;
  const html = proposed.length ? proposed.map(renderTask).join("") : '<div class="empty">No proposed tasks. Run Morning Analysis or chat with CEO to create tasks.</div>';
  $("#quick-approval-list").innerHTML = proposed.slice(0, 3).length ? proposed.slice(0, 3).map(renderTask).join("") : '<div class="empty">All clear!</div>';
  $("#approval-list").innerHTML = html;
}

// ─── Render: Departments ───
function renderDepartments() {
  $("#department-grid").innerHTML = state.departments
    .filter((d) => d.id !== "ceo")
    .map((d) => {
      const tasks = state.tasks.filter((t) => t.department === d.id && t.status !== "proposed" && t.status !== "rejected");
      const color = deptColors[d.id] || "#999";
      const icon = deptIcons[d.id] || "📁";
      return `
        <div class="dept-card" style="--dept-color:${color}">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${color}"></div>
          <div class="dept-header">
            <div class="dept-icon" style="background:${color}20">${icon}</div>
            <div class="dept-name" style="color:${color}">${d.name}</div>
          </div>
          <div class="dept-purpose">${d.purpose}</div>
          <div class="dept-tasks">
            ${tasks.length ? tasks.map(renderTask).join("") : '<div class="empty">No active tasks</div>'}
          </div>
        </div>`;
    }).join("");
}

// ─── Render: Org Chart ───
function renderOrgChart() {
  const depts = state.departments.filter((d) => d.id !== "ceo");
  $("#org-chart").innerHTML = `
    <div class="org-ceo">👔 CEO Agent<br><span style="font-size:12px;opacity:.8">Strategic Planning & Oversight</span></div>
    <div class="org-line"></div>
    <div class="org-depts">
      ${depts.map((d) => {
        const color = deptColors[d.id] || "#999";
        const icon = deptIcons[d.id] || "📁";
        const count = state.tasks.filter((t) => t.department === d.id && t.status !== "rejected").length;
        return `<div class="org-dept"><span class="dept-dot" style="background:${color}"></span>${icon} ${d.name}<span class="pill" style="margin-left:4px">${count}</span></div>`;
      }).join("")}
    </div>`;
}

// ─── Render: Activity ───
function renderActivity() {
  const events = state.events || [];
  const el = $("#activity-list");
  if (!events.length) { el.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
  el.innerHTML = events.slice(0, 50).map((e) => `
    <div class="activity-item">
      <span class="event-type">${e.event.replace(/_/g, " ")}</span>
      <span class="event-detail">${e.title || e.summary || e.taskTitle || e.department || ""}</span>
      <span class="event-time">${e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : ""}</span>
    </div>`).join("");
}

// ─── Render: Evidence ───
function renderEvidence() {
  const r = state.reports[0];
  const findings = r?.findings || r?.brief?.topRisks?.map((t) => ({ title: t })) || [];
  const el = $("#evidence-list");
  if (!findings.length) { el.innerHTML = '<div class="empty">No evidence yet. Run Morning Analysis.</div>'; return; }
  el.innerHTML = findings.map((f) => `
    <article class="evidence-card">
      <strong>${f.title || f}</strong>
      ${f.risk ? `<p>${f.risk}</p>` : ""}
      ${(f.evidence || []).map((e) => `<code>${e.file || e.source}: ${e.match || e.detail}</code>`).join("")}
    </article>`).join("");
}

// ─── Render: Git ───
function renderGit() {
  const ops = state.gitOps || [];
  if (!ops.length) {
    $("#git-ops-list").innerHTML = '<div class="empty">No git operations yet. Approve tasks to trigger department work.</div>';
  } else {
    $("#git-ops-list").innerHTML = ops.map((op) => `
      <div class="task-card">
        <div class="task-title"><h4>${op.message || op.operation}</h4><span class="pill">${op.status}</span></div>
        <div class="task-meta"><span class="pill">${op.branch}</span><span class="pill">${op.operation}</span></div>
      </div>`).join("");
  }
  // Fetch live git status
  api("/api/git/status").then((data) => {
    if (data.error) { $("#git-status").innerHTML = `<div class="empty">Git: ${data.error}</div>`; return; }
    $("#git-status").innerHTML = `
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;padding:12px;background:var(--bg-glass);border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div><strong style="color:var(--cyan)">Branch:</strong> ${data.branch || "unknown"}</div>
        <div style="margin-top:6px"><strong style="color:var(--amber)">Status:</strong><pre style="margin:4px 0;white-space:pre-wrap;color:var(--text-muted)">${data.status || "clean"}</pre></div>
        <div style="margin-top:6px"><strong style="color:var(--green)">Recent:</strong><pre style="margin:4px 0;white-space:pre-wrap;color:var(--text-muted)">${data.log || "no commits"}</pre></div>
      </div>`;
  }).catch(() => {});
}

// ─── Render: Ollama status ───
function renderOllamaStatus() {
  const h = state.ollamaHealth;
  const dot = $("#ollama-dot");
  const label = $("#ollama-status");
  if (!h || !h.healthy) {
    dot.classList.add("offline");
    label.textContent = "AI Offline";
  } else {
    dot.classList.remove("offline");
    label.textContent = h.hasModel ? "AI Online" : "Model missing";
  }
}

// ─── Render All ───
function render() {
  renderMetrics();
  renderBrief();
  renderApprovals();
  renderDepartments();
  renderOrgChart();
  renderActivity();
  renderEvidence();
  renderGit();
  renderOllamaStatus();
  // Update date
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  $(".header-left h2").textContent = `${greeting}, Founder 👋`;
  $("#header-date").textContent = `Command Center · ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
}

// ─── Chat ───
function openChat() { $("#chat-panel").classList.add("open"); $("#chat-overlay").classList.add("visible"); $("#chat-input").focus(); }
function closeChat() { $("#chat-panel").classList.remove("open"); $("#chat-overlay").classList.remove("visible"); }

function addChatMsg(role, content) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.innerHTML = `<span class="msg-label">${role === "user" ? "You" : "CEO"}</span>${escapeHtml(content)}`;
  $("#chat-messages").appendChild(el);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

async function sendChat() {
  const input = $("#chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  addChatMsg("user", msg);
  $("#chat-typing").classList.add("visible");
  $("#chat-send").disabled = true;

  try {
    const res = await api("/api/chat/send", { method: "POST", body: { message: msg } });
    $("#chat-typing").classList.remove("visible");
    addChatMsg("ceo", res.ceoMsg.content);

    // Check if CEO suggests delegation
    if (res.ceoMsg.content.toLowerCase().includes("task") || res.ceoMsg.content.toLowerCase().includes("assign")) {
      // Refresh tasks in case CEO created any
      await refreshAll();
    }
  } catch (e) {
    $("#chat-typing").classList.remove("visible");
    addChatMsg("ceo", `Error: ${e.message}. Is Ollama running?`);
  }
  $("#chat-send").disabled = false;
}

async function loadChatHistory() {
  try {
    const data = await api("/api/chat/history");
    const msgs = data.messages || [];
    if (msgs.length === 0) return;
    // Clear default welcome message
    $("#chat-messages").innerHTML = "";
    msgs.forEach((m) => addChatMsg(m.role === "ceo" ? "ceo" : "user", m.content));
  } catch { /* ignore */ }
}

// ─── Actions ───
async function bootstrap() {
  try {
    const data = await api("/api/bootstrap");
    applyBootstrap(data);
    render();
    loadChatHistory();
    loadActivity();
  } catch (e) {
    console.error("Bootstrap failed:", e);
  }
}

async function loadActivity() {
  try { const data = await api("/api/activity"); state.events = data.events || []; renderActivity(); } catch { /* ignore */ }
}

async function refreshAll() {
  const data = await api("/api/bootstrap");
  applyBootstrap(data);
  await loadActivity();
  render();
}

async function runAnalysis() {
  const btn = $("#run-analysis");
  btn.disabled = true;
  btn.textContent = "⏳ Scanning...";
  try {
    const result = await api("/api/morning-analysis", { method: "POST" });
    applyBootstrap(result);
    await loadActivity();
    render();
  } catch (e) { alert(e.message); }
  btn.disabled = false;
  btn.textContent = "▶ Run Morning Analysis";
}

async function acceptAll() {
  const btns = [$("#accept-all"), $("#accept-all-2")];
  btns.forEach((b) => { if (b) { b.disabled = true; b.textContent = "⏳ Accepting..."; } });
  try {
    const result = await api("/api/tasks/accept-all", { method: "POST" });
    if (result.tasks) state.tasks = result.tasks;
    await refreshAll();
  } catch (e) { alert(e.message); }
  btns.forEach((b) => { if (b) { b.disabled = false; b.textContent = "✓ Accept All"; } });
}

async function updateStatus(id, status) {
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
    state.tasks = state.tasks.map((t) => t.id === id ? result.task : t);
    await loadActivity();
    render();
    if (status === "approved") { setTimeout(refreshAll, 2000); setTimeout(refreshAll, 5000); }
  } catch (e) { alert(e.message); }
}

// ─── Event Listeners ───
document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]");
  if (action) updateStatus(action.dataset.id, action.dataset.action);
});

// Nav
$$(".sidebar nav a[data-view]").forEach((a) => {
  a.addEventListener("click", (e) => { e.preventDefault(); switchView(a.dataset.view); });
});

// Buttons
$("#run-analysis").addEventListener("click", runAnalysis);
$("#accept-all").addEventListener("click", acceptAll);
$("#accept-all-2")?.addEventListener("click", acceptAll);
$("#refresh-btn").addEventListener("click", refreshAll);
$("#refresh-activity").addEventListener("click", loadActivity);
$("#refresh-git")?.addEventListener("click", () => { renderGit(); });

// Chat
$("#chat-toggle").addEventListener("click", openChat);
$("#chat-close").addEventListener("click", closeChat);
$("#chat-overlay").addEventListener("click", closeChat);
$("#chat-send").addEventListener("click", sendChat);
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// Auto-resize chat input
$("#chat-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

// Mobile menu
$("#mobile-menu").addEventListener("click", () => { $("#sidebar").classList.toggle("open"); });

// ─── Init ───
bootstrap();
