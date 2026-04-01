import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { WeixinGatewayError, WeixinGatewayErrorCode } from './channels/weixin';
import { IMGatewayManager } from './imGatewayManager';
import { IMGatewayProviderId } from './imGatewayProviderRouter';
import {
  WeixinContextTokenStatus,
  WeixinPendingOutboundStatus,
} from './types';

let SQL: SqlJsStatic;
const managers: IMGatewayManager[] = [];

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
});

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

function createManager(): { manager: IMGatewayManager; db: Database } {
  const db = new SQL.Database();
  const manager = new IMGatewayManager(db, () => {}, {
    getCoworkAgentEngine: () => IMGatewayProviderId.YdCowork,
  });
  manager.setConfig({
    weixin: {
      enabled: true,
      accountId: 'wx-account',
    },
  });
  managers.push(manager);
  return { manager, db };
}

describe('IMGatewayManager Weixin context token lifecycle', () => {
  test('queues outbound reply when context token is missing', async () => {
    const { manager } = createManager();
    const weixinGateway = (manager as any).weixinGateway;
    vi.spyOn(weixinGateway, 'sendConversationNotification').mockRejectedValue(
      new WeixinGatewayError(
        WeixinGatewayErrorCode.MissingContextToken,
        'missing context token',
      ),
    );

    const sent = await manager.sendConversationReply('weixin', 'user-1', 'hello');
    expect(sent).toBe(true);

    const pending = manager
      .getIMStore()
      .listWeixinPendingOutbound('wx-account', 'user-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe(WeixinPendingOutboundStatus.Pending);
    expect(pending[0]?.text).toBe('hello');
  });

  test('flushes queued outbound after context token event', async () => {
    const { manager } = createManager();
    const store = manager.getIMStore();
    const weixinGateway = (manager as any).weixinGateway;
    const sendSpy = vi
      .spyOn(weixinGateway, 'sendConversationNotification')
      .mockRejectedValueOnce(
        new WeixinGatewayError(
          WeixinGatewayErrorCode.MissingContextToken,
          'missing context token',
        ),
      )
      .mockResolvedValue(undefined);

    const queued = await manager.sendConversationReply('weixin', 'user-2', 'queued message');
    expect(queued).toBe(true);
    expect(store.listWeixinPendingOutbound('wx-account', 'user-2')).toHaveLength(1);

    weixinGateway.emit('contextToken', {
      accountId: 'wx-account',
      conversationId: 'user-2',
      contextToken: 'ctx-2',
      updatedAt: Date.now(),
    });

    await vi.waitFor(() => {
      expect(store.listWeixinPendingOutbound('wx-account', 'user-2')).toHaveLength(0);
    });

    const token = store.getWeixinContextToken('wx-account', 'user-2');
    expect(token).not.toBeNull();
    expect(token?.status).toBe(WeixinContextTokenStatus.Active);
    expect(token?.lastSuccessAt).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  test('keeps identical queued outbound deliveries as separate records', async () => {
    const { manager } = createManager();
    const store = manager.getIMStore();
    const weixinGateway = (manager as any).weixinGateway;
    vi.spyOn(weixinGateway, 'sendConversationNotification').mockRejectedValue(
      new WeixinGatewayError(
        WeixinGatewayErrorCode.MissingContextToken,
        'missing context token',
      ),
    );

    const first = await manager.sendConversationReply('weixin', 'user-3', 'same text');
    const second = await manager.sendConversationReply('weixin', 'user-3', 'same text');
    expect(first).toBe(true);
    expect(second).toBe(true);

    const pending = store.listWeixinPendingOutbound('wx-account', 'user-3');
    expect(pending).toHaveLength(2);
    expect(pending.every((item) => item.text === 'same text')).toBe(true);
    expect(pending.every((item) => item.status === WeixinPendingOutboundStatus.Pending)).toBe(true);
  });
});
