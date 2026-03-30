import { BrowserWindow } from 'electron';
import { IpcChannel, ScheduleKind, TaskStatus } from './constants';
import type { ScheduledTaskBackendService } from './backendService';
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
} from './types';
import { computeNextRunAtMs, shouldRunNow } from './ydCoworkSchedule';
import { YdCoworkTaskRepository } from './ydCoworkTaskRepository';

export interface YdCoworkRunResult {
  status: ScheduledTaskRun['status'];
  sessionId?: string | null;
  sessionKey?: string | null;
  error?: string | null;
  durationMs?: number | null;
}

interface YdCoworkCronJobServiceDeps {
  repository: YdCoworkTaskRepository;
  executeTask: (task: ScheduledTask) => Promise<YdCoworkRunResult>;
}

export class YdCoworkCronJobService implements ScheduledTaskBackendService {
  private readonly repository: YdCoworkTaskRepository;
  private readonly executeTask: (task: ScheduledTask) => Promise<YdCoworkRunResult>;
  private readonly runningTaskIds = new Set<string>();
  private polling = false;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private firstPollDone = false;

  private static readonly POLL_INTERVAL_MS = 2_000;

  constructor(deps: YdCoworkCronJobServiceDeps) {
    this.repository = deps.repository;
    this.executeTask = deps.executeTask;
  }

  async addJob(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const now = Date.now();
    const initialState: TaskState = {
      nextRunAtMs: input.enabled ? computeNextRunAtMs(input.schedule, now, now) : null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    };
    const task = this.repository.addTask(input, initialState);
    this.emitStatusUpdate(task.id, task.state);
    return task;
  }

  async updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    const current = this.repository.getTask(id);
    if (!current) {
      throw new Error(`Scheduled task ${id} was not found.`);
    }

    const mergedSchedule = input.schedule ?? current.schedule;
    const mergedEnabled = input.enabled ?? current.enabled;
    const nextRunAtMs = mergedEnabled
      ? computeNextRunAtMs(mergedSchedule, Date.now(), Date.parse(current.createdAt))
      : null;
    const nextState: TaskState = {
      ...current.state,
      nextRunAtMs,
      runningAtMs: null,
    };

