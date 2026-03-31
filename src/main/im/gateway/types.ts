import type { IMMessage, IMPlatform } from '../types';
import type { GatewayRunStatus } from './constants';

export interface GatewayInboundEnvelope {
  runId: string;
  eventId: string;
  platform: IMPlatform;
  conversationId: string;
  threadId: string | null;
  receivedAt: number;
  message: IMMessage;
  replyFn: (text: string) => Promise<void>;
}

export interface GatewayInboundResult {
  runId: string;
  platform: IMPlatform;
  conversationId: string;
  replyText: string;
  completedAt: number;
}

export interface GatewayOutboundEnvelope {
  runId: string;
  platform: IMPlatform;
  conversationId: string;
  text: string;
  createdAt: number;
  deliver: (text: string) => Promise<void>;
}

export interface GatewayRunState {
  runId: string;
  status: GatewayRunStatus;
  platform: IMPlatform;
  conversationId: string;
  errorMessage?: string;
  updatedAt: number;
}
