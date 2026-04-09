import type { IMPlatform } from './types';
import {
  IMGatewayProviderId,
  type IMGatewayProviderId as GatewayProviderId,
} from './imGatewayProviderRouter';

export const OpenClawManagedPlatform = {
  DingTalk: 'dingtalk',
  Feishu: 'feishu',
  Telegram: 'telegram',
  Discord: 'discord',
  Qq: 'qq',
  Wecom: 'wecom',
  Weixin: 'weixin',
  Popo: 'popo',
  Nim: 'nim',
} as const;

const OPENCLAW_MANAGED_PLATFORMS = new Set<IMPlatform>([
  OpenClawManagedPlatform.DingTalk,
  OpenClawManagedPlatform.Feishu,
  OpenClawManagedPlatform.Telegram,
  OpenClawManagedPlatform.Discord,
  OpenClawManagedPlatform.Qq,
  OpenClawManagedPlatform.Wecom,
  OpenClawManagedPlatform.Weixin,
  OpenClawManagedPlatform.Popo,
  OpenClawManagedPlatform.Nim,
]);

export interface IMGatewayProviderRuntimeDeps {
  syncOpenClawConfig?: () => Promise<void>;
  ensureOpenClawGatewayConnected?: () => Promise<void>;
  isOpenClawIntegrationEnabled?: () => boolean;
}

export interface IManagedGatewayProvider {
  readonly id: GatewayProviderId;
  supportsManagedPlatform: (platform: IMPlatform) => boolean;
  shouldAutoStartManagedPlatforms: () => boolean;
  startManagedPlatform: (platform: IMPlatform, deps: IMGatewayProviderRuntimeDeps) => Promise<boolean>;
  stopManagedPlatform: (platform: IMPlatform, deps: IMGatewayProviderRuntimeDeps) => Promise<boolean>;
  startAllManagedPlatforms: (platforms: IMPlatform[], deps: IMGatewayProviderRuntimeDeps) => Promise<boolean>;
}

class OpenClawGatewayProvider implements IManagedGatewayProvider {
  readonly id = IMGatewayProviderId.OpenClaw;

  private canUseOpenClawIntegration(deps: IMGatewayProviderRuntimeDeps): boolean {
    return deps.isOpenClawIntegrationEnabled?.() ?? true;
  }

  supportsManagedPlatform(platform: IMPlatform): boolean {
    return OPENCLAW_MANAGED_PLATFORMS.has(platform);
  }

  shouldAutoStartManagedPlatforms(): boolean {
    return true;
  }

  async startManagedPlatform(
    platform: IMPlatform,
    deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    if (!this.supportsManagedPlatform(platform)) {
      return false;
    }
    if (!this.canUseOpenClawIntegration(deps)) {
      console.warn(`[IMGatewayProvider] skip ${platform} start because OpenClaw integration is disabled`);
      return false;
    }

    console.log(`[IMGatewayProvider] start managed platform ${platform} via OpenClaw sync`);
    await deps.syncOpenClawConfig?.();
    await deps.ensureOpenClawGatewayConnected?.();
    return true;
  }

  async stopManagedPlatform(
    platform: IMPlatform,
    deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    if (!this.supportsManagedPlatform(platform)) {
      return false;
    }
    if (!this.canUseOpenClawIntegration(deps)) {
      console.warn(`[IMGatewayProvider] skip ${platform} stop because OpenClaw integration is disabled`);
      return false;
    }

    console.log(`[IMGatewayProvider] stop managed platform ${platform} via OpenClaw sync`);
    await deps.syncOpenClawConfig?.();
    return true;
  }

  async startAllManagedPlatforms(
    platforms: IMPlatform[],
    deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    const activePlatforms = platforms.filter((platform) => this.supportsManagedPlatform(platform));
    if (activePlatforms.length === 0) {
      return false;
    }
    if (!this.canUseOpenClawIntegration(deps)) {
      console.warn(
        `[IMGatewayProvider] skip managed platform batch start because OpenClaw integration is disabled: ${activePlatforms.join(', ')}`,
      );
      return false;
    }

    console.log(`[IMGatewayProvider] start managed platforms in batch: ${activePlatforms.join(', ')}`);
    await deps.syncOpenClawConfig?.();
    await deps.ensureOpenClawGatewayConnected?.();
    return true;
  }
}

export const createIMGatewayProvider = (
  _providerId: GatewayProviderId,
): IManagedGatewayProvider => {
  return new OpenClawGatewayProvider();
};
