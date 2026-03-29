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
  private readonly getConfig: () => CoworkConfig;
  private readonly sqljsProvider: MemoryProvider;
  private readonly mem0Provider: Mem0MemoryProvider;
  private readonly logger: LoggerLike;
  private mem0WarningShown = false;
  private mem0SyncQueue: Promise<void> = Promise.resolve();

  constructor(deps: {
    store: CoworkStore;
    getConfig: () => CoworkConfig;
    logger?: LoggerLike;
  }) {
    this.getConfig = deps.getConfig;
    this.sqljsProvider = new SqljsMemoryProvider(deps.store);
    this.mem0Provider = new Mem0MemoryProvider(this.getConfig);
    this.logger = deps.logger || console;
  }

  private shouldUseMem0(): boolean {
    const config = this.getConfig();
    return config.vectorMemoryEnabled && config.vectorMemoryProvider === VectorMemoryProvider.Mem0;
  }

  private emitMem0SkippedWarningOnce(reason: string): void {
    if (this.mem0WarningShown) return;
    this.mem0WarningShown = true;
    this.logger.warn(`[MemoryProviderRouter] mem0 path skipped: ${reason}. Falling back to sqljs.`);
  }

  private scheduleMem0Sync(context?: MemoryProviderContext): void {
    if (!this.shouldUseMem0()) return;
    if (!this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
      return;
    }

    this.mem0SyncQueue = this.mem0SyncQueue
      .then(async () => {
        const localMemories = await this.sqljsProvider.listUserMemories({
          status: 'created',
          includeDeleted: false,
          limit: 200,
          offset: 0,
        }, context);
        await this.mem0Provider.syncFromLocalMemories(localMemories, context);
        this.logger.debug(`[MemoryProviderRouter] synced ${localMemories.length} memories to mem0`);
      })
      .catch((error) => {
        this.logger.warn(
          `[MemoryProviderRouter] mem0 sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  async listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
    }
    return this.sqljsProvider.listUserMemories(options, context);
  }

  async createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    const created = await this.sqljsProvider.createUserMemory(input, context);
    this.scheduleMem0Sync(context);
    return created;
  }

  async updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    const updated = await this.sqljsProvider.updateUserMemory(input, context);
    if (updated) {
      this.scheduleMem0Sync(context);
    }
    return updated;
  }

  async deleteUserMemory(id: string, context?: MemoryProviderContext): Promise<boolean> {
    const deleted = await this.sqljsProvider.deleteUserMemory(id, context);
    if (deleted) {
      this.scheduleMem0Sync(context);
    }
    return deleted;
  }

  async applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    const result = await this.sqljsProvider.applyTurnMemoryUpdates(options, context);
    if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
      this.scheduleMem0Sync(context);
    }
    return result;
  }
}
