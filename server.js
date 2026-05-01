import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { departments, agents, departmentConfig, getDepartment } from "./departments.js";
import { chat, executeTask, reviewDiff, checkOllamaHealth } from "./ollama.js";
import gitEngine from "./git-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const tasksFile = path.join(dataDir, "tasks.json");
const reportsFile = path.join(dataDir, "reports.json");
const chatFile = path.join(dataDir, "chat.json");
const gitOpsFile = path.join(dataDir, "git-ops.json");
const activityFile = path.join(dataDir, "activity.json");
const port = Number(process.env.PORT || 4317);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

// ─── Data helpers ───

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function addActivity(event, detail = {}) {
  const events = await readJson(activityFile, []);
  events.unshift({ id: crypto.randomUUID(), event, ...detail, createdAt: new Date().toISOString() });
  await writeJson(activityFile, events.slice(0, 200));
}

// ─── Task engine ───

async function loadTasks() { return readJson(tasksFile, []); }
async function saveTasks(tasks) { return writeJson(tasksFile, tasks); }

async function updateTask(id, patch) {
  const tasks = await loadTasks();
  const now = new Date().toISOString();
  let updated = null;
  const next = tasks.map((t) => {
    if (t.id !== id) return t;
    updated = { ...t, ...patch, updatedAt: now, history: [...(t.history || []), { at: now, event: `status_${patch.status || t.status}` }] };
    return updated;
  });
  await saveTasks(next);
  return updated;
}

// ─── Morning analysis (codebase scan) ───

const rootDir = path.resolve(__dirname, "..");

