import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CoworkConfig, CoworkStore } from '../../coworkStore';
import { MemoryProviderRouter } from './MemoryProviderRouter';

const buildConfig = (overrides: Partial<CoworkConfig> = {}): CoworkConfig => ({
  workingDirectory: '/tmp/project',
  systemPrompt: '',
  executionMode: 'local',
  agentEngine: 'yd_cowork',
  memoryEnabled: true,
  memoryImplicitUpdateEnabled: true,
  memoryLlmJudgeEnabled: false,
  memoryGuardLevel: 'strict',
  memoryUserMemoriesMaxItems: 12,
  vectorMemoryEnabled: false,
  vectorMemoryProvider: 'sqljs',
  mem0BaseUrl: '',
  mem0ApiKey: '',
  mem0OrgId: '',
  mem0ProjectId: '',
  mem0UserIdStrategy: 'workspace',
  mem0TimeoutMs: 2500,
  mem0TopK: 8,
  mem0MinScore: 0.45,
  vectorFallbackToSqljs: true,
  ...overrides,
});

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
  test('uses sqljs provider for memory list by default', async () => {
    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig(),
    });

    const entries = await router.listUserMemories({ limit: 5 });
    expect(entries.length).toBe(1);
    expect(store.listUserMemories).toHaveBeenCalledOnce();
  });

  test('falls back to sqljs when mem0 is selected but not configured', async () => {
    const warn = vi.fn();
    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig({
        vectorMemoryEnabled: true,
        vectorMemoryProvider: 'mem0',
        mem0BaseUrl: '',
      }),
      logger: { debug: vi.fn(), warn },
    });

    const created = await router.createUserMemory({ text: 'I like TypeScript.' });
    expect(created.id).toBe('m1');
    expect(store.createUserMemory).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  test('enqueues mem0 create sync and persists vector mapping when enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 'remote-memory-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig({
        vectorMemoryEnabled: true,
        vectorMemoryProvider: 'mem0',
        mem0BaseUrl: 'http://localhost:8888',
      }),
    });

    const created = await router.createUserMemory({ text: 'I like TypeScript.' }, { workingDirectory: '/tmp/project' });
    expect(created.id).toBe('m1');

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(store.upsertMemoryVectorRef).toHaveBeenCalledWith({
      memoryId: 'm1',
      provider: 'mem0',
      remoteId: 'remote-memory-1',
    });
  });

  test('uses mem0 semantic query and maps remote result back to local memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        results: [
          {
            id: 'remote-memory-1',
            memory: 'I prefer concise responses.',
            metadata: { local_memory_id: 'm1' },
            score: 0.93,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig({
        vectorMemoryEnabled: true,
        vectorMemoryProvider: 'mem0',
        mem0BaseUrl: 'http://localhost:8888',
      }),
    });

    const entries = await router.listUserMemories({
      query: 'concise',
      status: 'created',
      includeDeleted: false,
      limit: 5,
    }, { workingDirectory: '/tmp/project' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('m1');
    expect(store.listUserMemories).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('falls back to sqljs on mem0 search failure when fallback is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const warn = vi.fn();
    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig({
        vectorMemoryEnabled: true,
        vectorMemoryProvider: 'mem0',
        mem0BaseUrl: 'http://localhost:8888',
        vectorFallbackToSqljs: true,
      }),
      logger: { debug: vi.fn(), warn },
    });

    const entries = await router.listUserMemories({ query: 'typescript', limit: 5 });
    expect(entries).toHaveLength(1);
    expect(store.listUserMemories).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('throws on mem0 search failure when fallback is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = buildStoreMock();
    const router = new MemoryProviderRouter({
      store,
      getConfig: () => buildConfig({
        vectorMemoryEnabled: true,
        vectorMemoryProvider: 'mem0',
        mem0BaseUrl: 'http://localhost:8888',
        vectorFallbackToSqljs: false,
      }),
    });

    await expect(
      router.listUserMemories({ query: 'typescript', limit: 5 }),
    ).rejects.toThrow(/mem0 request failed/);
  });
});
