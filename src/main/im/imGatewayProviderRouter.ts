import type { CoworkAgentEngine } from '../libs/agentEngine';

export const IMGatewayProviderId = {
  OpenClaw: 'openclaw',
  YdCowork: 'yd_cowork',
} as const;

export type IMGatewayProviderId = typeof IMGatewayProviderId[keyof typeof IMGatewayProviderId];

export const IMGatewayProviderAlias = {
  YdLocal: 'yd_local',
} as const;

export const IMGatewayProviderSource = {
  Env: 'env',
  Config: 'cowork_config',
  Default: 'default',
} as const;

export type IMGatewayProviderSource = typeof IMGatewayProviderSource[keyof typeof IMGatewayProviderSource];

export const IMGatewayProviderEnvKey = {
  CoworkAgentEngine: 'COWORK_AGENT_ENGINE',
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

export const resolveIMGatewayProvider = (options?: {
  envEngine?: string | null;
  configuredEngine?: CoworkAgentEngine | null;
  defaultProvider?: IMGatewayProviderId;
}): { providerId: IMGatewayProviderId; source: IMGatewayProviderSource } => {
  const defaultProvider = options?.defaultProvider ?? IMGatewayProviderId.YdCowork;

  const envProvider = normalizeProviderId(options?.envEngine);
  if (envProvider) {
    return {
      providerId: envProvider,
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
