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

  test('yd_cowork provider skips auto-start but keeps manual compatibility fallback', async () => {
    const provider = createIMGatewayProvider(IMGatewayProviderId.YdCowork);
    const syncOpenClawConfig = vi.fn(async () => undefined);
    const ensureOpenClawGatewayConnected = vi.fn(async () => undefined);

    expect(provider.shouldAutoStartManagedPlatforms()).toBe(false);

    const autoStarted = await provider.startAllManagedPlatforms(['feishu'], {
      syncOpenClawConfig,
      ensureOpenClawGatewayConnected,
    });
    expect(autoStarted).toBe(false);
    expect(syncOpenClawConfig).not.toHaveBeenCalled();

    const handled = await provider.startManagedPlatform('feishu', {
      syncOpenClawConfig,
      ensureOpenClawGatewayConnected,
    });
    expect(handled).toBe(true);
    expect(syncOpenClawConfig).toHaveBeenCalledOnce();
    expect(ensureOpenClawGatewayConnected).toHaveBeenCalledOnce();
  });
});
