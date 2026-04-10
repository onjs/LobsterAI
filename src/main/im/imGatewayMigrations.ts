import Database from 'better-sqlite3';

export const ImGatewayMigrationPhase = {
  Disabled: 'disabled',
  Phase1: 'phase1',
  Phase2: 'phase2',
  Phase3: 'phase3',
} as const;

export type ImGatewayMigrationPhase = typeof ImGatewayMigrationPhase[keyof typeof ImGatewayMigrationPhase];

export const ImGatewayMigrationPhaseAlias = {
  Full: 'full',
} as const;

export const ImGatewayMigrationSource = {
  Env: 'env',
  Config: 'im_config',
  Default: 'default',
} as const;

export type ImGatewayMigrationSource = typeof ImGatewayMigrationSource[keyof typeof ImGatewayMigrationSource];

export const ImGatewayMigrationConfigKey = {
  Phase: 'gatewayMigrationPhase',
} as const;

export const ImGatewayMigrationEnvKey = {
  Phase: 'LOBSTERAI_IM_GATEWAY_MIGRATION_PHASE',
} as const;

const PHASE_ORDER: Record<ImGatewayMigrationPhase, number> = {
  [ImGatewayMigrationPhase.Disabled]: 0,
  [ImGatewayMigrationPhase.Phase1]: 1,
  [ImGatewayMigrationPhase.Phase2]: 2,
  [ImGatewayMigrationPhase.Phase3]: 3,
};

const maxPhase = (
  current: ImGatewayMigrationPhase,
  fallback: ImGatewayMigrationPhase,
): ImGatewayMigrationPhase => (
  PHASE_ORDER[current] >= PHASE_ORDER[fallback] ? current : fallback
);

const normalizePhase = (raw?: string | null): ImGatewayMigrationPhase | undefined => {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === ImGatewayMigrationPhaseAlias.Full) {
    return ImGatewayMigrationPhase.Phase3;
  }
  if (normalized === ImGatewayMigrationPhase.Disabled) {
    return ImGatewayMigrationPhase.Disabled;
  }
  if (normalized === ImGatewayMigrationPhase.Phase1) {
    return ImGatewayMigrationPhase.Phase1;
  }
  if (normalized === ImGatewayMigrationPhase.Phase2) {
    return ImGatewayMigrationPhase.Phase2;
  }
  if (normalized === ImGatewayMigrationPhase.Phase3) {
    return ImGatewayMigrationPhase.Phase3;
  }
  return undefined;
};

export const resolveImGatewayMigrationPhase = (
  envPhase?: string | null,
  storedPhase?: string | null,
  defaultPhase: ImGatewayMigrationPhase = ImGatewayMigrationPhase.Phase1,
): { phase: ImGatewayMigrationPhase; source: ImGatewayMigrationSource } => {
  const fromEnv = normalizePhase(envPhase);
  if (fromEnv) {
    return { phase: fromEnv, source: ImGatewayMigrationSource.Env };
  }

  const fromConfig = normalizePhase(storedPhase);
  if (fromConfig) {
    if (fromConfig === ImGatewayMigrationPhase.Disabled) {
      return { phase: fromConfig, source: ImGatewayMigrationSource.Config };
    }
    const normalizedPhase = maxPhase(fromConfig, defaultPhase);
    if (normalizedPhase === fromConfig) {
      return { phase: fromConfig, source: ImGatewayMigrationSource.Config };
    }
    return { phase: normalizedPhase, source: ImGatewayMigrationSource.Default };
  }

  return { phase: defaultPhase, source: ImGatewayMigrationSource.Default };
};

const isPhaseAtLeast = (
  current: ImGatewayMigrationPhase,
  expected: ImGatewayMigrationPhase,
): boolean => PHASE_ORDER[current] >= PHASE_ORDER[expected];

