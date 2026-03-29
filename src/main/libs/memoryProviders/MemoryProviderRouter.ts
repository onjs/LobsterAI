import type {
  ApplyTurnMemoryUpdatesOptions,
  ApplyTurnMemoryUpdatesResult,
  CoworkConfig,
  CoworkStore,
  CoworkUserMemory,
} from '../../coworkStore';
import { VectorMemoryProvider } from '../../../common/coworkMemory';
import type {
  MemoryCreateInput,
  MemoryListOptions,
  MemoryProvider,
  MemoryProviderContext,
  MemoryUpdateInput,
} from './MemoryProvider';
import { Mem0MemoryProvider } from './Mem0MemoryProvider';
import { SqljsMemoryProvider } from './SqljsMemoryProvider';

type LoggerLike = Pick<Console, 'debug' | 'warn'>;

export class MemoryProviderRouter implements MemoryProvider {
  private readonly store: CoworkStore;
  private readonly getConfig: () => CoworkConfig;
  private readonly sqljsProvider: MemoryProvider;
  private readonly mem0Provider: Mem0MemoryProvider;
  private readonly logger: LoggerLike;
  private mem0WarningShown = false;
  private mem0SyncQueue: Promise<void> = Promise.resolve();
  private mem0ConsecutiveFailures = 0;
  private mem0CircuitOpenUntil = 0;
  private static readonly MEM0_PROVIDER_KEY = 'mem0';
  private static readonly MEM0_CIRCUIT_FAILURE_THRESHOLD = 3;
  private static readonly MEM0_CIRCUIT_COOLDOWN_MS = 60_000;

  constructor(deps: {
    store: CoworkStore;
    getConfig: () => CoworkConfig;
    logger?: LoggerLike;
  }) {
    this.store = deps.store;
    this.getConfig = deps.getConfig;
    this.sqljsProvider = new SqljsMemoryProvider(deps.store);
    this.mem0Provider = new Mem0MemoryProvider(this.getConfig);
    this.logger = deps.logger || console;
  }

  private shouldUseMem0(): boolean {
    const config = this.getConfig();
    return config.vectorMemoryEnabled && config.vectorMemoryProvider === VectorMemoryProvider.Mem0;
  }

  private shouldFallbackToSqljs(): boolean {
    return this.getConfig().vectorFallbackToSqljs;
  }

  private isMem0CircuitOpen(): boolean {
    return Date.now() < this.mem0CircuitOpenUntil;
  }

  private markMem0Success(): void {
    this.mem0ConsecutiveFailures = 0;
    this.mem0CircuitOpenUntil = 0;
  }

  private markMem0Failure(error: unknown, operation: string): void {
    this.mem0ConsecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    if (this.mem0ConsecutiveFailures >= MemoryProviderRouter.MEM0_CIRCUIT_FAILURE_THRESHOLD) {
      this.mem0CircuitOpenUntil = Date.now() + MemoryProviderRouter.MEM0_CIRCUIT_COOLDOWN_MS;
      this.mem0ConsecutiveFailures = 0;
      this.logger.warn(
        `[MemoryProviderRouter] mem0 ${operation} failed repeatedly. Circuit is open for ${MemoryProviderRouter.MEM0_CIRCUIT_COOLDOWN_MS}ms. Last error: ${message}`,
      );
      return;
    }
    this.logger.warn(`[MemoryProviderRouter] mem0 ${operation} failed: ${message}`);
  }

  private emitMem0SkippedWarningOnce(reason: string): void {
    if (this.mem0WarningShown) return;
    this.mem0WarningShown = true;
    this.logger.warn(`[MemoryProviderRouter] mem0 path skipped: ${reason}. Falling back to sqljs.`);
  }

  private enqueueMem0Task(task: () => Promise<void>): void {
    this.mem0SyncQueue = this.mem0SyncQueue
      .then(async () => {
        if (this.isMem0CircuitOpen()) {
          this.logger.debug('[MemoryProviderRouter] mem0 sync skipped while circuit is open');
          return;
        }
        await task();
        this.markMem0Success();
      })
      .catch((error) => {
        this.markMem0Failure(error, 'sync');
      });
  }