    const updated = this.repository.updateTask(id, input, nextState);
    if (!updated) {
      throw new Error(`Scheduled task ${id} was not found after update.`);
    }
    this.emitStatusUpdate(updated.id, updated.state);
    return updated;
  }

  async removeJob(id: string): Promise<void> {
    this.repository.deleteTask(id);
    this.runningTaskIds.delete(id);
  }

  async listJobs(): Promise<ScheduledTask[]> {
    return this.repository.listTasks();
  }

  async getJob(id: string): Promise<ScheduledTask | null> {
    return this.repository.getTask(id);
  }

  async toggleJob(id: string, enabled: boolean): Promise<ScheduledTask> {
    const current = this.repository.getTask(id);
    if (!current) {
      throw new Error(`Scheduled task ${id} was not found.`);
    }
    const nextState: TaskState = {
      ...current.state,
      nextRunAtMs: enabled
        ? computeNextRunAtMs(current.schedule, Date.now(), Date.parse(current.createdAt))
        : null,
      runningAtMs: null,
    };
    const updated = this.repository.updateTask(id, { enabled }, nextState);
    if (!updated) {
      throw new Error(`Scheduled task ${id} was not found after toggle.`);
    }
    this.emitStatusUpdate(updated.id, updated.state);
    return updated;
  }

  async runJob(id: string): Promise<void> {
    const task = this.repository.getTask(id);
    if (!task) {
      throw new Error(`Scheduled task ${id} was not found.`);
    }
    await this.runSingleTask(task);
  }

  async stopJob(id: string): Promise<boolean> {
    void id;
    return false;
  }

  async listRuns(jobId: string, limit = 20, offset = 0): Promise<ScheduledTaskRun[]> {
    return this.repository.listRuns(jobId, limit, offset);
  }

  async countRuns(jobId: string): Promise<number> {
    return this.repository.countRuns(jobId);
  }

  async listAllRuns(limit = 20, offset = 0): Promise<ScheduledTaskRunWithName[]> {
    return this.repository.listAllRuns(limit, offset);
  }

  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.recoverTaskStates();
    void this.pollOnce();
    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, YdCoworkCronJobService.POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    this.polling = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.runningTaskIds.clear();
    this.firstPollDone = false;
  }

  private recoverTaskStates(): void {
    const tasks = this.repository.listTasks();
    for (const task of tasks) {
      if (!task.state.runningAtMs) continue;
      const recoveredState: TaskState = {
        ...task.state,
        runningAtMs: null,
        lastStatus: TaskStatus.Skipped,
        lastError: 'Recovered from previous process shutdown while task was running.',
      };
      const updated = this.repository.updateTaskState(task.id, recoveredState);
      if (updated) {
        this.emitStatusUpdate(updated.id, updated.state);
      }
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.polling) return;

    const now = Date.now();
    const tasks = this.repository.listTasks();

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (this.runningTaskIds.has(task.id)) continue;
      if (task.state.runningAtMs) continue;

      let nextRunAtMs = task.state.nextRunAtMs;
      if (nextRunAtMs === null || !Number.isFinite(nextRunAtMs)) {
        const recomputed = computeNextRunAtMs(task.schedule, now, Date.parse(task.createdAt));
        const nextState: TaskState = { ...task.state, nextRunAtMs: recomputed };
        const updated = this.repository.updateTaskState(task.id, nextState);
        nextRunAtMs = updated?.state.nextRunAtMs ?? recomputed;
      }

      if (!shouldRunNow(nextRunAtMs, now)) continue;
      await this.runSingleTask(task);
    }

    if (!this.firstPollDone) {
      this.firstPollDone = true;
      this.emitFullRefresh();
    }
  }

  private async runSingleTask(task: ScheduledTask): Promise<void> {
    if (this.runningTaskIds.has(task.id)) {
      return;
    }
    this.runningTaskIds.add(task.id);
    const startedAtMs = Date.now();
    const runningState: TaskState = {
      ...task.state,
      runningAtMs: startedAtMs,
      lastStatus: TaskStatus.Running,
      lastError: null,
    };
    this.repository.updateTaskState(task.id, runningState);
    this.emitStatusUpdate(task.id, runningState);

    const run = this.repository.addRun({
      taskId: task.id,
      status: TaskStatus.Running,
      startedAtMs,
    });

    try {
      const result = await this.executeTask(task);
      const finishedAtMs = Date.now();
      const durationMs = typeof result.durationMs === 'number'
        ? result.durationMs
        : Math.max(0, finishedAtMs - startedAtMs);
      const status = result.status;
      const error = status === TaskStatus.Error
        ? (result.error || 'Task execution failed.')
        : null;

      const nextTask = this.repository.getTask(task.id);
      if (!nextTask) return;

      const isOneShot = nextTask.schedule.kind === ScheduleKind.At;
      const nextEnabled = isOneShot ? false : nextTask.enabled;
      const nextRunAtMs = nextEnabled
        ? computeNextRunAtMs(nextTask.schedule, finishedAtMs, Date.parse(nextTask.createdAt))
        : null;
      const nextState: TaskState = {
        ...nextTask.state,
        nextRunAtMs,
        lastRunAtMs: finishedAtMs,
        lastStatus: status,
        lastError: error,
        lastDurationMs: durationMs,
        runningAtMs: null,
        consecutiveErrors: status === TaskStatus.Error
          ? nextTask.state.consecutiveErrors + 1
          : 0,
      };

      const patch: Partial<ScheduledTaskInput> = {};
      if (isOneShot) {
        patch.enabled = false;
      }
      if (nextTask.sessionTarget === 'main' && !nextTask.sessionKey && result.sessionId) {
        patch.sessionKey = result.sessionId;
      }

      if (Object.keys(patch).length > 0) {
        this.repository.updateTask(nextTask.id, patch, nextState);
      } else {
        this.repository.updateTaskState(nextTask.id, nextState);
      }

      const updatedRun = this.repository.updateRun(run.id, {
        sessionId: result.sessionId ?? null,
        sessionKey: result.sessionKey ?? null,
        status,
        finishedAtMs,
        durationMs,
        error,
      });
      if (updatedRun) {
        const taskName = this.repository.getTask(task.id)?.name || task.id;
        this.emitRunUpdate({ ...updatedRun, taskName });
      }
      const latest = this.repository.getTask(task.id);
      if (latest) {
        this.emitStatusUpdate(task.id, latest.state);
      }
    } catch (error) {
      const finishedAtMs = Date.now();
      const nextTask = this.repository.getTask(task.id);
      if (nextTask) {
        const nextState: TaskState = {
          ...nextTask.state,
          runningAtMs: null,
          lastRunAtMs: finishedAtMs,
          lastStatus: TaskStatus.Error,
          lastError: error instanceof Error ? error.message : String(error),
          lastDurationMs: Math.max(0, finishedAtMs - startedAtMs),
          nextRunAtMs: computeNextRunAtMs(nextTask.schedule, finishedAtMs, Date.parse(nextTask.createdAt)),
          consecutiveErrors: nextTask.state.consecutiveErrors + 1,
        };
        this.repository.updateTaskState(nextTask.id, nextState);
        this.emitStatusUpdate(nextTask.id, nextState);
      }

      const updatedRun = this.repository.updateRun(run.id, {
        status: TaskStatus.Error,
        finishedAtMs,
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        error: error instanceof Error ? error.message : String(error),
      });
      if (updatedRun) {
        const taskName = this.repository.getTask(task.id)?.name || task.id;
        this.emitRunUpdate({ ...updatedRun, taskName });
      }
    } finally {
      this.runningTaskIds.delete(task.id);
    }
  }

  private emitStatusUpdate(taskId: string, state: TaskState): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IpcChannel.StatusUpdate, { taskId, state });
    });
  }

  private emitRunUpdate(run: ScheduledTaskRunWithName): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IpcChannel.RunUpdate, { run });
    });
  }

  private emitFullRefresh(): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IpcChannel.Refresh);
    });
  }
}
