export const VectorMemoryProvider = {
  Sqljs: 'sqljs',
  Mem0: 'mem0',
} as const;

export type VectorMemoryProvider = typeof VectorMemoryProvider[keyof typeof VectorMemoryProvider];

export const Mem0UserIdStrategy = {
  Global: 'global',
  Agent: 'agent',
  Workspace: 'workspace',
} as const;

export type Mem0UserIdStrategy = typeof Mem0UserIdStrategy[keyof typeof Mem0UserIdStrategy];

export const DEFAULT_VECTOR_MEMORY_ENABLED = false;
export const DEFAULT_VECTOR_MEMORY_PROVIDER: VectorMemoryProvider = VectorMemoryProvider.Sqljs;
export const DEFAULT_MEM0_BASE_URL = '';
export const DEFAULT_MEM0_API_KEY = '';
export const DEFAULT_MEM0_ORG_ID = '';
export const DEFAULT_MEM0_PROJECT_ID = '';
export const DEFAULT_MEM0_USER_ID_STRATEGY: Mem0UserIdStrategy = Mem0UserIdStrategy.Workspace;
export const DEFAULT_MEM0_TIMEOUT_MS = 2500;
export const DEFAULT_MEM0_TOP_K = 8;
export const DEFAULT_MEM0_MIN_SCORE = 0.45;
export const DEFAULT_VECTOR_FALLBACK_TO_SQLJS = true;

const MIN_MEM0_TIMEOUT_MS = 300;
const MAX_MEM0_TIMEOUT_MS = 30000;
const MIN_MEM0_TOP_K = 1;
const MAX_MEM0_TOP_K = 50;

export const normalizeVectorMemoryProvider = (value: string | undefined | null): VectorMemoryProvider => {
  if (value === VectorMemoryProvider.Mem0 || value === VectorMemoryProvider.Sqljs) {
    return value;
  }
  return DEFAULT_VECTOR_MEMORY_PROVIDER;
};

export const normalizeMem0UserIdStrategy = (value: string | undefined | null): Mem0UserIdStrategy => {
  if (
    value === Mem0UserIdStrategy.Global
    || value === Mem0UserIdStrategy.Agent
    || value === Mem0UserIdStrategy.Workspace
  ) {
    return value;
  }
  return DEFAULT_MEM0_USER_ID_STRATEGY;
};

export const clampMem0TimeoutMs = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MEM0_TIMEOUT_MS;
  return Math.max(MIN_MEM0_TIMEOUT_MS, Math.min(MAX_MEM0_TIMEOUT_MS, Math.floor(value)));
};

export const clampMem0TopK = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MEM0_TOP_K;
  return Math.max(MIN_MEM0_TOP_K, Math.min(MAX_MEM0_TOP_K, Math.floor(value)));
};

export const clampMem0MinScore = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MEM0_MIN_SCORE;
  return Math.max(0, Math.min(1, value));
};