  private scheduleMem0Reconcile(context?: MemoryProviderContext): void {
    if (!this.shouldUseMem0()) return;
    if (!this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return;
    }
    if (this.isMem0CircuitOpen()) return;

    this.enqueueMem0Task(async () => {
      const localMemories = await this.sqljsProvider.listUserMemories({
        status: 'created',
        includeDeleted: false,
        limit: 400,
        offset: 0,
      }, context);
      const localById = new Map(localMemories.map((item) => [item.id, item] as const));
      const refs = this.store.listMemoryVectorRefs(MemoryProviderRouter.MEM0_PROVIDER_KEY);

      for (const memory of localMemories) {
        const ref = refs.find((item) => item.memoryId === memory.id) || null;
        if (!ref) {
          const remoteId = await this.mem0Provider.addRemoteMemory(memory, context);
          if (remoteId) {
            this.store.upsertMemoryVectorRef({
              memoryId: memory.id,
              provider: MemoryProviderRouter.MEM0_PROVIDER_KEY,
              remoteId,
            });
          }
          continue;
        }

        try {
          await this.mem0Provider.updateRemoteMemory(ref.remoteId, memory.text);
        } catch (error) {
          if (this.mem0Provider.isNotFoundError(error)) {
            const remoteId = await this.mem0Provider.addRemoteMemory(memory, context);
            if (remoteId) {
              this.store.upsertMemoryVectorRef({
                memoryId: memory.id,
                provider: MemoryProviderRouter.MEM0_PROVIDER_KEY,
                remoteId,
              });
            }
          } else {
            throw error;
          }
        }
      }

      for (const ref of refs) {
        if (localById.has(ref.memoryId)) continue;
        try {
          await this.mem0Provider.deleteRemoteMemory(ref.remoteId);
        } catch (error) {
          if (!this.mem0Provider.isNotFoundError(error)) {
            throw error;
          }
        } finally {
          this.store.deleteMemoryVectorRef(ref.memoryId, MemoryProviderRouter.MEM0_PROVIDER_KEY);
        }
      }

      this.logger.debug(`[MemoryProviderRouter] reconciled ${localMemories.length} local memories with mem0`);
    });
  }

  private scheduleMem0Create(memory: CoworkUserMemory, context?: MemoryProviderContext): void {
    if (!this.shouldUseMem0()) return;
    if (!this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return;
    }
    if (this.isMem0CircuitOpen()) return;

    this.enqueueMem0Task(async () => {
      const remoteId = await this.mem0Provider.addRemoteMemory(memory, context);
      if (!remoteId) return;
      this.store.upsertMemoryVectorRef({
        memoryId: memory.id,
        provider: MemoryProviderRouter.MEM0_PROVIDER_KEY,
        remoteId,
      });
    });
  }

  private scheduleMem0Update(memory: CoworkUserMemory, context?: MemoryProviderContext): void {
    if (!this.shouldUseMem0()) return;
    if (!this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return;
    }
    if (this.isMem0CircuitOpen()) return;

    this.enqueueMem0Task(async () => {
      const existingRef = this.store.getMemoryVectorRef(memory.id, MemoryProviderRouter.MEM0_PROVIDER_KEY);
      if (!existingRef) {
        const remoteId = await this.mem0Provider.addRemoteMemory(memory, context);
        if (remoteId) {
          this.store.upsertMemoryVectorRef({
            memoryId: memory.id,
            provider: MemoryProviderRouter.MEM0_PROVIDER_KEY,
            remoteId,
          });
        }
        return;
      }

      try {
        await this.mem0Provider.updateRemoteMemory(existingRef.remoteId, memory.text);
      } catch (error) {
        if (!this.mem0Provider.isNotFoundError(error)) {
          throw error;
        }
        const remoteId = await this.mem0Provider.addRemoteMemory(memory, context);
        if (remoteId) {
          this.store.upsertMemoryVectorRef({
            memoryId: memory.id,
            provider: MemoryProviderRouter.MEM0_PROVIDER_KEY,
            remoteId,
          });
        }
      }
    });
  }

