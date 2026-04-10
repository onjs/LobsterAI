import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { TaskStatus } from './constants';
import type {
  Schedule,
  ScheduledTask,
  ScheduledTaskDelivery,
  ScheduledTaskInput,
  ScheduledTaskPayload,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
} from './types';

const TASK_TABLE = 'scheduled_tasks_yd_cowork';
const RUN_TABLE = 'scheduled_task_runs_yd_cowork';

interface TaskRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  schedule_json: string;
  session_target: string;
  wake_mode: string;
  payload_json: string;
  delivery_json: string;
  agent_id: string | null;
  session_key: string | null;
  state_json: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  session_key: string | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  error: string | null;
}

type RowValue = string | number | null;

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function emptyTaskState(): TaskState {
  return {
    nextRunAtMs: null,
    lastRunAtMs: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    runningAtMs: null,
    consecutiveErrors: 0,
  };
}

function normalizeTaskState(input: unknown): TaskState {
  const state = (input && typeof input === 'object' ? input : {}) as Partial<TaskState>;
  return {
    nextRunAtMs: typeof state.nextRunAtMs === 'number' && Number.isFinite(state.nextRunAtMs) ? state.nextRunAtMs : null,
    lastRunAtMs: typeof state.lastRunAtMs === 'number' && Number.isFinite(state.lastRunAtMs) ? state.lastRunAtMs : null,
    lastStatus: state.lastStatus === TaskStatus.Success
      || state.lastStatus === TaskStatus.Error
      || state.lastStatus === TaskStatus.Running
      || state.lastStatus === TaskStatus.Skipped
      ? state.lastStatus
      : null,
    lastError: typeof state.lastError === 'string' ? state.lastError : null,
    lastDurationMs: typeof state.lastDurationMs === 'number' && Number.isFinite(state.lastDurationMs)
      ? state.lastDurationMs
      : null,
    runningAtMs: typeof state.runningAtMs === 'number' && Number.isFinite(state.runningAtMs) ? state.runningAtMs : null,
    consecutiveErrors: typeof state.consecutiveErrors === 'number' && Number.isFinite(state.consecutiveErrors)
      ? Math.max(0, Math.floor(state.consecutiveErrors))
      : 0,
  };
}

function toTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    enabled: row.enabled === 1,
    schedule: safeJsonParse<Schedule>(row.schedule_json, { kind: 'every', everyMs: 60_000 }),
    sessionTarget: row.session_target as ScheduledTask['sessionTarget'],
    wakeMode: row.wake_mode as ScheduledTask['wakeMode'],
    payload: safeJsonParse<ScheduledTaskPayload>(row.payload_json, { kind: 'agentTurn', message: '' }),
    delivery: safeJsonParse<ScheduledTaskDelivery>(row.delivery_json, { mode: 'none' }),
    agentId: row.agent_id,
    sessionKey: row.session_key,
    state: normalizeTaskState(safeJsonParse<unknown>(row.state_json, emptyTaskState())),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toRun(row: RunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    sessionKey: row.session_key,
    status: (row.status || TaskStatus.Error) as ScheduledTaskRun['status'],
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : null,
    error: row.error,
  };
}

