import { describe, expect, test, vi } from 'vitest';
import {
  ensureImGatewayMigrationSchema,
  ImGatewayMigrationPhase,
  ImGatewayMigrationSource,
  resolveImGatewayMigrationPhase,
} from './imGatewayMigrations';

class DbStub {
  public runs: string[] = [];

  run(sql: string) {
    this.runs.push(sql);
  }

  exec(sql: string) {
    this.runs.push(sql);
  }
}

describe('imGatewayMigrations', () => {
  test('resolve phase prefers env over stored config', () => {
    const resolved = resolveImGatewayMigrationPhase('phase3', 'phase1');
    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase3);
    expect(resolved.source).toBe(ImGatewayMigrationSource.Env);
  });

  test('resolve phase falls back to stored config when env is invalid', () => {
    const resolved = resolveImGatewayMigrationPhase('unknown', 'phase2');
    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase2);
    expect(resolved.source).toBe(ImGatewayMigrationSource.Config);
  });

  test('resolve phase upgrades stored phase when default floor is higher', () => {
    const resolved = resolveImGatewayMigrationPhase(
      undefined,
      ImGatewayMigrationPhase.Phase1,
      ImGatewayMigrationPhase.Phase3,
    );
    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase3);
    expect(resolved.source).toBe(ImGatewayMigrationSource.Default);
  });

  test('resolve phase keeps stored disabled phase even when default is higher', () => {
    const resolved = resolveImGatewayMigrationPhase(
      undefined,
      ImGatewayMigrationPhase.Disabled,
      ImGatewayMigrationPhase.Phase3,
    );
    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Disabled);
    expect(resolved.source).toBe(ImGatewayMigrationSource.Config);
  });

  test('resolve phase maps full alias to phase3', () => {
    const resolved = resolveImGatewayMigrationPhase('full', undefined);
    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase3);
  });

  test('phase1 creates foundational tables only', () => {
    const db = new DbStub();
    const saveDb = vi.fn();

    const resolved = ensureImGatewayMigrationSchema({
      db: db as any,
      saveDb,
      envPhase: ImGatewayMigrationPhase.Phase1,
    });

    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase1);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_gateway_runtime'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_im_inbound_events_dedup'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_session_routes'))).toBe(false);
    expect(saveDb).toHaveBeenCalledOnce();
  });

  test('phase2 creates routing tables and runs legacy backfill', () => {
    const db = new DbStub();
    const saveDb = vi.fn();

    const resolved = ensureImGatewayMigrationSchema({
      db: db as any,
      saveDb,
      envPhase: ImGatewayMigrationPhase.Phase2,
    });

    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase2);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_session_routes'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_im_session_routes_lookup'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_status_started'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_im_gateway_runs_route_started'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('INSERT OR IGNORE INTO im_session_routes'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_outbound_deliveries'))).toBe(false);
    expect(saveDb).toHaveBeenCalledOnce();
  });

  test('phase3 creates outbound delivery and registry cache tables', () => {
    const db = new DbStub();
    const saveDb = vi.fn();

    const resolved = ensureImGatewayMigrationSchema({
      db: db as any,
      saveDb,
      envPhase: ImGatewayMigrationPhase.Phase3,
    });

    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Phase3);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_outbound_deliveries'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_im_outbound_deliveries_status_retry'))).toBe(true);
    expect(db.runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS im_channel_registry_cache'))).toBe(true);
    expect(saveDb).toHaveBeenCalledOnce();
  });

  test('disabled phase skips schema changes and save', () => {
    const db = new DbStub();
    const saveDb = vi.fn();

    const resolved = ensureImGatewayMigrationSchema({
      db: db as any,
      saveDb,
      envPhase: ImGatewayMigrationPhase.Disabled,
    });

    expect(resolved.phase).toBe(ImGatewayMigrationPhase.Disabled);
    expect(db.runs.length).toBe(0);
    expect(saveDb).not.toHaveBeenCalled();
  });

  test('persist phase callback runs for env/default sources only', () => {
    const db = new DbStub();
    const saveDb = vi.fn();
    const persistPhase = vi.fn();

    ensureImGatewayMigrationSchema({
      db: db as any,
      saveDb,
      envPhase: ImGatewayMigrationPhase.Phase2,
      storedPhase: ImGatewayMigrationPhase.Phase1,
      persistPhase,
    });
    expect(persistPhase).toHaveBeenCalledWith(ImGatewayMigrationPhase.Phase2);

    persistPhase.mockClear();
    ensureImGatewayMigrationSchema({
      db: new DbStub() as any,
      saveDb: vi.fn(),
      storedPhase: ImGatewayMigrationPhase.Phase1,
      persistPhase,
    });
    expect(persistPhase).not.toHaveBeenCalled();
  });
});
