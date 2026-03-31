import type { IMStore } from '../imStore';
import type { IMPlatform, IMSessionRoute } from '../types';
import { GatewayRoute } from './constants';

export interface SessionRouteLookup {
  platform: IMPlatform;
  conversationId: string;
  threadId?: string | null;
  agentId?: string;
  provider: 'openclaw' | 'yd_cowork';
}

export interface SessionRouteBinding extends SessionRouteLookup {
  routeKey?: string;
  coworkSessionId: string;
  lastEventId?: string | null;
}

export class IMSessionRouter {
  constructor(private readonly store: IMStore) {}

  buildRouteKey(params: {
    platform: IMPlatform;
    conversationId: string;
    threadId?: string | null;
    agentId?: string;
  }): string {
    const threadToken = this.normalizeThreadToken(params.threadId);
    const agentId = this.normalizeAgentId(params.agentId);
    return [params.platform, params.conversationId, threadToken, agentId].join(GatewayRoute.KeySeparator);
  }

  resolveRoute(params: SessionRouteLookup): IMSessionRoute | null {
    const agentId = this.normalizeAgentId(params.agentId);
    const threadId = this.normalizeThreadId(params.threadId);

    const route = this.store.findSessionRoute({
      platform: params.platform,
      conversationId: params.conversationId,
      threadId,
      agentId,
    });
    if (route) {
      return route;
    }

    const legacyMapping = this.store.getSessionMapping(params.conversationId, params.platform);
    if (!legacyMapping) {
      return null;
    }

    return this.bindRoute({
      platform: params.platform,
      conversationId: params.conversationId,
      threadId,
      agentId,
      provider: params.provider,
      coworkSessionId: legacyMapping.coworkSessionId,
      lastEventId: null,
    });
  }

  bindRoute(params: SessionRouteBinding): IMSessionRoute {
    const agentId = this.normalizeAgentId(params.agentId);
    const threadId = this.normalizeThreadId(params.threadId);
    const routeKey = params.routeKey || this.buildRouteKey({
      platform: params.platform,
      conversationId: params.conversationId,
      threadId,
      agentId,
    });

    return this.store.upsertSessionRoute({
      routeKey,
      platform: params.platform,
      conversationId: params.conversationId,
      threadId,
      agentId,
      provider: params.provider,
      coworkSessionId: params.coworkSessionId,
      lastEventId: params.lastEventId,
    });
  }

  touchRoute(routeKey: string, eventId: string | null): void {
    this.store.updateSessionRouteLastEvent(routeKey, eventId);
  }

  removeRoute(routeKey: string): void {
    this.store.deleteSessionRoute(routeKey);
  }

  removeRoutesBySession(coworkSessionId: string): void {
    this.store.deleteSessionRoutesByCoworkSessionId(coworkSessionId);
  }

  private normalizeAgentId(agentId?: string | null): string {
    const normalized = agentId?.trim();
    return normalized || GatewayRoute.DefaultAgentId;
  }

  private normalizeThreadId(threadId?: string | null): string | null {
    const normalized = threadId?.trim();
    return normalized || null;
  }

  private normalizeThreadToken(threadId?: string | null): string {
    return this.normalizeThreadId(threadId) ?? GatewayRoute.NoThread;
  }
}
