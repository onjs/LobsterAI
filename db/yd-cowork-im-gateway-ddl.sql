-- yd_cowork IM Gateway unified architecture (SQLite DDL proposal)
-- Date: 2026-03-31
-- Scope:
--   1) Unified provider routing (openclaw / yd_cowork)
--   2) Inbound dedup
--   3) Session routing
--   4) Run lifecycle tracking
--   5) Outbound delivery retry / DLQ
--
-- Notes:
-- - This file is a forward-compatible proposal and does not replace db/lobsterai-ddl.sql.
-- - Existing tables (im_config, im_session_mappings, cowork_sessions, cowork_messages) remain valid.
-- - All CREATE statements are idempotent (IF NOT EXISTS).

PRAGMA foreign_keys = ON;

-- =====================================================
-- 1) Gateway Provider runtime state
-- =====================================================
CREATE TABLE IF NOT EXISTS im_gateway_runtime (
  provider TEXT PRIMARY KEY,                -- openclaw | yd_cowork
  enabled INTEGER NOT NULL DEFAULT 1,       -- soft switch
  health_status TEXT NOT NULL DEFAULT 'unknown', -- unknown | healthy | degraded | unhealthy
  last_heartbeat_at INTEGER,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

-- =====================================================
-- 2) Channel installation/binding identity
-- =====================================================
CREATE TABLE IF NOT EXISTS im_channel_bindings (
  id TEXT PRIMARY KEY,                      -- uuid
  platform TEXT NOT NULL,                   -- feishu | wecom | weixin | ...
  account_id TEXT,                          -- bot/account identity in channel provider
  tenant_id TEXT,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  auth_mode TEXT NOT NULL DEFAULT 'manual', -- manual | qr | oauth | token
  auth_state TEXT NOT NULL DEFAULT 'ready', -- pending | ready | expired | failed
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_im_channel_bindings_platform_account
  ON im_channel_bindings(platform, account_id);

CREATE INDEX IF NOT EXISTS idx_im_channel_bindings_enabled_updated
  ON im_channel_bindings(enabled, updated_at DESC);

-- =====================================================
-- 3) Inbound idempotency / dedup store
-- =====================================================
CREATE TABLE IF NOT EXISTS im_inbound_events (
  id TEXT PRIMARY KEY,                      -- uuid
  platform TEXT NOT NULL,
  event_id TEXT NOT NULL,                   -- provider event id
  conversation_id TEXT NOT NULL,
  thread_id TEXT,
  sender_id TEXT,
  event_type TEXT NOT NULL,                 -- message | command | system
  content_text TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at INTEGER NOT NULL,
  dedup_status TEXT NOT NULL DEFAULT 'accepted' -- accepted | duplicate | dropped
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_im_inbound_events_dedup
  ON im_inbound_events(platform, event_id);

CREATE INDEX IF NOT EXISTS idx_im_inbound_events_conversation_received
  ON im_inbound_events(platform, conversation_id, received_at DESC);

-- =====================================================
-- 4) Unified route table (new)
-- =====================================================
CREATE TABLE IF NOT EXISTS im_session_routes (
  route_key TEXT PRIMARY KEY,               -- platform:conversation[:thread]:agent
  platform TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  thread_id TEXT,
  agent_id TEXT NOT NULL DEFAULT 'main',
  provider TEXT NOT NULL,                   -- openclaw | yd_cowork
  cowork_session_id TEXT NOT NULL,
  last_event_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_im_session_routes_lookup
  ON im_session_routes(platform, conversation_id, thread_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_im_session_routes_updated
  ON im_session_routes(updated_at DESC);

-- =====================================================
-- 5) Run lifecycle for each inbound trigger
-- =====================================================
CREATE TABLE IF NOT EXISTS im_gateway_runs (
  run_id TEXT PRIMARY KEY,                  -- uuid
  provider TEXT NOT NULL,                   -- openclaw | yd_cowork
  platform TEXT NOT NULL,
  route_key TEXT NOT NULL,
  inbound_event_id TEXT,                    -- fk logical: im_inbound_events.id
  cowork_session_id TEXT NOT NULL,
  status TEXT NOT NULL,                     -- queued | running | completed | failed | cancelled | timeout
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_route_started
  ON im_gateway_runs(route_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_status_started
  ON im_gateway_runs(status, started_at DESC);

-- =====================================================
-- 6) Outbound delivery queue (retry + DLQ)
-- =====================================================
CREATE TABLE IF NOT EXISTS im_outbound_deliveries (
  id TEXT PRIMARY KEY,                      -- uuid
  run_id TEXT NOT NULL,                     -- logical fk: im_gateway_runs.run_id
  platform TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  thread_id TEXT,
  channel_message_id TEXT,                  -- provider-side message id after send
  payload_json TEXT NOT NULL,               -- normalized outbound payload
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | sent | failed | dead_letter
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_im_outbound_deliveries_status_retry
  ON im_outbound_deliveries(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_im_outbound_deliveries_run_created
  ON im_outbound_deliveries(run_id, created_at DESC);

-- =====================================================
-- 7) Channel capability/schema registry cache (optional)
-- =====================================================
CREATE TABLE IF NOT EXISTS im_channel_registry_cache (
  platform TEXT PRIMARY KEY,
  version TEXT NOT NULL DEFAULT '1',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  schema_json TEXT NOT NULL DEFAULT '{}',
  ui_hints_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- =====================================================
-- 8) Suggested compatibility view/migration hooks (manual)
-- =====================================================
-- Compatibility notes:
-- 1) Existing im_session_mappings can be migrated to im_session_routes:
--    route_key = platform || ':' || im_conversation_id || ':main'
-- 2) Keep both tables during transition; read priority:
--    im_session_routes -> fallback im_session_mappings.
-- 3) Remove fallback after full rollout and data backfill.

