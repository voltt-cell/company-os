CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department_id TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'in_progress', 'done', 'blocked', 'rejected')),
  risk TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 1,
  report_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (owner_agent_id) REFERENCES agents(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

INSERT OR IGNORE INTO departments (id, name, purpose) VALUES
  ('ceo', 'CEO', 'Prioritize, assign, request approval'),
  ('developer', 'Developer', 'Code, tests, deploy readiness'),
  ('operations', 'Operations', 'Orders, payments, incidents'),
  ('marketing', 'Marketing', 'SEO, content, campaigns'),
  ('artist-success', 'Artist Success', 'Seller onboarding and supply');

INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES
  ('ceo-agent', 'CEO Agent', 'ceo', '@cf/meta/llama-3.1-8b-instruct'),
  ('dev-agent', 'Developer Agent', 'developer', '@cf/meta/llama-3.1-8b-instruct'),
  ('ops-agent', 'Operations Agent', 'operations', '@cf/meta/llama-3.1-8b-instruct'),
  ('growth-agent', 'Marketing Agent', 'marketing', '@cf/meta/llama-3.1-8b-instruct'),
  ('artist-agent', 'Artist Success Agent', 'artist-success', '@cf/meta/llama-3.1-8b-instruct');
