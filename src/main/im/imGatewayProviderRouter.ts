import type { CoworkAgentEngine } from '../libs/agentEngine';

export const IMGatewayProviderId = {
  OpenClaw: 'openclaw',
  YdCowork: 'yd_cowork',
} as const;

export type IMGatewayProviderId = typeof IMGatewayProviderId[keyof typeof IMGatewayProviderId];

export const IMGatewayProviderAlias = {
  YdLocal: 'yd_local',
  Auto: 'auto',
} as const;

export const IMGatewayProviderSource = {
  Env: 'env',
  Config: 'cowork_config',
  Default: 'default',
} as const;

export type IMGatewayProviderSource = typeof IMGatewayProviderSource[keyof typeof IMGatewayProviderSource];

export const IMGatewayProviderEnvKey = {
  GatewayProvider: 'IM_GATEWAY_PROVIDER',
  GatewayProviderPrefixed: 'LOBSTERAI_IM_GATEWAY_PROVIDER',
  CoworkAgentEngine: 'COWORK_AGENT_ENGINE',
  CoworkAgentEnginePrefixed: 'LOBSTERAI_COWORK_AGENT_ENGINE',
} as const;

const normalizeProviderId = (raw?: string | null): IMGatewayProviderId | undefined => {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === IMGatewayProviderId.OpenClaw) {
    return IMGatewayProviderId.OpenClaw;
  }
  if (normalized === IMGatewayProviderId.YdCowork || normalized === IMGatewayProviderAlias.YdLocal) {
    return IMGatewayProviderId.YdCowork;
  }
  return undefined;
};

type ProviderInstruction = IMGatewayProviderId | typeof IMGatewayProviderAlias.Auto;

const normalizeProviderInstruction = (raw?: string | null): ProviderInstruction | undefined => {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === IMGatewayProviderAlias.Auto) {
    return IMGatewayProviderAlias.Auto;
  }
  return normalizeProviderId(normalized);
};

export const resolveIMGatewayProvider = (options?: {
  envProvider?: string | null;
  envEngine?: string | null;
  configuredEngine?: CoworkAgentEngine | null;
  defaultProvider?: IMGatewayProviderId;
}): { providerId: IMGatewayProviderId; source: IMGatewayProviderSource } => {
  const defaultProvider = options?.defaultProvider ?? IMGatewayProviderId.YdCowork;

  const envProvider = normalizeProviderInstruction(options?.envProvider);
  if (envProvider && envProvider !== IMGatewayProviderAlias.Auto) {
    return {
      providerId: envProvider,
      source: IMGatewayProviderSource.Env,
    };
  }

  const envEngineProvider = normalizeProviderInstruction(options?.envEngine);
  if (envEngineProvider && envEngineProvider !== IMGatewayProviderAlias.Auto) {
    return {
      providerId: envEngineProvider,
      source: IMGatewayProviderSource.Env,
    };
  }

  const configProvider = normalizeProviderId(options?.configuredEngine);
  if (configProvider) {
    return {
      providerId: configProvider,
      source: IMGatewayProviderSource.Config,
    };
  }

  return {
    providerId: defaultProvider,
    source: IMGatewayProviderSource.Default,
  };
};
