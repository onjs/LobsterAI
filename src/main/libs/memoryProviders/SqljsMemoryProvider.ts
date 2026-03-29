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

export class SqljsMemoryProvider implements MemoryProvider {
  private readonly store: CoworkStore;

  constructor(store: CoworkStore) {
    this.store = store;
  }

  async listUserMemories(options: MemoryListOptions, _context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    return this.store.listUserMemories(options);
  }

  async createUserMemory(input: MemoryCreateInput, _context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    return this.store.createUserMemory(input);
  }

  async updateUserMemory(input: MemoryUpdateInput, _context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    return this.store.updateUserMemory(input);
  }

  async deleteUserMemory(id: string, _context?: MemoryProviderContext): Promise<boolean> {
    return this.store.deleteUserMemory(id);
  }

  async applyTurnMemoryUpdates(
    options: ApplyTurnMemoryUpdatesOptions,
    _context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    return this.store.applyTurnMemoryUpdates(options);
  }
}
