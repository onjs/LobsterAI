import { describe, expect, test, vi } from 'vitest';
import { createIMGatewayProvider } from './imGatewayProviders';
import { IMGatewayProviderId } from './imGatewayProviderRouter';

describe('imGatewayProviders', () => {
  test('openclaw provider auto-starts managed platforms', async () => {
    const provider = createIMGatewayProvider(IMGatewayProviderId.OpenClaw);
    const syncOpenClawConfig = vi.fn(async () => undefined);
    const ensureOpenClawGatewayConnected = vi.fn(async () => undefined);

    const handled = await provider.startManagedPlatform('feishu', {
      syncOpenClawConfig,
      ensureOpenClawGatewayConnected,
    });

    expect(provider.shouldAutoStartManagedPlatforms()).toBe(true);
    expect(handled).toBe(true);
    expect(syncOpenClawConfig).toHaveBeenCalledOnce();
    expect(ensureOpenClawGatewayConnected).toHaveBeenCalledOnce();
  });

  test('openclaw-only profile always resolves openclaw provider', async () => {
    const provider = createIMGatewayProvider(IMGatewayProviderId.YdCowork);
    const syncOpenClawConfig = vi.fn(async () => undefined);
    const ensureOpenClawGatewayConnected = vi.fn(async () => undefined);

    expect(provider.id).toBe(IMGatewayProviderId.OpenClaw);
    expect(provider.shouldAutoStartManagedPlatforms()).toBe(true);

    const autoStarted = await provider.startAllManagedPlatforms(['feishu'], {
      syncOpenClawConfig,
      ensureOpenClawGatewayConnected,
    });
    expect(autoStarted).toBe(true);
    expect(syncOpenClawConfig).toHaveBeenCalledOnce();
    expect(ensureOpenClawGatewayConnected).toHaveBeenCalledOnce();
  });

  test('openclaw provider respects integration gate', async () => {
    const provider = createIMGatewayProvider(IMGatewayProviderId.OpenClaw);
    const syncOpenClawConfig = vi.fn(async () => undefined);
    const ensureOpenClawGatewayConnected = vi.fn(async () => undefined);

    const handled = await provider.startManagedPlatform('feishu', {
      syncOpenClawConfig,
      ensureOpenClawGatewayConnected,
      isOpenClawIntegrationEnabled: () => false,
    });

    expect(handled).toBe(false);
    expect(syncOpenClawConfig).not.toHaveBeenCalled();
    expect(ensureOpenClawGatewayConnected).not.toHaveBeenCalled();
  });
});