async function readMaybe(relativeFile) {
  try { return await fs.readFile(path.join(rootDir, relativeFile), "utf8"); } catch { return ""; }
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

const scanRules = [
  { id: "prod-secrets-in-config", department: "operations", priority: "critical", title: "Move production secrets out of wrangler config", risk: "Credentials in config can leak.", action: "Move secrets to Cloudflare Secrets.", files: ["backend/wrangler.jsonc"], tests: [/DATABASE_URL"\s*:\s*"postgres:\/\//, /JWT_SECRET"\s*:\s*"[a-f0-9]{32,}/] },
  { id: "public-r2-uploads", department: "developer", priority: "critical", title: "Lock private uploads behind authorized route", risk: "Known R2 keys served publicly.", action: "Split public/private files, require auth for private reads.", files: ["backend/src/routes/upload/route.ts"], tests: [/app\.get\('\/:key'/] },
  { id: "password-reset-email", department: "developer", priority: "high", title: "Finish password reset email delivery", risk: "Forgot-password does not deliver links.", action: "Add transactional email provider.", files: ["backend/src/routes/auth/service.ts"], tests: [/until email service is implemented/] },
  { id: "frontend-lint", department: "testing", priority: "high", title: "Make frontend lint pass", risk: "Build skips lint; regressions hide.", action: "Fix lint errors.", files: ["art-book/src"], tests: [/Unexpected any|no-unused-vars/], manualEvidence: "pnpm run lint fails." },
  { id: "seo-worker-domain", department: "marketing", priority: "medium", title: "Move SEO metadata to real domain", risk: "OG/canonical use workers.dev domain.", action: "Set production domain.", files: ["art-book/src/app/layout.tsx"], tests: [/artbook-frontend-production/] },
  { id: "artist-supply-plan", department: "hr", priority: "medium", title: "Create artist supply launch plan", risk: "No supply operations plan.", action: "Recruit beta artists.", files: [], manualEvidence: "No visible supply plan." },
  { id: "ui-accessibility", department: "ui-ux", priority: "medium", title: "Run accessibility audit on key pages", risk: "No WCAG compliance verified.", action: "Audit and fix contrast, keyboard nav, ARIA labels.", files: ["art-book/src/app"], tests: [/aria-label|role=/i], manualEvidence: "No accessibility audit done." }
];

async function scanRule(rule) {
  const evidence = [];
  for (const file of rule.files || []) {
    const content = await readMaybe(file);
    if (!content) continue;
    for (const test of rule.tests || []) {
      const match = content.match(test);
      if (match) evidence.push({ file, match: match[0].slice(0, 160).replace(/\s+/g, " "), confidence: 0.9 });
    }
  }
  if (rule.manualEvidence) evidence.push({ file: "review-notes", match: rule.manualEvidence, confidence: 0.75 });
  if (!evidence.length) return null;
  return { ruleId: rule.id, title: rule.title, department: rule.department, priority: rule.priority, risk: rule.risk, action: rule.action, evidence, evidenceHash: hashText(JSON.stringify(evidence)) };
}

async function runMorningAnalysis() {
  const findings = (await Promise.all(scanRules.map(scanRule))).filter(Boolean);
  const existingTasks = await loadTasks();
  const now = new Date().toISOString();
  const newTasks = [];
  for (const f of findings) {
    const id = `${f.ruleId}-${f.evidenceHash}`;
    if (existingTasks.some((t) => t.id === id)) continue;
    const dept = getDepartment(f.department);
    newTasks.push({
      id, title: f.title, department: f.department, priority: f.priority, status: "proposed",
      ownerAgent: dept?.agentId || "ceo-agent", evidence: f.evidence, risk: f.risk,
      proposedAction: f.action, approvalRequired: true, description: "", plan: null,
      createdAt: now, updatedAt: now, history: [{ at: now, event: "proposed_by_ceo_agent" }]
    });
  }
  const tasks = [...newTasks, ...existingTasks];
  await saveTasks(tasks);
  await addActivity("morning_analysis", { newTaskCount: newTasks.length, findingCount: findings.length });

  const critical = findings.filter((f) => f.priority === "critical").length;
  const high = findings.filter((f) => f.priority === "high").length;
  const report = {
    id: `report-${Date.now()}`, createdAt: now, findings, newTaskCount: newTasks.length,
    brief: {
      title: "Morning Analysis",
      summary: `${critical} critical, ${high} high-priority blockers found. Approve security tasks first.`,
      topRisks: findings.slice(0, 5).map((f) => f.title),
      byDepartment: departments.map((d) => ({ ...d, count: findings.filter((f) => f.department === d.id).length }))
    }
  };
  const reports = await readJson(reportsFile, []);
  await writeJson(reportsFile, [report, ...reports].slice(0, 30));
  return { report, tasks };
}

// ─── CEO Chat ───

async function loadChat() { return readJson(chatFile, []); }
async function saveChat(messages) { return writeJson(chatFile, messages); }

async function sendCeoMessage(userMessage) {
  const chatHistory = await loadChat();
  const now = new Date().toISOString();
  const userMsg = { id: crypto.randomUUID(), role: "user", content: userMessage, createdAt: now };
  chatHistory.push(userMsg);

  // Build context for CEO
  const tasks = await loadTasks();
  const activeTasks = tasks.filter((t) => t.status !== "done" && t.status !== "rejected");
  const contextBlock = `\n\nCurrent company state:\n- ${activeTasks.length} active tasks\n- Departments: ${departments.map((d) => d.name).join(", ")}\n- Active tasks: ${activeTasks.slice(0, 5).map((t) => `${t.title} (${t.status})`).join("; ")}`;

  const ceoDept = departmentConfig.ceo;
  const recentMessages = chatHistory.slice(-20).map((m) => ({ role: m.role === "ceo" ? "assistant" : m.role, content: m.content }));

  const response = await chat({
    systemPrompt: ceoDept.systemPrompt + contextBlock,
    messages: recentMessages,
    temperature: 0.7
  });

  const ceoMsg = { id: crypto.randomUUID(), role: "ceo", content: response.content, createdAt: new Date().toISOString(), model: response.model };
  chatHistory.push(ceoMsg);
  await saveChat(chatHistory.slice(-100));
  await addActivity("ceo_chat", { summary: userMessage.slice(0, 80) });
  return { userMsg, ceoMsg, history: chatHistory.slice(-50) };
}

// ─── CEO Delegate (create tasks from chat) ───

async function ceoDelegateTasks(description) {
  const ceoDept = departmentConfig.ceo;
  const response = await chat({
    systemPrompt: ceoDept.systemPrompt + `\n\nAvailable departments: ${departments.filter((d) => d.id !== "ceo").map((d) => `${d.id} (${d.name})`).join(", ")}`,
    messages: [{ role: "user", content: `Break this request into department tasks. Return JSON array: [{ title, department, priority, proposedAction, risk }]\n\nRequest: ${description}` }],
    temperature: 0.3,
    json: true
  });

  let taskPlan;
  try { taskPlan = JSON.parse(response.content); } catch { taskPlan = []; }
  if (!Array.isArray(taskPlan)) taskPlan = taskPlan.tasks || [];

  const existingTasks = await loadTasks();
  const now = new Date().toISOString();
  const newTasks = taskPlan.map((t, i) => {
    const dept = getDepartment(t.department);
    return {
      id: `ceo-${Date.now()}-${i}`, title: t.title || "Untitled task",
      department: t.department || "developer", priority: t.priority || "medium",
      status: "proposed", ownerAgent: dept?.agentId || "dev-agent",
      evidence: [], risk: t.risk || "No risk specified",
      proposedAction: t.proposedAction || t.action || "", approvalRequired: true,
      description: description, plan: null,
      createdAt: now, updatedAt: now, history: [{ at: now, event: "proposed_by_ceo_agent" }]
    };
  });

  await saveTasks([...newTasks, ...existingTasks]);
  await addActivity("ceo_delegated", { taskCount: newTasks.length, description: description.slice(0, 80) });
  return { tasks: newTasks, rawPlan: response.content };
}

// ─── Task execution (department auto-work) ───

async function autoExecuteTask(taskId) {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const dept = getDepartment(task.department);
  if (!dept) return null;

  await updateTask(taskId, { status: "in_progress" });
  await addActivity("department_started", { taskId, department: task.department, title: task.title });

  const result = await executeTask({
    systemPrompt: dept.systemPrompt,
    taskTitle: task.title,
    proposedAction: task.proposedAction,
    risk: task.risk,
    context: { department: dept.name, evidence: task.evidence }
  });

  await updateTask(taskId, { status: "done", plan: result });
  await addActivity("department_completed", { taskId, department: task.department, title: task.title, summary: result.summary });
  return result;
}

// ─── Accept all proposed ───

async function acceptAllProposed() {
  const tasks = await loadTasks();
  const proposed = tasks.filter((t) => t.status === "proposed");
  const results = [];
  for (const task of proposed) {
    await updateTask(task.id, { status: "approved" });
    await addActivity("task_approved", { taskId: task.id, title: task.title });
    // Auto-execute after approval
    const result = await autoExecuteTask(task.id);
    results.push({ taskId: task.id, result });
  }
  return results;
}

// ─── Git operations ───

async function loadGitOps() { return readJson(gitOpsFile, []); }
async function saveGitOps(ops) { return writeJson(gitOpsFile, ops); }

// ─── HTTP helpers ───

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const cleanPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) { res.writeHead(403); res.end("Forbidden"); return; }
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}

// ─── Router ───

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;

    // Bootstrap
    if (p === "/api/bootstrap" && req.method === "GET") {
      const tasks = await loadTasks();
      const reports = await readJson(reportsFile, []);
      const gitOps = await loadGitOps();
      const health = await checkOllamaHealth();
      return sendJson(res, 200, { departments, agents, tasks, reports, gitOps, ollamaHealth: health });
    }

    // Morning analysis
    if (p === "/api/morning-analysis" && req.method === "POST") {
      return sendJson(res, 200, await runMorningAnalysis());
    }

    // Task CRUD
    const taskMatch = p.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === "PATCH") {
      const body = await parseBody(req);
      const task = await updateTask(taskMatch[1], body);
      if (!task) return sendJson(res, 404, { error: "Task not found" });
      await addActivity(`task_${body.status}`, { taskId: task.id, title: task.title });
      // Auto-execute on approval
      if (body.status === "approved") {
        autoExecuteTask(task.id).catch((e) => console.error("Auto-execute error:", e));
      }
      return sendJson(res, 200, { task });
    }

    // Accept all
    if (p === "/api/tasks/accept-all" && req.method === "POST") {
      const results = await acceptAllProposed();
      const tasks = await loadTasks();
      return sendJson(res, 200, { accepted: results.length, tasks });
    }

    // CEO Chat
    if (p === "/api/chat/history" && req.method === "GET") {
      return sendJson(res, 200, { messages: await loadChat() });
    }
    if (p === "/api/chat/send" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.message) return sendJson(res, 400, { error: "message required" });
      const result = await sendCeoMessage(body.message);
      return sendJson(res, 200, result);
    }

    // CEO Delegate
    if (p === "/api/chat/delegate" && req.method === "POST") {
      const body = await parseBody(req);
      if (!body.description) return sendJson(res, 400, { error: "description required" });
      const result = await ceoDelegateTasks(body.description);
      return sendJson(res, 200, result);
    }

    // Activity
    if (p === "/api/activity" && req.method === "GET") {
      return sendJson(res, 200, { events: await readJson(activityFile, []) });
    }

    // Git operations
    if (p === "/api/git/status" && req.method === "GET") {
      try { return sendJson(res, 200, { branch: gitEngine.getCurrentBranch(), status: gitEngine.getStatus(), log: gitEngine.getLog() }); }
      catch (e) { return sendJson(res, 200, { error: e.message }); }
    }
    if (p === "/api/git/operations" && req.method === "GET") {
      return sendJson(res, 200, { operations: await loadGitOps() });
    }

    // Ollama health
    if (p === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, await checkOllamaHealth());
    }

    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  CompanyOS — Virtual Company Dashboard   ║`);
  console.log(`  ║  http://127.0.0.1:${port}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
