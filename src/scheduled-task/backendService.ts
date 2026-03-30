import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
} from './types';

export interface ScheduledTaskBackendService {
  addJob(input: ScheduledTaskInput): Promise<ScheduledTask>;
  updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask>;
  removeJob(id: string): Promise<void>;
  listJobs(): Promise<ScheduledTask[]>;
  getJob(id: string): Promise<ScheduledTask | null>;
  toggleJob(id: string, enabled: boolean): Promise<ScheduledTask>;
  runJob(id: string): Promise<void>;
  stopJob(id: string): Promise<boolean>;
  listRuns(jobId: string, limit?: number, offset?: number): Promise<ScheduledTaskRun[]>;
  countRuns(jobId: string): Promise<number>;
  listAllRuns(limit?: number, offset?: number): Promise<ScheduledTaskRunWithName[]>;
  startPolling(): void;
  stopPolling(): void;
}

