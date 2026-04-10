import { describe, expect, test } from 'vitest';
import { IMSessionRouter } from './sessionRouter';
import { GatewayRoute } from './constants';
import type { IMPlatform, IMSessionMapping, IMSessionRoute } from '../types';

class StoreStub {
  public route: IMSessionRoute | null = null;
  public mapping: IMSessionMapping | null = null;
  public upserts: Array<Partial<IMSessionRoute>> = [];
  public touched: Array<{ routeKey: string; eventId: string | null }> = [];
  public deletedRouteKeys: string[] = [];
  public deletedSessionIds: string[] = [];

  findSessionRoute() {
    return this.route;
  }

  getSessionMapping() {
    return this.mapping;
  }

  upsertSessionRoute(route: any): IMSessionRoute {
    this.upserts.push(route);
    this.route = {
      routeKey: route.routeKey,
      platform: route.platform,
      conversationId: route.conversationId,
      threadId: route.threadId ?? null,
      agentId: route.agentId,
      provider: route.provider,
      coworkSessionId: route.coworkSessionId,
      lastEventId: route.lastEventId ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return this.route;
  }

  updateSessionRouteLastEvent(routeKey: string, eventId: string | null) {
    this.touched.push({ routeKey, eventId });
  }

  deleteSessionRoute(routeKey: string) {
    this.deletedRouteKeys.push(routeKey);
  }

  deleteSessionRoutesByCoworkSessionId(coworkSessionId: string) {
    this.deletedSessionIds.push(coworkSessionId);
  }
}

describe('IMSessionRouter', () => {
  test('builds route key with no-thread token', () => {
    const store = new StoreStub();
    const router = new IMSessionRouter(store as any);

    const routeKey = router.buildRouteKey({
      platform: 'nim',
      conversationId: 'conv-1',
      agentId: 'main',
    });

    expect(routeKey).toBe(`nim:conv-1:${GatewayRoute.NoThread}:main`);
  });

  test('resolves existing route without fallback write', () => {
    const store = new StoreStub();
    store.route = {
      routeKey: 'nim:conv-1:_:main',
      platform: 'nim',
      conversationId: 'conv-1',
      threadId: null,
      agentId: 'main',
      provider: 'yd_cowork',
      coworkSessionId: 'sess-1',
      lastEventId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const router = new IMSessionRouter(store as any);
    const resolved = router.resolveRoute({
      platform: 'nim',
      conversationId: 'conv-1',
      provider: 'yd_cowork',
    });

    expect(resolved?.coworkSessionId).toBe('sess-1');
    expect(store.upserts.length).toBe(0);
  });

  test('backfills route from legacy mapping when missing', () => {
    const store = new StoreStub();
    store.mapping = {
      imConversationId: 'conv-1',
      platform: 'nim' as IMPlatform,
      coworkSessionId: 'sess-legacy',
      agentId: 'main',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    const router = new IMSessionRouter(store as any);
    const resolved = router.resolveRoute({
      platform: 'nim',
      conversationId: 'conv-1',
      provider: 'openclaw',
      agentId: 'main',
    });

    expect(resolved?.coworkSessionId).toBe('sess-legacy');
    expect(store.upserts.length).toBe(1);
    expect(store.upserts[0].provider).toBe('openclaw');
  });

  test('does not backfill route when legacy mapping agent differs', () => {
    const store = new StoreStub();
    store.mapping = {
      imConversationId: 'conv-1',
      platform: 'nim' as IMPlatform,
      coworkSessionId: 'sess-legacy',
      agentId: 'agent-1',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    const router = new IMSessionRouter(store as any);
    const resolved = router.resolveRoute({
      platform: 'nim',
      conversationId: 'conv-1',
      provider: 'openclaw',
      agentId: 'main',
    });

    expect(resolved).toBeNull();
    expect(store.upserts.length).toBe(0);
  });

  test('touch and delete delegate to store', () => {
    const store = new StoreStub();
    const router = new IMSessionRouter(store as any);

    router.touchRoute('rk-1', 'evt-1');
    router.removeRoute('rk-1');
    router.removeRoutesBySession('sess-1');

    expect(store.touched).toEqual([{ routeKey: 'rk-1', eventId: 'evt-1' }]);
    expect(store.deletedRouteKeys).toEqual(['rk-1']);
    expect(store.deletedSessionIds).toEqual(['sess-1']);
  });
});
