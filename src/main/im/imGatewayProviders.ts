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

    console.log(`[IMGatewayProvider] start managed platforms in batch: ${activePlatforms.join(', ')}`);
    await deps.syncOpenClawConfig?.();
    await deps.ensureOpenClawGatewayConnected?.();
    return true;
  }
}

class YdCoworkGatewayProvider implements IManagedGatewayProvider {
  readonly id = IMGatewayProviderId.YdCowork;

  constructor(private readonly openClawCompatibilityProvider: OpenClawGatewayProvider) {}

  supportsManagedPlatform(platform: IMPlatform): boolean {
    return this.openClawCompatibilityProvider.supportsManagedPlatform(platform);
  }

  shouldAutoStartManagedPlatforms(): boolean {
    return false;
  }

  async startManagedPlatform(
    platform: IMPlatform,
    deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    if (!this.supportsManagedPlatform(platform)) {
      return false;
    }

    console.log(
      `[IMGatewayProvider] yd_cowork compatibility fallback delegates ${platform} start to OpenClaw gateway`,
    );
    return this.openClawCompatibilityProvider.startManagedPlatform(platform, deps);
  }

  async stopManagedPlatform(
    platform: IMPlatform,
    deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    if (!this.supportsManagedPlatform(platform)) {
      return false;
    }

    console.log(
      `[IMGatewayProvider] yd_cowork compatibility fallback delegates ${platform} stop to OpenClaw gateway`,
    );
    return this.openClawCompatibilityProvider.stopManagedPlatform(platform, deps);
  }

  async startAllManagedPlatforms(
    platforms: IMPlatform[],
    _deps: IMGatewayProviderRuntimeDeps,
  ): Promise<boolean> {
    if (platforms.length === 0) {
      return false;
    }

    console.log(
      '[IMGatewayProvider] yd_cowork provider skips managed gateway auto-start until native IM provider is ready',
    );
    return false;
  }
}

export const createIMGatewayProvider = (
  providerId: GatewayProviderId,
): IManagedGatewayProvider => {
  const openClawProvider = new OpenClawGatewayProvider();
  if (providerId === IMGatewayProviderId.OpenClaw) {
    return openClawProvider;
  }
  return new YdCoworkGatewayProvider(openClawProvider);
};
