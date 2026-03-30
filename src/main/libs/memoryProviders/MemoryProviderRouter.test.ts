import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CoworkStore } from '../../coworkStore';
import { MemoryProviderRouter } from './MemoryProviderRouter';

const buildStoreMock = (): CoworkStore => {
  const memory = {
    id: 'm1',
    text: 'I prefer concise responses.',
    confidence: 0.9,
    isExplicit: true,
    status: 'created' as const,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
  };

  return {
    listUserMemories: vi.fn(() => [memory]),
    createUserMemory: vi.fn(() => memory),
    updateUserMemory: vi.fn(() => memory),
    deleteUserMemory: vi.fn(() => true),
    getMemoryVectorRef: vi.fn(() => null),
    listMemoryVectorRefs: vi.fn(() => []),
    upsertMemoryVectorRef: vi.fn(() => undefined),
    deleteMemoryVectorRef: vi.fn(() => undefined),
    applyTurnMemoryUpdates: vi.fn(async () => ({
      totalChanges: 1,
      created: 1,
      updated: 0,
      deleted: 0,
      judgeRejected: 0,
      llmReviewed: 0,
      skipped: 0,
    })),
  } as unknown as CoworkStore;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MemoryProviderRouter', () => {
  test('uses sqljs provider for list', async () => {
    const store = buildStoreMock();
    const router = new MemoryProviderRouter(store);

    const entries = await router.listUserMemories({ limit: 5 });
    expect(entries.length).toBe(1);
    expect(store.listUserMemories).toHaveBeenCalledOnce();
  });

  test('uses sqljs provider for create/update/delete and turn updates', async () => {
    const store = buildStoreMock();
    const router = new MemoryProviderRouter(store);

    await router.createUserMemory({ text: 'Remember this' });
    await router.updateUserMemory({ id: 'm1', text: 'Updated' });
    await router.deleteUserMemory('m1');
    await router.applyTurnMemoryUpdates({
      sessionId: 's1',
      userText: '记住我喜欢 TypeScript',
      assistantText: '好的',
      implicitEnabled: true,
      memoryLlmJudgeEnabled: false,
      guardLevel: 'strict',
    });

    expect(store.createUserMemory).toHaveBeenCalledOnce();
    expect(store.updateUserMemory).toHaveBeenCalledOnce();
    expect(store.deleteUserMemory).toHaveBeenCalledOnce();
    expect(store.applyTurnMemoryUpdates).toHaveBeenCalledOnce();
  });
});
