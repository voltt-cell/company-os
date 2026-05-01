-- Phase 1: Expand departments
INSERT OR IGNORE INTO departments (id, name, purpose) VALUES
  ('hr', 'HR', 'Team management, hiring workflows, onboarding documentation'),
  ('testing', 'Testing', 'QA plans, test cases, bug reports, regression testing'),
  ('ui-ux', 'UI/UX Designer', 'Design specs, component styling, UX audits, accessibility');

-- Phase 1: Expand agents
INSERT OR IGNORE INTO agents (id, name, department_id, model) VALUES
  ('hr-agent', 'HR Agent', 'hr', 'llama3.1:8b'),
  ('test-agent', 'Testing Agent', 'testing', 'llama3.1:8b'),
  ('uiux-agent', 'UI/UX Agent', 'ui-ux', 'llama3.1:8b');

-- Update existing agents to use ollama model names
UPDATE agents SET model = 'llama3.1:8b' WHERE model LIKE '@cf/%';

-- Phase 2: CEO chat history
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user', 'ceo', 'system')),
  content TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Phase 4: Git operation tracking
CREATE TABLE IF NOT EXISTS git_operations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('branch', 'commit', 'push', 'merge')),
  branch TEXT NOT NULL,
  message TEXT,
  files_json TEXT DEFAULT '[]',
  diff_summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'ceo_reviewed', 'human_reviewed', 'approved', 'pushed', 'rejected')),
  ceo_review TEXT,
  human_review TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Add description field to tasks for richer context
ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT '';

-- Add plan_json to store AI-generated execution plan
ALTER TABLE tasks ADD COLUMN plan_json TEXT DEFAULT '{}';
