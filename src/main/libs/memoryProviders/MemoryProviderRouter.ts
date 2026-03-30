import type {
  ApplyTurnMemoryUpdatesOptions,
  ApplyTurnMemoryUpdatesResult,
  CoworkStore,
  CoworkUserMemory,
} from '../../coworkStore';
import type {
  MemoryCreateInput,
  MemoryListOptions,
  MemoryProvider,
  MemoryProviderContext,
  MemoryUpdateInput,
} from './MemoryProvider';
import { SqljsMemoryProvider } from './SqljsMemoryProvider';

export class MemoryProviderRouter implements MemoryProvider {
  private readonly sqljsProvider: MemoryProvider;

  constructor(store: CoworkStore) {
    this.sqljsProvider = new SqljsMemoryProvider(store);
  }

  async listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    return this.sqljsProvider.listUserMemories(options, context);
  }

  async createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    return this.sqljsProvider.createUserMemory(input, context);
  }

  async updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    return this.sqljsProvider.updateUserMemory(input, context);
  }

  async deleteUserMemory(id: string, context?: MemoryProviderContext): Promise<boolean> {
    return this.sqljsProvider.deleteUserMemory(id, context);
  }

  async applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    return this.sqljsProvider.applyTurnMemoryUpdates(options, context);
  }
}
