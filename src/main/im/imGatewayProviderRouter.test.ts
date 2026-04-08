import { describe, expect, test } from 'vitest';
import {
  IMGatewayBuildProfile,
  IMGatewayProviderId,
  IMGatewayProviderSource,
  resolveIMGatewayBuildProfile,
  resolveIMGatewayProvider,
} from './imGatewayProviderRouter';

describe('imGatewayProviderRouter', () => {
  test('always resolves build profile to openclaw-only', () => {
    expect(resolveIMGatewayBuildProfile()).toBe(IMGatewayBuildProfile.OpenClawOnly);
  });

  test('always resolves provider to openclaw with build-profile source', () => {
    const resolved = resolveIMGatewayProvider({
      configuredEngine: IMGatewayProviderId.OpenClaw,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.BuildProfile,
    });
  });
});
