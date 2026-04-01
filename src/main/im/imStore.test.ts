import * as fs from 'node:fs';
import * as path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { GatewayRoute, GatewayRunStatus } from './gateway/constants';
import { IMStore } from './imStore';
import {
  WeixinContextTokenStatus,
  WeixinPendingOutboundReason,
  WeixinPendingOutboundStatus,
} from './types';

let SQL: SqlJsStatic;

const createStore = (): { store: IMStore } => {
  const db = new SQL.Database() as unknown as Database;
  const saveDb = vi.fn();
  return {
    store: new IMStore(db, saveDb),
  };
};

const buildRouteKey = (platform: string, conversationId: string, agentId: string): string => (
  [platform, conversationId, GatewayRoute.NoThread, agentId].join(GatewayRoute.KeySeparator)
);

beforeAll(async () => {
  const wasmPath = path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  SQL = await initSqlJs({ wasmBinary });
});

describe('imStore', () => {
  test('repairs session routes from legacy mappings', () => {
    const { store } = createStore();
    store.createSessionMapping('conv-1', 'nim', 'session-1', 'main');

    const repairedCount = store.repairSessionRoutesFromLegacyMappings('yd_cowork');
    expect(repairedCount).toBe(1);

    const route = store.findSessionRoute({
      platform: 'nim',
      conversationId: 'conv-1',
      threadId: null,
      agentId: 'main',
    });
    expect(route).not.toBeNull();
    expect(route?.provider).toBe('yd_cowork');
    expect(route?.coworkSessionId).toBe('session-1');
  });

  test('repairs stale route provider and session target from legacy mappings', () => {
    const { store } = createStore();
    store.createSessionMapping('conv-2', 'nim', 'session-old', 'main');
    store.repairSessionRoutesFromLegacyMappings('openclaw');
    store.updateSessionMappingTarget('conv-2', 'nim', 'session-new', 'main');

    const repairedCount = store.repairSessionRoutesFromLegacyMappings('yd_cowork');
    expect(repairedCount).toBe(1);

    const route = store.findSessionRoute({
      platform: 'nim',
      conversationId: 'conv-2',
      threadId: null,
      agentId: 'main',
    });
    expect(route).not.toBeNull();
    expect(route?.provider).toBe('yd_cowork');
    expect(route?.coworkSessionId).toBe('session-new');
  });

  test('lists recoverable runs and resolves conversation via route or legacy mapping', () => {
    const { store } = createStore();
    store.createSessionMapping('conv-3', 'nim', 'session-3', 'main');
    store.repairSessionRoutesFromLegacyMappings('yd_cowork');
    const routeKey = buildRouteKey('nim', 'conv-3', 'main');

    store.createGatewayRun({
      runId: 'run-queued',
      provider: 'yd_cowork',
      platform: 'nim',
      routeKey,
      inboundEventId: 'evt-1',
      coworkSessionId: 'session-3',
      status: GatewayRunStatus.Queued,
    });
    store.createGatewayRun({
      runId: 'run-running',
      provider: 'yd_cowork',
      platform: 'nim',
      routeKey,
      inboundEventId: 'evt-2',
      coworkSessionId: 'session-3',
      status: GatewayRunStatus.Running,
    });
    store.createGatewayRun({
      runId: 'run-done',
      provider: 'yd_cowork',
      platform: 'nim',
      routeKey,
      inboundEventId: 'evt-3',
      coworkSessionId: 'session-3',
      status: GatewayRunStatus.Running,
    });
    store.updateGatewayRun({
      runId: 'run-done',
      status: GatewayRunStatus.Completed,
      finishedAt: Date.now(),
    });
    store.createGatewayRun({
      runId: 'run-fallback',
      provider: 'yd_cowork',
      platform: 'nim',
      routeKey: 'nim:missing:_:main',
      inboundEventId: 'evt-4',
      coworkSessionId: 'session-3',
      status: GatewayRunStatus.Running,
    });

    const recoverable = store.listRecoverableGatewayRuns({ limit: 10 });
    expect(recoverable.map((item) => item.runId).sort()).toEqual(
      ['run-fallback', 'run-queued', 'run-running'],
    );
    const fallbackRun = recoverable.find((item) => item.runId === 'run-fallback');
    expect(fallbackRun?.conversationId).toBe('conv-3');
  });

  test('stores and retrieves weixin credential by account id', () => {
    const { store } = createStore();
    const saved = store.setWeixinCredential(' account-1 ', {
      token: ' token-1 ',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      userId: ' user-1 ',
    });

    expect(saved.accountId).toBe('account-1');
    expect(saved.token).toBe('token-1');
    expect(saved.baseUrl).toBe('https://ilinkai.weixin.qq.com');
    expect(saved.userId).toBe('user-1');

    const loaded = store.getWeixinCredential('account-1');
    expect(loaded).toEqual(saved);
  });

  test('treats weixin account id as configured channel', () => {
    const { store } = createStore();
    expect(store.isConfigured()).toBe(false);

    store.setWeixinConfig({ enabled: true, accountId: 'wx-account' });
    expect(store.isConfigured()).toBe(true);
  });

  test('stores weixin context token and marks stale/success lifecycle', () => {
    const { store } = createStore();
    const active = store.upsertWeixinContextToken({
      accountId: 'wx-account',
      conversationId: 'user-1',
      contextToken: 'ctx-token-1',
    });
    expect(active).not.toBeNull();
    expect(active?.status).toBe(WeixinContextTokenStatus.Active);

    const stale = store.markWeixinContextTokenStale({
      accountId: 'wx-account',
      conversationId: 'user-1',
      errorMessage: 'expired',
    });
    expect(stale).not.toBeNull();
    expect(stale?.status).toBe(WeixinContextTokenStatus.Stale);
    expect(stale?.lastErrorMessage).toBe('expired');

    store.markWeixinContextTokenSendSuccess('wx-account', 'user-1');
    const recovered = store.getWeixinContextToken('wx-account', 'user-1');
    expect(recovered?.status).toBe(WeixinContextTokenStatus.Active);
    expect(recovered?.lastSuccessAt).not.toBeNull();
  });

  test('queues and flushes weixin pending outbound records', () => {
    const { store } = createStore();
    const now = Date.now();
    const queued = store.enqueueWeixinPendingOutbound({
      id: 'wxq-1',
      accountId: 'wx-account',
      conversationId: 'user-1',
      text: 'hello',
      reason: WeixinPendingOutboundReason.MissingContextToken,
      expireAt: now + 60_000,
    });
    expect(queued).not.toBeNull();
    expect(queued?.status).toBe(WeixinPendingOutboundStatus.Pending);

    const listed = store.listWeixinPendingOutbound('wx-account', 'user-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('wxq-1');

    store.markWeixinPendingOutboundSent('wxq-1');
    const listedAfterSent = store.listWeixinPendingOutbound('wx-account', 'user-1');
    expect(listedAfterSent).toHaveLength(0);

    store.enqueueWeixinPendingOutbound({
      id: 'wxq-2',
      accountId: 'wx-account',
      conversationId: 'user-1',
      text: 'expired',
      reason: WeixinPendingOutboundReason.SessionExpired,
      expireAt: now - 1_000,
    });
    const expiredCount = store.expireWeixinPendingOutbound(now);
    expect(expiredCount).toBe(1);
  });
});
