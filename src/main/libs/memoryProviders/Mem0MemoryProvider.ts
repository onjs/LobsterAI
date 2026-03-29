import type {
  ApplyTurnMemoryUpdatesOptions,
  ApplyTurnMemoryUpdatesResult,
  CoworkConfig,
  CoworkUserMemory,
} from '../../coworkStore';
import {
  Mem0UserIdStrategy,
  VectorMemoryProvider,
  type Mem0UserIdStrategy as Mem0UserIdStrategyType,
} from '../../../common/coworkMemory';
import type {
  MemoryCreateInput,
  MemoryListOptions,
  MemoryProvider,
  MemoryProviderContext,
  MemoryUpdateInput,
} from './MemoryProvider';

const resolveMem0UserId = (
  strategy: Mem0UserIdStrategyType,
  context?: MemoryProviderContext,
): string => {
  if (strategy === Mem0UserIdStrategy.Agent) {
    return (context?.agentId || 'main').trim() || 'main';
  }
  if (strategy === Mem0UserIdStrategy.Workspace) {
    return (context?.workingDirectory || 'default-workspace').trim() || 'default-workspace';
  }
  return 'global';
};

export class Mem0MemoryProvider implements MemoryProvider {
  private readonly getConfig: () => CoworkConfig;

  constructor(getConfig: () => CoworkConfig) {
    this.getConfig = getConfig;
  }

  isConfigured(): boolean {
    const config = this.getConfig();
    return config.vectorMemoryEnabled
      && config.vectorMemoryProvider === VectorMemoryProvider.Mem0
      && Boolean(config.mem0BaseUrl.trim());
  }

  buildUserId(context?: MemoryProviderContext): string {
    const config = this.getConfig();
    return resolveMem0UserId(config.mem0UserIdStrategy, context);
  }

  private unsupported<T>(operation: string): T {
    throw new Error(`mem0 ${operation} is not enabled in this phase`);
  }

  async listUserMemories(_options: MemoryListOptions, _context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    return this.unsupported('list');
  }

  async createUserMemory(_input: MemoryCreateInput, _context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    return this.unsupported('create');
  }

  async updateUserMemory(_input: MemoryUpdateInput, _context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    return this.unsupported('update');
  }

  async deleteUserMemory(_id: string, _context?: MemoryProviderContext): Promise<boolean> {
    return this.unsupported('delete');
  }

  async applyTurnMemoryUpdates(
    _options: ApplyTurnMemoryUpdatesOptions,
    _context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    return this.unsupported('applyTurnMemoryUpdates');
  }
}
