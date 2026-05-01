import { Hono } from "hono";
import { cors } from "hono/cors";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

type Priority = "critical" | "high" | "medium" | "low";
type TaskStatus = "proposed" | "approved" | "in_progress" | "done" | "blocked" | "rejected";

type Env = {
  Bindings: {
    DB: D1Database;
    AI: Ai;
    TASK_QUEUE: Queue<TaskQueueMessage>;
    COMMAND_WORKFLOW: Workflow<WorkflowPayload>;
    ARTBOOK_REPO: string;
    APP_ENV: string;
  };
};

type Evidence = {
  source: string;
  detail: string;
  confidence: number;
};

type FindingSeed = {
  id: string;
  title: string;
  departmentId: string;
  ownerAgentId: string;
  priority: Priority;
  risk: string;
  proposedAction: string;
  evidence: Evidence[];
};

type TaskQueueMessage = {
  taskId: string;
  action: "execute_task" | "prepare_plan";
  approvedBy: string;
};

type WorkflowPayload = {
  taskId?: string;
  reportId?: string;
  trigger: "approval" | "cron" | "manual";
};

const app = new Hono<Env>();
const planningModel = "@cf/meta/llama-3.1-8b-instruct" as keyof AiModels;
const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

app.use("/api/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type"]
}));

const launchFindings: FindingSeed[] = [
  {
    id: "prod-secrets-in-config",
    title: "Move production secrets out of wrangler config",
    departmentId: "operations",
    ownerAgentId: "ops-agent",
    priority: "critical",
    risk: "Credentials in config can leak. Production still references test Stripe and empty webhook secret.",
    proposedAction: "Rotate exposed values, move secrets to Cloudflare Secrets, configure live Stripe webhook secret.",
    evidence: [{ source: "last_repo_scan", detail: "backend/wrangler.jsonc has DATABASE_URL, JWT_SECRET, sk_test key, empty webhook secret.", confidence: 0.95 }]
  },
  {
    id: "public-r2-uploads",
    title: "Lock private uploads behind authorized download route",
    departmentId: "developer",
    ownerAgentId: "dev-agent",
    priority: "critical",
    risk: "Known R2 keys can be served publicly through upload route.",
    proposedAction: "Split public artwork assets from private digital files; require token/order auth for private file reads.",
    evidence: [{ source: "last_repo_scan", detail: "backend/src/routes/upload/route.ts exposes GET /:key.", confidence: 0.92 }]
  },
  {
    id: "password-reset-email",
    title: "Finish password reset email delivery",
    departmentId: "developer",
    ownerAgentId: "dev-agent",
    priority: "high",
    risk: "Forgot-password production path does not deliver reset links.",
    proposedAction: "Add transactional email provider and delivery logging.",
    evidence: [{ source: "last_repo_scan", detail: "auth service still notes token return until email service exists.", confidence: 0.88 }]
  },
  {
    id: "frontend-quality-gate",
    title: "Make frontend lint pass",
    departmentId: "developer",
    ownerAgentId: "dev-agent",
    priority: "high",
    risk: "Build skips lint; unsafe any types and unused code can hide regressions.",
    proposedAction: "Fix lint errors, then make lint mandatory before deploy.",
    evidence: [{ source: "last_verification", detail: "pnpm run lint failed with no-explicit-any, unused imports, hook warnings.", confidence: 0.86 }]
  },
  {
    id: "artist-supply-plan",
    title: "Create artist supply launch plan",
    departmentId: "artist-success",
    ownerAgentId: "artist-agent",
    priority: "medium",
    risk: "Marketplace without strong seller supply looks empty and loses buyer trust.",
    proposedAction: "Recruit 10 beta artists, verify Stripe onboarding, publish 50 quality listings.",
    evidence: [{ source: "product_review", detail: "Artist application exists; launch supply plan missing.", confidence: 0.78 }]
  }
];

async function seedCore(db: D1Database) {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO departments (id, name, purpose) VALUES (?, ?, ?)").bind("ceo", "CEO", "Prioritize, assign, request approval"),
    db.prepare("INSERT OR IGNORE INTO departments (id, name, purpose) VALUES (?, ?, ?)").bind("developer", "Developer", "Code, tests, deploy readiness"),
    db.prepare("INSERT OR IGNORE INTO departments (id, name, purpose) VALUES (?, ?, ?)").bind("operations", "Operations", "Orders, payments, incidents"),
    db.prepare("INSERT OR IGNORE INTO departments (id, name, purpose) VALUES (?, ?, ?)").bind("marketing", "Marketing", "SEO, content, campaigns"),
    db.prepare("INSERT OR IGNORE INTO departments (id, name, purpose) VALUES (?, ?, ?)").bind("artist-success", "Artist Success", "Seller onboarding and supply"),
    db.prepare("INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES (?, ?, ?, ?)").bind("ceo-agent", "CEO Agent", "ceo", "@cf/meta/llama-3.1-8b-instruct"),
    db.prepare("INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES (?, ?, ?, ?)").bind("dev-agent", "Developer Agent", "developer", "@cf/meta/llama-3.1-8b-instruct"),
    db.prepare("INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES (?, ?, ?, ?)").bind("ops-agent", "Operations Agent", "operations", "@cf/meta/llama-3.1-8b-instruct"),
    db.prepare("INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES (?, ?, ?, ?)").bind("growth-agent", "Marketing Agent", "marketing", "@cf/meta/llama-3.1-8b-instruct"),
    db.prepare("INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES (?, ?, ?, ?)").bind("artist-agent", "Artist Success Agent", "artist-success", "@cf/meta/llama-3.1-8b-instruct")
  ]);
}

