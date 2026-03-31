-- LobsterAI SQLite DDL (整理版)
-- Generated at: 2026-03-31
-- Sources:
--   1) Runtime schema: ~/Library/Application Support/LobsterAI/lobsterai.sqlite (.schema)
--   2) Code-defined on-demand table: src/scheduled-task/metaStore.ts

-- =====================================================
-- Core KV / Cowork
-- =====================================================
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cowork_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  claude_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  pinned INTEGER NOT NULL DEFAULT 0,
  cwd TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  execution_mode TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active_skill_ids TEXT,
  agent_id TEXT NOT NULL DEFAULT 'main'
);

CREATE TABLE cowork_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  sequence INTEGER,
  FOREIGN KEY (session_id) REFERENCES cowork_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_cowork_messages_session_id
  ON cowork_messages(session_id);

CREATE TABLE cowork_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- =====================================================
-- Memory
-- =====================================================
CREATE TABLE user_memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.75,
  is_explicit INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE user_memory_sources (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  role TEXT NOT NULL DEFAULT 'system',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_memories_status_updated_at
  ON user_memories(status, updated_at DESC);

CREATE INDEX idx_user_memories_fingerprint
  ON user_memories(fingerprint);

CREATE INDEX idx_user_memory_sources_session_id
  ON user_memory_sources(session_id, is_active);

CREATE INDEX idx_user_memory_sources_memory_id
  ON user_memory_sources(memory_id, is_active);

CREATE TABLE user_memory_vector_refs (
  memory_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, provider),
  FOREIGN KEY (memory_id) REFERENCES user_memories(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_memory_vector_refs_provider
  ON user_memory_vector_refs(provider, updated_at DESC);

CREATE INDEX idx_user_memory_vector_refs_remote_id
  ON user_memory_vector_refs(provider, remote_id);

-- =====================================================
-- Agent / MCP / IM
-- =====================================================
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  identity TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  skill_ids TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'custom',
  preset_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  transport_type TEXT NOT NULL DEFAULT 'stdio',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE im_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE im_session_mappings (
  im_conversation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  cowork_session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'main',
  PRIMARY KEY (im_conversation_id, platform)
);

-- =====================================================
-- Scheduled Task (yd_cowork backend)
-- =====================================================
CREATE TABLE scheduled_tasks_yd_cowork (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_json TEXT NOT NULL,
  session_target TEXT NOT NULL,
  wake_mode TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_json TEXT NOT NULL,
  agent_id TEXT,
  session_key TEXT,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scheduled_task_runs_yd_cowork (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT,
  session_key TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  error TEXT
);

CREATE INDEX idx_scheduled_tasks_yd_cowork_enabled_updated
  ON scheduled_tasks_yd_cowork(enabled, updated_at DESC);

CREATE INDEX idx_scheduled_task_runs_yd_cowork_task_started
  ON scheduled_task_runs_yd_cowork(task_id, started_at DESC);

CREATE INDEX idx_scheduled_task_runs_yd_cowork_started
  ON scheduled_task_runs_yd_cowork(started_at DESC);

-- =====================================================
-- Scheduled Task Meta (OpenClaw cron.* local metadata)
-- Note: this table is created on-demand by ScheduledTaskMetaStore.
-- =====================================================
CREATE TABLE scheduled_task_meta (
  task_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  binding TEXT NOT NULL
);