  private scheduleMem0Delete(memoryId: string, context?: MemoryProviderContext): void {
    if (!this.shouldUseMem0()) return;
    if (!this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return;
    }
    if (this.isMem0CircuitOpen()) return;

    const existingRef = this.store.getMemoryVectorRef(memoryId, MemoryProviderRouter.MEM0_PROVIDER_KEY);
    if (!existingRef) return;

    this.enqueueMem0Task(async () => {
      try {
        await this.mem0Provider.deleteRemoteMemory(existingRef.remoteId);
      } catch (error) {
        if (!this.mem0Provider.isNotFoundError(error)) {
          throw error;
        }
      } finally {
        this.store.deleteMemoryVectorRef(memoryId, MemoryProviderRouter.MEM0_PROVIDER_KEY);
      }
    });
  }

  private applyLocalListFilters(entries: CoworkUserMemory[], options: MemoryListOptions): CoworkUserMemory[] {
    const status = options.status || 'all';
    const includeDeleted = Boolean(options.includeDeleted);
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 200)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const filtered = entries.filter((entry) => {
      if (status !== 'all') {
        return entry.status === status;
      }
      if (!includeDeleted) {
        return entry.status !== 'deleted';
      }
      return true;
    });
    return filtered.slice(offset, offset + limit);
  }

  private async listMemoriesByMem0Query(
    options: MemoryListOptions,
    context?: MemoryProviderContext,
  ): Promise<CoworkUserMemory[] | null> {
    if (!this.shouldUseMem0()) return null;
    if (!this.mem0Provider.isConfigured()) {
      if (!this.shouldFallbackToSqljs()) {
        throw new Error('mem0 is not configured');
      }
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return null;
    }
    if (this.isMem0CircuitOpen()) {
      if (!this.shouldFallbackToSqljs()) {
        throw new Error('mem0 circuit is open');
      }
      this.emitMem0SkippedWarningOnce('mem0 circuit is open');
      return null;
    }

    try {
      const semanticResults = await this.mem0Provider.listUserMemories(options, context);
      this.markMem0Success();
      if (semanticResults.length === 0) {
        return [];
      }

      const refs = this.store.listMemoryVectorRefs(MemoryProviderRouter.MEM0_PROVIDER_KEY);
      const remoteToLocalMap = new Map(refs.map((item) => [item.remoteId, item.memoryId] as const));
      const localMemories = await this.sqljsProvider.listUserMemories({
        status: 'all',
        includeDeleted: true,
        limit: 400,
        offset: 0,
      }, context);
      const localById = new Map(localMemories.map((item) => [item.id, item] as const));

      const merged: CoworkUserMemory[] = [];
      const seen = new Set<string>();
      for (const item of semanticResults) {
        const resolvedId = remoteToLocalMap.get(item.id) || item.id;
        if (seen.has(resolvedId)) continue;
        const local = localById.get(resolvedId);
        merged.push(local ? local : { ...item, id: resolvedId });
        seen.add(resolvedId);
      }
      return this.applyLocalListFilters(merged, options);
    } catch (error) {
      this.markMem0Failure(error, 'search');
      if (!this.shouldFallbackToSqljs()) {
        throw error;
      }
      return null;
    }
  }

  async listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    const query = (options.query || '').trim();
    if (query) {
      const semanticResult = await this.listMemoriesByMem0Query(options, context);
      if (semanticResult !== null) {
        return semanticResult;
      }
    } else if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
    }
    return this.sqljsProvider.listUserMemories(options, context);
  }

  async createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    const created = await this.sqljsProvider.createUserMemory(input, context);
    this.scheduleMem0Create(created, context);
    return created;
  }

  async updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    const updated = await this.sqljsProvider.updateUserMemory(input, context);
    if (updated) {
      this.scheduleMem0Update(updated, context);
    }
    return updated;
  }

  async deleteUserMemory(id: string, context?: MemoryProviderContext): Promise<boolean> {
    const memoryId = id.trim();
    if (!memoryId) return false;
    const deleted = await this.sqljsProvider.deleteUserMemory(id, context);
    if (deleted) {
      this.scheduleMem0Delete(memoryId, context);
    }
    return deleted;
  }

  async applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    const result = await this.sqljsProvider.applyTurnMemoryUpdates(options, context);
    if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
      this.scheduleMem0Reconcile(context);
    }
    return result;
  }
}