const PHASE1_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS im_gateway_runtime (
    provider TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_heartbeat_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS im_channel_bindings (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    account_id TEXT,
    tenant_id TEXT,
    display_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    auth_mode TEXT NOT NULL DEFAULT 'manual',
    auth_state TEXT NOT NULL DEFAULT 'ready',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_im_channel_bindings_platform_account
    ON im_channel_bindings(platform, account_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_channel_bindings_enabled_updated
    ON im_channel_bindings(enabled, updated_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS im_inbound_events (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    event_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    thread_id TEXT,
    sender_id TEXT,
    event_type TEXT NOT NULL,
    content_text TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    received_at INTEGER NOT NULL,
    dedup_status TEXT NOT NULL DEFAULT 'accepted'
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_im_inbound_events_dedup
    ON im_inbound_events(platform, event_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_inbound_events_conversation_received
    ON im_inbound_events(platform, conversation_id, received_at DESC);
  `,
] as const;

const PHASE2_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS im_session_routes (
    route_key TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    thread_id TEXT,
    agent_id TEXT NOT NULL DEFAULT 'main',
    provider TEXT NOT NULL,
    cowork_session_id TEXT NOT NULL,
    last_event_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_session_routes_lookup
    ON im_session_routes(platform, conversation_id, thread_id, agent_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_session_routes_updated
    ON im_session_routes(updated_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS im_gateway_runs (
    run_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    platform TEXT NOT NULL,
    route_key TEXT NOT NULL,
    inbound_event_id TEXT,
    cowork_session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    duration_ms INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_route_started
    ON im_gateway_runs(route_key, started_at DESC);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_status_started
    ON im_gateway_runs(status, started_at DESC);
  `,
  `
  INSERT OR IGNORE INTO im_session_routes (
    route_key,
    platform,
    conversation_id,
    thread_id,
    agent_id,
    provider,
    cowork_session_id,
    last_event_id,
    created_at,
    updated_at
  )
  SELECT
    platform || ':' || im_conversation_id || ':' || COALESCE(agent_id, 'main') AS route_key,
    platform,
    im_conversation_id,
    NULL,
    COALESCE(agent_id, 'main') AS agent_id,
    'openclaw' AS provider,
    cowork_session_id,
    NULL,
    created_at,
    last_active_at
  FROM im_session_mappings;
  `,
] as const;

const PHASE3_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS im_outbound_deliveries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    thread_id TEXT,
    channel_message_id TEXT,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_outbound_deliveries_status_retry
    ON im_outbound_deliveries(status, next_retry_at);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_im_outbound_deliveries_run_created
    ON im_outbound_deliveries(run_id, created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS im_channel_registry_cache (
    platform TEXT PRIMARY KEY,
    version TEXT NOT NULL DEFAULT '1',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    schema_json TEXT NOT NULL DEFAULT '{}',
    ui_hints_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );
  `,
] as const;

const applyStatements = (db: Database.Database, statements: readonly string[]): void => {
  statements.forEach((sql) => db.exec(sql));
};

export const ensureImGatewayMigrationSchema = (options: {
  db: Database.Database;
  saveDb: () => void;
  envPhase?: string | null;
  storedPhase?: string | null;
  defaultPhase?: ImGatewayMigrationPhase;
  persistPhase?: (phase: ImGatewayMigrationPhase) => void;
}): { phase: ImGatewayMigrationPhase; source: ImGatewayMigrationSource } => {
  const resolved = resolveImGatewayMigrationPhase(
    options.envPhase,
    options.storedPhase,
    options.defaultPhase ?? ImGatewayMigrationPhase.Phase1,
  );

  if (resolved.source !== ImGatewayMigrationSource.Config && options.persistPhase) {
    options.persistPhase(resolved.phase);
  }

  if (resolved.phase === ImGatewayMigrationPhase.Disabled) {
    console.log('[IMGatewayMigration] migration is disabled by configuration');
    return resolved;
  }

  if (isPhaseAtLeast(resolved.phase, ImGatewayMigrationPhase.Phase1)) {
    applyStatements(options.db, PHASE1_STATEMENTS);
  }
  if (isPhaseAtLeast(resolved.phase, ImGatewayMigrationPhase.Phase2)) {
    applyStatements(options.db, PHASE2_STATEMENTS);
  }
  if (isPhaseAtLeast(resolved.phase, ImGatewayMigrationPhase.Phase3)) {
    applyStatements(options.db, PHASE3_STATEMENTS);
  }

  options.saveDb();
  console.log(
    `[IMGatewayMigration] schema ensured up to ${resolved.phase} (source: ${resolved.source})`,
  );
  return resolved;
};
