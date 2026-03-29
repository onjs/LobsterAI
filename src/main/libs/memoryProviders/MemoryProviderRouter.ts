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

  async listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 is not configured');
    }
    return this.sqljsProvider.listUserMemories(options, context);
  }

  async createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 create is not available');
    }
    return this.sqljsProvider.createUserMemory(input, context);
  }

  async updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 update is not available');
    }
    return this.sqljsProvider.updateUserMemory(input, context);
  }

  async deleteUserMemory(id: string, context?: MemoryProviderContext): Promise<boolean> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 delete is not available');
    }
    return this.sqljsProvider.deleteUserMemory(id, context);
  }

  async applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    if (this.shouldUseMem0() && !this.mem0Provider.isConfigured()) {
      this.emitMem0SkippedWarningOnce('mem0 turn update is not available');
    }
    return this.sqljsProvider.applyTurnMemoryUpdates(options, context);
  }
}