export class YdCoworkTaskRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly saveDb: () => void,
  ) {
    this.ensureTables();
  }

  private run(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  private ensureTables(): void {
    this.run(`
      CREATE TABLE IF NOT EXISTS ${TASK_TABLE} (
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
      )
    `);
    this.run(`
      CREATE TABLE IF NOT EXISTS ${RUN_TABLE} (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        session_key TEXT,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER,
        error TEXT
      )
    `);
    this.run(`
      CREATE INDEX IF NOT EXISTS idx_${TASK_TABLE}_enabled_updated
      ON ${TASK_TABLE}(enabled, updated_at DESC)
    `);
    this.run(`
      CREATE INDEX IF NOT EXISTS idx_${RUN_TABLE}_task_started
      ON ${RUN_TABLE}(task_id, started_at DESC)
    `);
    this.run(`
      CREATE INDEX IF NOT EXISTS idx_${RUN_TABLE}_started
      ON ${RUN_TABLE}(started_at DESC)
    `);
    this.saveDb();
  }

  private getOne<T>(sql: string, params: RowValue[] = []): T | null {
    const row = this.db.prepare(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  private getAll<T>(sql: string, params: RowValue[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  listTasks(): ScheduledTask[] {
    const rows = this.getAll<TaskRow>(`
      SELECT
        id, name, description, enabled, schedule_json, session_target, wake_mode,
        payload_json, delivery_json, agent_id, session_key, state_json, created_at, updated_at
      FROM ${TASK_TABLE}
      ORDER BY updated_at DESC, created_at DESC
    `);
    return rows.map(toTask);
  }

  getTask(id: string): ScheduledTask | null {
    const row = this.getOne<TaskRow>(`
      SELECT
        id, name, description, enabled, schedule_json, session_target, wake_mode,
        payload_json, delivery_json, agent_id, session_key, state_json, created_at, updated_at
      FROM ${TASK_TABLE}
      WHERE id = ?
    `, [id]);
    return row ? toTask(row) : null;
  }

  addTask(input: ScheduledTaskInput, state: TaskState): ScheduledTask {
    const now = Date.now();
    const id = uuidv4();
    this.run(`
      INSERT INTO ${TASK_TABLE} (
        id, name, description, enabled, schedule_json, session_target, wake_mode,
        payload_json, delivery_json, agent_id, session_key, state_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      input.name,
      input.description || '',
      input.enabled ? 1 : 0,
      JSON.stringify(input.schedule),
      input.sessionTarget,
      input.wakeMode,
      JSON.stringify(input.payload),
      JSON.stringify(input.delivery || { mode: 'none' }),
      input.agentId ?? null,
      input.sessionKey ?? null,
      JSON.stringify(state),
      now,
      now,
    ]);
    this.saveDb();
    return this.getTask(id)!;
  }

  updateTask(id: string, patch: Partial<ScheduledTaskInput>, state?: TaskState): ScheduledTask | null {
    const current = this.getTask(id);
    if (!current) return null;

    const next: ScheduledTask = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
      ...(patch.sessionTarget !== undefined ? { sessionTarget: patch.sessionTarget } : {}),
      ...(patch.wakeMode !== undefined ? { wakeMode: patch.wakeMode } : {}),
      ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
      ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
      ...(patch.agentId !== undefined ? { agentId: patch.agentId ?? null } : {}),
      ...(patch.sessionKey !== undefined ? { sessionKey: patch.sessionKey ?? null } : {}),
      ...(state !== undefined ? { state } : {}),
    };

    const now = Date.now();
    this.run(`
      UPDATE ${TASK_TABLE}
      SET
        name = ?,
        description = ?,
        enabled = ?,
        schedule_json = ?,
        session_target = ?,
        wake_mode = ?,
        payload_json = ?,
        delivery_json = ?,
        agent_id = ?,
        session_key = ?,
        state_json = ?,
        updated_at = ?
      WHERE id = ?
    `, [
      next.name,
      next.description,
      next.enabled ? 1 : 0,
      JSON.stringify(next.schedule),
      next.sessionTarget,
      next.wakeMode,
      JSON.stringify(next.payload),
      JSON.stringify(next.delivery || { mode: 'none' }),
      next.agentId,
      next.sessionKey,
      JSON.stringify(next.state),
      now,
      id,
    ]);
    this.saveDb();
    return this.getTask(id);
  }

  updateTaskState(id: string, state: TaskState): ScheduledTask | null {
    const now = Date.now();
    this.run(`
      UPDATE ${TASK_TABLE}
      SET state_json = ?, updated_at = ?
      WHERE id = ?
    `, [JSON.stringify(state), now, id]);
    this.saveDb();
    return this.getTask(id);
  }

  updateTaskSessionKey(id: string, sessionKey: string | null): ScheduledTask | null {
    const now = Date.now();
    this.run(`
      UPDATE ${TASK_TABLE}
      SET session_key = ?, updated_at = ?
      WHERE id = ?
    `, [sessionKey, now, id]);
    this.saveDb();
    return this.getTask(id);
  }

  deleteTask(id: string): void {
    this.run(`DELETE FROM ${TASK_TABLE} WHERE id = ?`, [id]);
    this.run(`DELETE FROM ${RUN_TABLE} WHERE task_id = ?`, [id]);
    this.saveDb();
  }

  addRun(input: {
    taskId: string;
    sessionId?: string | null;
    sessionKey?: string | null;
    status: ScheduledTaskRun['status'];
    startedAtMs: number;
  }): ScheduledTaskRun {
    const id = uuidv4();
    this.run(`
      INSERT INTO ${RUN_TABLE} (
        id, task_id, session_id, session_key, status, started_at, finished_at, duration_ms, error
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `, [
      id,
      input.taskId,
      input.sessionId ?? null,
      input.sessionKey ?? null,
      input.status,
      input.startedAtMs,
    ]);
    this.saveDb();
    return this.getRun(id)!;
  }

  updateRun(id: string, patch: {
    sessionId?: string | null;
    sessionKey?: string | null;
    status?: ScheduledTaskRun['status'];
    finishedAtMs?: number | null;
    durationMs?: number | null;
    error?: string | null;
  }): ScheduledTaskRun | null {
    const current = this.getRun(id);
    if (!current) return null;

    const nextSessionId = patch.sessionId !== undefined ? patch.sessionId : current.sessionId;
    const nextSessionKey = patch.sessionKey !== undefined ? patch.sessionKey : current.sessionKey;
    const nextStatus = patch.status !== undefined ? patch.status : current.status;
    const nextFinishedAt = patch.finishedAtMs !== undefined
      ? patch.finishedAtMs
      : (current.finishedAt ? Date.parse(current.finishedAt) : null);
    const nextDurationMs = patch.durationMs !== undefined ? patch.durationMs : current.durationMs;
    const nextError = patch.error !== undefined ? patch.error : current.error;

    this.run(`
      UPDATE ${RUN_TABLE}
      SET
        session_id = ?,
        session_key = ?,
        status = ?,
        finished_at = ?,
        duration_ms = ?,
        error = ?
      WHERE id = ?
    `, [
      nextSessionId ?? null,
      nextSessionKey ?? null,
      nextStatus,
      nextFinishedAt ?? null,
      nextDurationMs ?? null,
      nextError ?? null,
      id,
    ]);
    this.saveDb();
    return this.getRun(id);
  }

  getRun(id: string): ScheduledTaskRun | null {
    const row = this.getOne<RunRow>(`
      SELECT id, task_id, session_id, session_key, status, started_at, finished_at, duration_ms, error
      FROM ${RUN_TABLE}
      WHERE id = ?
    `, [id]);
    return row ? toRun(row) : null;
  }

  listRuns(taskId: string, limit = 20, offset = 0): ScheduledTaskRun[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.getAll<RunRow>(`
      SELECT id, task_id, session_id, session_key, status, started_at, finished_at, duration_ms, error
      FROM ${RUN_TABLE}
      WHERE task_id = ?
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `, [taskId, safeLimit, safeOffset]);
    return rows.map(toRun);
  }

  countRuns(taskId: string): number {
    const row = this.getOne<{ count: number | string }>(`
      SELECT COUNT(*) as count
      FROM ${RUN_TABLE}
      WHERE task_id = ?
    `, [taskId]);
    return Number(row?.count || 0);
  }

  listAllRuns(limit = 20, offset = 0): ScheduledTaskRunWithName[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.getAll<RunRow & { task_name: string | null }>(`
      SELECT
        r.id, r.task_id, r.session_id, r.session_key, r.status, r.started_at, r.finished_at, r.duration_ms, r.error,
        t.name as task_name
      FROM ${RUN_TABLE} r
      LEFT JOIN ${TASK_TABLE} t ON t.id = r.task_id
      ORDER BY r.started_at DESC
      LIMIT ? OFFSET ?
    `, [safeLimit, safeOffset]);

    return rows.map((row) => ({
      ...toRun(row),
      taskName: row.task_name || row.task_id,
    }));
  }
}
