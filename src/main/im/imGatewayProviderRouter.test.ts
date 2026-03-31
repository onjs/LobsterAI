import { describe, expect, test } from 'vitest';
import {
  IMGatewayProviderId,
  IMGatewayProviderSource,
  resolveIMGatewayProvider,
} from './imGatewayProviderRouter';

describe('imGatewayProviderRouter', () => {
  test('prefers env engine over configured engine', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: IMGatewayProviderId.OpenClaw,
      configuredEngine: IMGatewayProviderId.YdCowork,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.Env,
    });
  });

  test('uses configured engine when env is invalid', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: 'not-supported',
      configuredEngine: IMGatewayProviderId.OpenClaw,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.Config,
    });
  });

  test('maps yd_local alias to yd_cowork', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: 'yd_local',
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.Env,
    });
  });

  test('falls back to default when both env and config are missing', () => {
    const resolved = resolveIMGatewayProvider();

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.Default,
    });
  });
});
