import type { IMPlatform } from './types';

export const IMGatewayEventSchemaVersion = '1' as const;

export const InboundEventType = {
  Message: 'message',
  Command: 'command',
  System: 'system',
} as const;

export type InboundEventType = typeof InboundEventType[keyof typeof InboundEventType];

export const OutboundEventType = {
  Reply: 'reply',
  Attachment: 'attachment',
  Ack: 'ack',
} as const;

export type OutboundEventType = typeof OutboundEventType[keyof typeof OutboundEventType];

export const RunStateType = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Timeout: 'timeout',
} as const;

export type RunStateType = typeof RunStateType[keyof typeof RunStateType];

export interface InboundEvent {
  schemaVersion: typeof IMGatewayEventSchemaVersion;
  eventId: string;
  type: InboundEventType;
  platform: IMPlatform;
  conversationId: string;
  threadId?: string;
  senderId?: string;
  text?: string;
  payload?: Record<string, unknown>;
  receivedAt: number;
}

export interface OutboundEvent {
  schemaVersion: typeof IMGatewayEventSchemaVersion;
  runId: string;
  type: OutboundEventType;
  platform: IMPlatform;
  conversationId: string;
  threadId?: string;
  text?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export interface RunStateEvent {
  schemaVersion: typeof IMGatewayEventSchemaVersion;
  runId: string;
  state: RunStateType;
  provider: string;
  platform: IMPlatform;
  routeKey: string;
  startedAt?: number;
  finishedAt?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface IChannelAdapter {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: (event: OutboundEvent) => Promise<void>;
  health: () => Promise<{ healthy: boolean; details?: string }>;
  capabilities: () => Promise<Record<string, unknown>>;
  auth: () => Promise<{ ready: boolean; reason?: string }>;
}

export interface IEngineAdapter {
  startSession: (params: {
    routeKey: string;
    platform: IMPlatform;
    conversationId: string;
    threadId?: string;
    prompt: string;
  }) => Promise<{ sessionId: string; runId: string }>;
  continueSession: (params: {
    sessionId: string;
    prompt: string;
  }) => Promise<{ runId: string }>;
  stopSession: (sessionId: string) => Promise<void>;
  streamEvents: (runId: string, onEvent: (event: RunStateEvent | OutboundEvent) => void) => Promise<void>;
}

export interface IGatewayProvider {
  executeTurn: (event: InboundEvent) => Promise<{ runId: string }>;
  resumeTurn: (routeKey: string, event: InboundEvent) => Promise<{ runId: string }>;
  cancelTurn: (runId: string) => Promise<void>;
  syncConfig: () => Promise<void>;
}
