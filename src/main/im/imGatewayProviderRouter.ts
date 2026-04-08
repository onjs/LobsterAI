import type { CoworkAgentEngine } from '../libs/agentEngine';

export const IMGatewayProviderId = {
  OpenClaw: 'openclaw',
} as const;

export type IMGatewayProviderId = typeof IMGatewayProviderId[keyof typeof IMGatewayProviderId];

export const IMGatewayProviderAlias = {
  Auto: 'auto',
} as const;

export const IMGatewayProviderSource = {
  Env: 'env',
  Config: 'cowork_config',
  BuildProfile: 'build_profile',
  Default: 'default',
} as const;

export type IMGatewayProviderSource = typeof IMGatewayProviderSource[keyof typeof IMGatewayProviderSource];

export const IMGatewayBuildProfile = {
  OpenClawOnly: 'openclaw-only',
} as const;

export type IMGatewayBuildProfile = typeof IMGatewayBuildProfile[keyof typeof IMGatewayBuildProfile];

export const resolveIMGatewayBuildProfile = (): IMGatewayBuildProfile => IMGatewayBuildProfile.OpenClawOnly;

export const resolveIMGatewayProvider = (_options?: {
  configuredEngine?: CoworkAgentEngine | null;
}): { providerId: IMGatewayProviderId; source: IMGatewayProviderSource } => ({
  providerId: IMGatewayProviderId.OpenClaw,
  source: IMGatewayProviderSource.BuildProfile,
});
