import { describe, expect, test } from 'vitest';
import {
  IMGatewayBuildProfile,
  IMGatewayProviderId,
  IMGatewayProviderSource,
  resolveIMGatewayBuildProfile,
  resolveIMGatewayProvider,
} from './imGatewayProviderRouter';

describe('imGatewayProviderRouter', () => {
  test('resolves build profile with full as default', () => {
    expect(resolveIMGatewayBuildProfile()).toBe(IMGatewayBuildProfile.Full);
    expect(resolveIMGatewayBuildProfile({ envBuildProfile: IMGatewayBuildProfile.YdOnly })).toBe(
      IMGatewayBuildProfile.YdOnly,
    );
    expect(resolveIMGatewayBuildProfile({ envBuildProfile: 'invalid' })).toBe(
      IMGatewayBuildProfile.Full,
    );
  });

  test('prefers explicit IM gateway provider env over env engine and configured engine', () => {
    const resolved = resolveIMGatewayProvider({
      envProvider: IMGatewayProviderId.YdCowork,
      envEngine: IMGatewayProviderId.OpenClaw,
      configuredEngine: IMGatewayProviderId.OpenClaw,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.Env,
    });
  });

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

  test('maps yd_local alias from explicit provider env', () => {
    const resolved = resolveIMGatewayProvider({
      envProvider: 'yd_local',
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.Env,
    });
  });

  test('treats explicit provider auto as deferred and keeps env engine priority', () => {
    const resolved = resolveIMGatewayProvider({
      envProvider: 'auto',
      envEngine: IMGatewayProviderId.OpenClaw,
      configuredEngine: IMGatewayProviderId.YdCowork,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.Env,
    });
  });

  test('treats env engine auto as deferred and falls back to configured engine', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: 'auto',
      configuredEngine: IMGatewayProviderId.OpenClaw,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.Config,
    });
  });

  test('falls back to default when both env and config are missing', () => {
    const resolved = resolveIMGatewayProvider();

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.Default,
    });
  });

  test('build profile openclaw-only forces provider to openclaw', () => {
    const resolved = resolveIMGatewayProvider({
      envProvider: IMGatewayProviderId.YdCowork,
      envBuildProfile: IMGatewayBuildProfile.OpenClawOnly,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.BuildProfile,
    });
  });

  test('build profile yd-only forces provider to yd_cowork', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: IMGatewayProviderId.OpenClaw,
      envBuildProfile: IMGatewayBuildProfile.YdOnly,
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.YdCowork,
      source: IMGatewayProviderSource.BuildProfile,
    });
  });

  test('invalid build profile does not affect provider decision', () => {
    const resolved = resolveIMGatewayProvider({
      envEngine: IMGatewayProviderId.OpenClaw,
      envBuildProfile: 'unknown-profile',
    });

    expect(resolved).toEqual({
      providerId: IMGatewayProviderId.OpenClaw,
      source: IMGatewayProviderSource.Env,
    });
  });
});
