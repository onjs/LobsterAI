import crypto from 'crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CoworkConfig } from '../../coworkStore';
import { Mem0MemoryProvider } from './Mem0MemoryProvider';

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
  vectorMemoryEnabled: true,
  vectorMemoryProvider: 'mem0',
  mem0BaseUrl: 'http://localhost:8888',
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Mem0MemoryProvider', () => {
  test('addRemoteMemory returns remote id from nested response payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        results: [{ id: 'remote-123' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new Mem0MemoryProvider(() => buildConfig());
    const remoteId = await provider.addRemoteMemory(
      {
        id: 'local-1',
        text: 'I prefer concise replies.',
        confidence: 0.9,
        isExplicit: true,
        status: 'created',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
      },
      { workingDirectory: '/tmp/project-a' },
    );

    expect(remoteId).toBe('remote-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/memories');
    expect(options.method).toBe('POST');

    const body = JSON.parse(String(options.body));
    const expectedHash = crypto.createHash('sha1').update('/tmp/project-a').digest('hex').slice(0, 16);
    expect(body.user_id).toBe(`workspace:${expectedHash}`);
  });

  test('isNotFoundError returns true for 404 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new Mem0MemoryProvider(() => buildConfig());
    let caught: unknown;
    try {
      await provider.deleteRemoteMemory('missing-remote-id');
    } catch (error) {
      caught = error;
    }
    expect(provider.isNotFoundError(caught)).toBe(true);
  });
});
