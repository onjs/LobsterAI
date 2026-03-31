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
  BuildProfile: 'build_profile',
  Default: 'default',
} as const;

export type IMGatewayProviderSource = typeof IMGatewayProviderSource[keyof typeof IMGatewayProviderSource];

export const IMGatewayProviderEnvKey = {
  GatewayProvider: 'IM_GATEWAY_PROVIDER',
  GatewayProviderPrefixed: 'LOBSTERAI_IM_GATEWAY_PROVIDER',
  CoworkAgentEngine: 'COWORK_AGENT_ENGINE',
  CoworkAgentEnginePrefixed: 'LOBSTERAI_COWORK_AGENT_ENGINE',
  BuildProfile: 'IM_GATEWAY_BUILD_PROFILE',
  BuildProfilePrefixed: 'LOBSTERAI_IM_GATEWAY_BUILD_PROFILE',
} as const;

export const IMGatewayBuildProfile = {
  Full: 'full',
  YdOnly: 'yd-only',
  OpenClawOnly: 'openclaw-only',
} as const;

export type IMGatewayBuildProfile = typeof IMGatewayBuildProfile[keyof typeof IMGatewayBuildProfile];

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

const normalizeBuildProfile = (raw?: string | null): IMGatewayBuildProfile | undefined => {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === IMGatewayBuildProfile.Full) {
    return IMGatewayBuildProfile.Full;
  }
  if (normalized === IMGatewayBuildProfile.YdOnly) {
    return IMGatewayBuildProfile.YdOnly;
  }
  if (normalized === IMGatewayBuildProfile.OpenClawOnly) {
    return IMGatewayBuildProfile.OpenClawOnly;
  }
  return undefined;
};

export const resolveIMGatewayBuildProfile = (options?: {
  envBuildProfile?: string | null;
  defaultBuildProfile?: IMGatewayBuildProfile;
}): IMGatewayBuildProfile => (
  normalizeBuildProfile(options?.envBuildProfile)
  ?? options?.defaultBuildProfile
  ?? IMGatewayBuildProfile.Full
);

const forceProviderByBuildProfile = (
  providerId: IMGatewayProviderId,
  buildProfile: IMGatewayBuildProfile,
): IMGatewayProviderId => {
  if (buildProfile === IMGatewayBuildProfile.OpenClawOnly) {
    return IMGatewayProviderId.OpenClaw;
  }
  if (buildProfile === IMGatewayBuildProfile.YdOnly) {
    return IMGatewayProviderId.YdCowork;
  }
  return providerId;
};

export const resolveIMGatewayProvider = (options?: {
  envProvider?: string | null;
  envEngine?: string | null;
  configuredEngine?: CoworkAgentEngine | null;
  envBuildProfile?: string | null;
  defaultBuildProfile?: IMGatewayBuildProfile;
  defaultProvider?: IMGatewayProviderId;
}): { providerId: IMGatewayProviderId; source: IMGatewayProviderSource } => {
  const defaultProvider = options?.defaultProvider ?? IMGatewayProviderId.YdCowork;
  const buildProfile = resolveIMGatewayBuildProfile({
    envBuildProfile: options?.envBuildProfile,
    defaultBuildProfile: options?.defaultBuildProfile,
  });

  const withBuildProfile = (
    providerId: IMGatewayProviderId,
    source: IMGatewayProviderSource,
  ): { providerId: IMGatewayProviderId; source: IMGatewayProviderSource } => {
    const forcedProviderId = forceProviderByBuildProfile(providerId, buildProfile);
    if (forcedProviderId !== providerId) {
      return {
        providerId: forcedProviderId,
        source: IMGatewayProviderSource.BuildProfile,
      };
    }
    return { providerId, source };
  };

  const envProvider = normalizeProviderInstruction(options?.envProvider);
  if (envProvider && envProvider !== IMGatewayProviderAlias.Auto) {
    return withBuildProfile(
      envProvider,
      IMGatewayProviderSource.Env,
    );
  }

  const envEngineProvider = normalizeProviderInstruction(options?.envEngine);
  if (envEngineProvider && envEngineProvider !== IMGatewayProviderAlias.Auto) {
    return withBuildProfile(
      envEngineProvider,
      IMGatewayProviderSource.Env,
    );
  }

  const configProvider = normalizeProviderId(options?.configuredEngine);
  if (configProvider) {
    return withBuildProfile(
      configProvider,
      IMGatewayProviderSource.Config,
    );
  }

  return withBuildProfile(
    defaultProvider,
    IMGatewayProviderSource.Default,
  );
};
