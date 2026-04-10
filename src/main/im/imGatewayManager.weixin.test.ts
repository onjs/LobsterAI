import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { IMGatewayManager } from './imGatewayManager';
import { IMGatewayProviderId } from './imGatewayProviderRouter';

const managers: IMGatewayManager[] = [];

afterEach(async () => {
  while (managers.length > 0) {
    const manager = managers.pop();
    if (!manager) {
      continue;
    }
    await manager.stopAll();
  }
  vi.restoreAllMocks();
});

function createManager(): IMGatewayManager {
  const db = new BetterSqlite3(':memory:');
  const manager = new IMGatewayManager(db, {
    getCoworkAgentEngine: () => IMGatewayProviderId.OpenClaw,
  });
  manager.setConfig({
    weixin: {
      enabled: true,
      accountId: 'wx-account',
    },
  });
  managers.push(manager);
  return manager;
}

describe('IMGatewayManager Weixin behavior in openclaw-only profile', () => {
  test('always resolves openclaw provider', () => {
    const manager = createManager();
    expect(manager.getGatewayProviderId()).toBe(IMGatewayProviderId.OpenClaw);
  });

  test('direct weixin conversation reply is disabled and does not enqueue pending delivery', async () => {
    const manager = createManager();
    const sent = await manager.sendConversationReply('weixin', 'user-1', 'hello');
    expect(sent).toBe(false);
    const pending = manager.getIMStore().listWeixinPendingOutbound('wx-account', 'user-1');
    expect(pending).toHaveLength(0);
  });

  test('returns null when openclaw schema cannot be fetched', async () => {
    const manager = createManager();
    const schema = await manager.getOpenClawConfigSchema();
    expect(schema).toBeNull();
  });
});
