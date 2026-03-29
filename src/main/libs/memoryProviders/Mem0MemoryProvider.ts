import crypto from 'crypto';
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

const Mem0IdentifierKey = {
  User: 'user_id',
  Agent: 'agent_id',
} as const;

type Mem0IdentifierKey = typeof Mem0IdentifierKey[keyof typeof Mem0IdentifierKey];

type Mem0Identifier = {
  key: Mem0IdentifierKey;
  value: string;
};

class Mem0HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'Mem0HttpError';
    this.status = status;
  }
}

const resolveMem0Identifier = (
  strategy: Mem0UserIdStrategyType,
  context?: MemoryProviderContext,
): Mem0Identifier => {
  if (strategy === Mem0UserIdStrategy.Agent) {
    const agentId = (context?.agentId || 'main').trim() || 'main';
    return { key: Mem0IdentifierKey.Agent, value: agentId };
  }
  if (strategy === Mem0UserIdStrategy.Workspace) {
    const workspace = (context?.workingDirectory || 'default-workspace').trim() || 'default-workspace';
    const workspaceHash = crypto.createHash('sha1').update(workspace).digest('hex').slice(0, 16);
    return { key: Mem0IdentifierKey.User, value: `workspace:${workspaceHash}` };
  }
  return { key: Mem0IdentifierKey.User, value: 'lobsterai-global' };
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

  buildIdentifier(context?: MemoryProviderContext): Mem0Identifier {
    const config = this.getConfig();
    return resolveMem0Identifier(config.mem0UserIdStrategy, context);
  }

  private getBaseUrl(): string {
    const baseUrl = this.getConfig().mem0BaseUrl.trim();
    if (!baseUrl) {
      throw new Error('mem0 base URL is empty');
    }
    return baseUrl;
  }

  private buildRequestHeaders(): Record<string, string> {
    const config = this.getConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = config.mem0ApiKey.trim();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers.Authorization = `Token ${apiKey}`;
    }
    return headers;
  }

  private buildUrl(pathname: string, query?: Record<string, string | undefined>): string {
    const base = this.getBaseUrl();
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const url = new URL(pathname.replace(/^\//, ''), normalizedBase);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (!value) continue;
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathname: string,
    options: {
      query?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const config = this.getConfig();
    const timeoutMs = config.mem0TimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.buildUrl(pathname, options.query), {
        method,
        headers: this.buildRequestHeaders(),
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        const preview = raw.slice(0, 300);
        throw new Mem0HttpError(response.status, `mem0 request failed (${response.status}): ${preview}`);
      }
      if (!raw.trim()) {
        return undefined as T;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      if (error instanceof Mem0HttpError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`mem0 request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractMemories(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
    if (payload && typeof payload === 'object') {
      const candidate = payload as Record<string, unknown>;
      const keys = ['results', 'items', 'memories', 'data'];
      for (const key of keys) {
        if (!Array.isArray(candidate[key])) continue;
        return (candidate[key] as unknown[])
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
      }
    }
    return [];
  }

  private mapRemoteMemoryToCowork(entry: Record<string, unknown>): CoworkUserMemory | null {
    const id = String(entry.id ?? entry.memory_id ?? '').trim();
    if (!id) return null;
    const textRaw = entry.memory ?? entry.text ?? entry.content ?? '';
    const text = typeof textRaw === 'string' ? textRaw.trim() : '';
    const now = Date.now();
    return {
      id,
      text,
      confidence: 0.8,
      isExplicit: true,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
  }

  private extractMemoryId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const data = payload as Record<string, unknown>;
    const direct = String(data.id ?? data.memory_id ?? '').trim();
    if (direct) return direct;

    const arrays = ['results', 'items', 'memories', 'data'];
    for (const key of arrays) {
      if (!Array.isArray(data[key])) continue;
      for (const item of data[key] as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const id = String(
          (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).memory_id ?? '',
        ).trim();
        if (id) return id;
      }
    }
    return null;
  }

  private async listRemoteMemories(context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    const identifier = this.buildIdentifier(context);
    const payload = await this.request<unknown>('GET', '/memories', {
      query: {
        [identifier.key]: identifier.value,
      },
    });
    const items = this.extractMemories(payload);
    return items
      .map((item) => this.mapRemoteMemoryToCowork(item))
      .filter((item): item is CoworkUserMemory => Boolean(item));
  }

  async addRemoteMemory(memory: CoworkUserMemory, context?: MemoryProviderContext): Promise<string | null> {
    const identifier = this.buildIdentifier(context);
    const payload = await this.request<unknown>('POST', '/memories', {
      body: {
        messages: [{ role: 'user', content: memory.text }],
        [identifier.key]: identifier.value,
        metadata: {
          source: 'lobsterai',
          local_memory_id: memory.id,
        },
      },
    });
    return this.extractMemoryId(payload);
  }

  async updateRemoteMemory(remoteId: string, text: string): Promise<void> {
    await this.request('PUT', `/memories/${encodeURIComponent(remoteId)}`, {
      body: {
        memory: text,
        text,
      },
    });
  }

  async deleteRemoteMemory(remoteId: string): Promise<void> {
    await this.request('DELETE', `/memories/${encodeURIComponent(remoteId)}`);
  }

  isNotFoundError(error: unknown): boolean {
    return error instanceof Mem0HttpError && error.status === 404;
  }

  async listUserMemories(options: MemoryListOptions, context?: MemoryProviderContext): Promise<CoworkUserMemory[]> {
    const query = (options.query || '').trim();
    if (query) {
      const identifier = this.buildIdentifier(context);
      const payload = await this.request<unknown>('POST', '/search', {
        body: {
          query,
          [identifier.key]: identifier.value,
          limit: options.limit,
        },
      });
      const items = this.extractMemories(payload);
      return items
        .map((item) => this.mapRemoteMemoryToCowork(item))
        .filter((item): item is CoworkUserMemory => Boolean(item));
    }
    return this.listRemoteMemories(context);
  }

  async createUserMemory(input: MemoryCreateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory> {
    const memory: CoworkUserMemory = {
      id: crypto.randomUUID(),
      text: input.text,
      confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 0.8,
      isExplicit: input.isExplicit ?? true,
      status: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: null,
    };
    await this.addRemoteMemory(memory, context);
    return memory;
  }

  async updateUserMemory(input: MemoryUpdateInput, context?: MemoryProviderContext): Promise<CoworkUserMemory | null> {
    if (!input.id.trim()) return null;
    if (input.status === 'deleted') {
      await this.deleteUserMemory(input.id, context);
      return null;
    }
    if (typeof input.text !== 'string' || !input.text.trim()) {
      return null;
    }
    await this.updateRemoteMemory(input.id, input.text);
    return {
      id: input.id,
      text: input.text,
      confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 0.8,
      isExplicit: input.isExplicit ?? true,
      status: input.status ?? 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: null,
    };
  }

  async deleteUserMemory(id: string, _context?: MemoryProviderContext): Promise<boolean> {
    if (!id.trim()) return false;
    await this.deleteRemoteMemory(id);
    return true;
  }

  async applyTurnMemoryUpdates(
    _options: ApplyTurnMemoryUpdatesOptions,
    _context?: MemoryProviderContext,
  ): Promise<ApplyTurnMemoryUpdatesResult> {
    throw new Error('mem0 applyTurnMemoryUpdates is not supported directly');
  }
}
