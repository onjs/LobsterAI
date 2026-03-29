import type {
  ApplyTurnMemoryUpdatesOptions,
  ApplyTurnMemoryUpdatesResult,
  CoworkUserMemory,
  CoworkUserMemoryStatus,
} from '../../coworkStore';

export interface MemoryProviderContext {
  sessionId?: string;
  agentId?: string;
  workingDirectory?: string;
}

export interface MemoryListOptions {
  query?: string;
  status?: CoworkUserMemoryStatus | 'all';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface MemoryCreateInput {
  text: string;
  confidence?: number;
  isExplicit?: boolean;
}

export interface MemoryUpdateInput {
  id: string;
  text?: string;
  confidence?: number;
  status?: CoworkUserMemoryStatus;
  isExplicit?: boolean;
}

export interface MemoryProvider {
  listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]>;
  createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory>;
  updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null>;
  deleteUserMemory(id: string, context?: MemoryProviderContext): Promise<boolean>;
  applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult>;
}