async function createTaskEvent(db: D1Database, taskId: string, event: string, payload: unknown) {
  await db.prepare(
    "INSERT INTO task_events (id, task_id, event, payload_json) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), taskId, event, JSON.stringify(payload)).run();
}

function getIstDateKey(date = new Date()) {
  return istDateFormatter.format(date);
}

function buildCeoTaskList() {
  const priorityRank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...launchFindings]
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .map((finding) => ({
      id: finding.id,
      title: finding.title,
      priority: finding.priority,
      department: finding.departmentId,
      ownerAgent: finding.ownerAgentId,
      action: finding.proposedAction,
      risk: finding.risk,
      tags: [finding.priority, finding.departmentId]
    }));
}

async function runMorningAnalysis(env: Env["Bindings"], trigger: WorkflowPayload["trigger"]) {
  await seedCore(env.DB);
  const dateKey = getIstDateKey();
  const reportId = `morning-${dateKey}`;
  const critical = launchFindings.filter((finding) => finding.priority === "critical").length;
  const high = launchFindings.filter((finding) => finding.priority === "high").length;
  const ceoTaskList = buildCeoTaskList();
  const report = {
    title: "Morning Analysis",
    summary: `${critical} critical, ${high} high-priority launch blockers. Approve security/payment tasks first, then developer quality gate.`,
    dateKey,
    trigger,
    ceoTaskList,
    findings: launchFindings
  };

  await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (id, title, summary, payload_json) VALUES (?, ?, ?, ?)"
  ).bind(reportId, report.title, report.summary, JSON.stringify(report)).run();

  let newTaskCount = 0;
  for (const finding of launchFindings) {
    const taskId = finding.id;
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks
      (id, title, department_id, owner_agent_id, priority, status, risk, proposed_action, evidence_json, report_id)
      VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`
    ).bind(
      taskId,
      finding.title,
      finding.departmentId,
      finding.ownerAgentId,
      finding.priority,
      finding.risk,
      finding.proposedAction,
      JSON.stringify(finding.evidence),
      reportId
    ).run();
    if (result.meta.changes > 0) {
      newTaskCount++;
      await createTaskEvent(env.DB, taskId, "proposed_by_ceo_agent", { reportId, trigger, dateKey });
    }
  }

  return { reportId, report, newTaskCount };
}

async function listBootstrap(db: D1Database) {
  await seedCore(db);
  const [departments, agents, tasks, reports] = await Promise.all([
    db.prepare("SELECT id, name, purpose FROM departments ORDER BY created_at ASC").all(),
    db.prepare("SELECT id, name, department_id AS departmentId, model FROM agents ORDER BY created_at ASC").all(),
    db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100").all(),
    db.prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT 30").all()
  ]);

  return {
    departments: departments.results,
    agents: agents.results,
    tasks: dedupeTasks(tasks.results.map(normalizeTaskRow)),
    reports: reports.results.map((row) => ({
      ...row,
      payload: JSON.parse(String(row.payload_json))
    }))
  };
}

function dedupeTasks(tasks: ReturnType<typeof normalizeTaskRow>[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = String(task.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTaskRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    department: row.department_id,
    ownerAgent: row.owner_agent_id,
    priority: row.priority,
    status: row.status,
    risk: row.risk,
    proposedAction: row.proposed_action,
    evidence: JSON.parse(String(row.evidence_json || "[]")),
    approvalRequired: Boolean(row.approval_required),
    reportId: row.report_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function updateTaskStatus(env: Env["Bindings"], taskId: string, status: TaskStatus, approvedBy = "human") {
  const existing = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first();
  if (!existing) return null;

  await env.DB.prepare(
    "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(status, taskId).run();
  await createTaskEvent(env.DB, taskId, `status_${status}`, { approvedBy });

  if (status === "approved") {
    await env.COMMAND_WORKFLOW.create({
      id: `approval-${taskId}-${Date.now()}`,
      params: { taskId, trigger: "approval" }
    });
  }

  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<Record<string, unknown>>();
  return row ? normalizeTaskRow(row) : null;
}

async function acceptAllProposed(env: Env["Bindings"], approvedBy = "human") {
  const canonicalIds = launchFindings.map((finding) => finding.id);
  const placeholders = canonicalIds.map(() => "?").join(", ");
  const proposed = await env.DB.prepare(
    `SELECT id FROM tasks WHERE status = 'proposed' AND id IN (${placeholders}) ORDER BY priority ASC`
  ).bind(...canonicalIds).all<{ id: string }>();
  const accepted = [];
  for (const task of proposed.results) {
    const updated = await updateTaskStatus(env, task.id, "approved", approvedBy);
    if (updated) accepted.push(updated);
  }
  return accepted;
}

async function runAgentPlan(env: Env["Bindings"], message: TaskQueueMessage) {
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(message.taskId).first<Record<string, unknown>>();
  if (!task) return;
  await env.DB.prepare(
    "UPDATE tasks SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('approved', 'in_progress')"
  ).bind(message.taskId).run();
  await createTaskEvent(env.DB, message.taskId, "department_started_work", { action: message.action, approvedBy: message.approvedBy });

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO runs (id, task_id, agent_id, status, input_json) VALUES (?, ?, ?, 'running', ?)"
  ).bind(runId, message.taskId, task.owner_agent_id, JSON.stringify(message)).run();

  const prompt = [
    "You are an approval-based department agent for ArtBook Command Center.",
    "Return JSON only with: plan[], risks[], doneDefinition.",
    `Task: ${task.title}`,
    `Risk: ${task.risk}`,
    `Proposed action: ${task.proposed_action}`
  ].join("\n");

  let output: unknown = {
    plan: ["Review task evidence", "Prepare implementation checklist", "Wait for human execution approval"],
    risks: ["AI binding unavailable or returned non-JSON"],
    doneDefinition: "Human approves plan and task has verified outcome."
  };

  try {
    const ai = await env.AI.run(planningModel, {
      messages: [{ role: "user", content: prompt }]
    });
    output = ai;
  } catch (error) {
    output = { error: error instanceof Error ? error.message : "AI call failed", fallback: output };
  }

  await env.DB.prepare(
    "UPDATE runs SET status = 'succeeded', output_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(JSON.stringify(output), runId).run();
  await createTaskEvent(env.DB, message.taskId, "agent_plan_ready", { runId });

  await env.DB.prepare(
    "UPDATE tasks SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(message.taskId).run();
  await createTaskEvent(env.DB, message.taskId, "department_completed_work", { runId });
}

app.get("/api/bootstrap", async (c) => c.json(await listBootstrap(c.env.DB)));

app.post("/api/morning-analysis", async (c) => {
  const result = await runMorningAnalysis(c.env, "manual");
  return c.json({ ...result, bootstrap: await listBootstrap(c.env.DB) });
});

app.patch("/api/tasks/:id", async (c) => {
  const body = await c.req.json<{ status: TaskStatus; approvedBy?: string }>();
  const task = await updateTaskStatus(c.env, c.req.param("id"), body.status, body.approvedBy);
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({ task });
});

app.post("/api/tasks/accept-all", async (c) => {
  const accepted = await acceptAllProposed(c.env);
  return c.json({ accepted, bootstrap: await listBootstrap(c.env.DB) });
});

app.post("/api/tasks/:id/execute", async (c) => {
  const taskId = c.req.param("id");
  await c.env.TASK_QUEUE.send({ taskId, action: "execute_task", approvedBy: "human" });
  await createTaskEvent(c.env.DB, taskId, "queued_for_execution", {});
  return c.json({ queued: true });
});

app.get("/api/runs", async (c) => {
  const runs = await c.env.DB.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT 100").all();
  return c.json({ runs: runs.results });
});

app.get("/api/activity", async (c) => {
  const events = await c.env.DB.prepare(
    `SELECT task_events.id, task_events.task_id AS taskId, task_events.event, task_events.payload_json AS payloadJson,
      task_events.created_at AS createdAt, tasks.title AS taskTitle, tasks.department_id AS department
    FROM task_events
    LEFT JOIN tasks ON tasks.id = task_events.task_id
    ORDER BY task_events.created_at DESC
    LIMIT 100`
  ).all();
  return c.json({
    events: events.results.map((event) => ({
      ...event,
      payload: JSON.parse(String(event.payloadJson || "{}"))
    }))
  });
});

export class CommandWorkflow extends WorkflowEntrypoint<Env["Bindings"], WorkflowPayload> {
  async run(event: Readonly<WorkflowEvent<WorkflowPayload>>, step: WorkflowStep) {
    await step.do("record workflow start", async () => {
      if (event.payload.taskId) {
        await createTaskEvent(this.env.DB, event.payload.taskId, "workflow_started", event.payload);
      }
      return { ok: true };
    });

    await step.do("queue approved department agent", { retries: { limit: 3, delay: "10 seconds" } }, async () => {
      if (event.payload.taskId) {
        await this.env.TASK_QUEUE.send({ taskId: event.payload.taskId, action: "prepare_plan", approvedBy: "workflow" });
      }
      return { queued: true };
    });
  }
}

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<TaskQueueMessage>, env: Env["Bindings"]) {
    for (const message of batch.messages) {
      try {
        await runAgentPlan(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Queue task failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(runMorningAnalysis(env, "cron"));
  }
};
