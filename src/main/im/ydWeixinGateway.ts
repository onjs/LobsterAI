import { randomBytes, randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  DEFAULT_WEIXIN_STATUS,
  type IMMessage,
  type WeixinGatewayStatus,
  type WeixinOpenClawConfig,
} from './types';
import { parseMediaMarkers, stripMediaMarkers } from './dingtalkMediaParser';
import type { WeixinQrCredential } from './ydWeixinAuth';

const WeixinPolicy = {
  Open: 'open',
  Pairing: 'pairing',
  Allowlist: 'allowlist',
  Disabled: 'disabled',
} as const;

const WeixinMessageType = {
  User: 1,
  Bot: 2,
} as const;

const WeixinMessageState = {
  Finish: 2,
} as const;

const WeixinItemType = {
  Text: 1,
  Image: 2,
  Voice: 3,
  File: 4,
  Video: 5,
} as const;

const WeixinGatewayDefaults = {
  LongPollTimeoutMs: 40_000,
  LongPollTimeoutFloorMs: 10_000,
  ApiTimeoutMs: 15_000,
  RetryDelayMs: 1_000,
  RetryDelayMaxMs: 10_000,
  SessionExpiredCode: -14,
  TextChunkLimit: 2_000,
} as const;

interface WeixinMessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
  image_item?: {
    url?: string;
  };
  voice_item?: {
    text?: string;
  };
  file_item?: {
    file_name?: string;
  };
}

interface WeixinRawMessage {
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  context_token?: string;
  message_type?: number;
  create_time_ms?: number;
  item_list?: WeixinMessageItem[];
}

interface WeixinGetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinRawMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export class YdWeixinGateway extends EventEmitter {
  private status: WeixinGatewayStatus = { ...DEFAULT_WEIXIN_STATUS };
  private config: WeixinOpenClawConfig | null = null;
  private credential: WeixinQrCredential | null = null;
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private pollController: AbortController | null = null;
  private onMessageCallback?: (
    message: IMMessage,
    replyFn: (text: string) => Promise<void>,
  ) => Promise<void>;
  private lastConversationId: string | null = null;
  private cursor = '';
  private contextTokens = new Map<string, string>();
  private nextPollTimeoutMs: number = WeixinGatewayDefaults.LongPollTimeoutMs;

  getStatus(): WeixinGatewayStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  isRunning(): boolean {
    return Boolean(this.runPromise);
  }

  setCredential(credential: WeixinQrCredential | null): void {
    this.credential = credential ? { ...credential } : null;
  }

  setMessageCallback(
    callback: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>,
  ): void {
    this.onMessageCallback = callback;
  }

  getNotificationTarget(): { conversationId: string } | null {
    if (!this.lastConversationId) {
      return null;
    }
    return { conversationId: this.lastConversationId };
  }

  setNotificationTarget(target: unknown): void {
    if (!target || typeof target !== 'object') {
      return;
    }
    const conversationId = (target as { conversationId?: unknown }).conversationId;
    if (typeof conversationId === 'string' && conversationId.trim()) {
      this.lastConversationId = conversationId.trim();
    }
  }

  async start(config: WeixinOpenClawConfig, credential: WeixinQrCredential | null): Promise<void> {
    await this.stop();
    this.stopRequested = false;
    this.config = { ...config };
    this.credential = credential ? { ...credential } : null;

    if (!config.enabled) {
      this.status = {
        ...this.status,
        connected: false,
        startedAt: null,
        lastError: null,
      };
      this.emit('status', this.getStatus());
      return;
    }

    if (!credential || !credential.token || !credential.accountId || !credential.baseUrl) {
      throw new Error('Weixin credential is missing. Please complete QR login first.');
    }

    this.cursor = '';
    this.contextTokens.clear();
    this.nextPollTimeoutMs = WeixinGatewayDefaults.LongPollTimeoutMs;
    this.status = {
      ...this.status,
      connected: true,
      startedAt: Date.now(),
      lastError: null,
    };
    this.emit('connected');
    this.emit('status', this.getStatus());

    this.runPromise = this.runLoop(credential).catch((error: unknown) => {
      if (this.stopRequested) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        connected: false,
        lastError: message,
      };
      this.emit('error', error);
      this.emit('status', this.getStatus());
    });

    console.log('[YdWeixinGateway] gateway started successfully');
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const hadConnection = this.status.connected || this.isRunning();

    if (this.pollController) {
      this.pollController.abort();
      this.pollController = null;
    }

    if (this.runPromise) {
      try {
        await this.runPromise;
      } catch {
        // runLoop errors are handled in the promise catch branch.
      }
    }

    this.runPromise = null;
    this.status = {
      ...this.status,
      connected: false,
    };
    if (hadConnection) {
      this.emit('disconnected');
    }
    this.emit('status', this.getStatus());
  }

  reconnectIfNeeded(): void {
    if (this.stopRequested || !this.config?.enabled) {
      return;
    }
    if (this.isRunning()) {
      return;
    }
    this.start(this.config, this.credential).catch((error) => {
      console.error('[YdWeixinGateway] reconnect failed:', error);
    });
  }

  async sendNotification(text: string): Promise<boolean> {
    if (!this.lastConversationId) {
      return false;
    }
    await this.sendConversationNotification(this.lastConversationId, text);
    return true;
  }

  async sendConversationNotification(conversationId: string, text: string): Promise<void> {
    if (!this.isConnected() || !this.credential) {
      throw new Error('Weixin gateway is not connected.');
    }

    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new Error('Weixin conversationId is empty.');
    }

    const contextToken = this.contextTokens.get(normalizedConversationId)?.trim();
    if (!contextToken) {
      throw new Error('Weixin context token is missing for this conversation. Wait for an inbound message first.');
    }

    const mediaMarkers = parseMediaMarkers(text);
    const plainText = stripMediaMarkers(text, mediaMarkers).trim();
    const outboundText = plainText || text.trim();
    if (!outboundText) {
      throw new Error('Weixin outbound text is empty.');
    }

    for (const chunk of this.chunkText(outboundText, WeixinGatewayDefaults.TextChunkLimit)) {
      await this.sendTextMessage(normalizedConversationId, contextToken, chunk);
    }

    this.lastConversationId = normalizedConversationId;
    this.status = {
      ...this.status,
      lastOutboundAt: Date.now(),
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  private async runLoop(credential: WeixinQrCredential): Promise<void> {
    let retryDelayMs: number = WeixinGatewayDefaults.RetryDelayMs;

    while (!this.stopRequested) {
      this.pollController = new AbortController();
      try {
        const response = await this.fetchGetUpdates(credential, this.pollController.signal);
        this.pollController = null;
        retryDelayMs = WeixinGatewayDefaults.RetryDelayMs;

        if (typeof response.longpolling_timeout_ms === 'number' && response.longpolling_timeout_ms > 0) {
          this.nextPollTimeoutMs = Math.max(
            response.longpolling_timeout_ms,
            WeixinGatewayDefaults.LongPollTimeoutFloorMs,
          );
        }

        const errorCode = response.errcode ?? response.ret;
        if (errorCode && errorCode !== 0) {
          if (errorCode === WeixinGatewayDefaults.SessionExpiredCode) {
            throw new Error('Weixin session expired. Please login again.');
          }
          throw new Error(`Weixin getUpdates failed: ${response.errmsg || errorCode}`);
        }

        if (typeof response.get_updates_buf === 'string' && response.get_updates_buf) {
          this.cursor = response.get_updates_buf;
        }

        const messages = Array.isArray(response.msgs) ? response.msgs : [];
        for (const raw of messages) {
          if (this.stopRequested) {
            break;
          }
          await this.handleRawMessage(raw);
        }
      } catch (error: unknown) {
        this.pollController = null;

        if (this.stopRequested) {
          return;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.status = {
          ...this.status,
          lastError: message,
        };
        this.emit('status', this.getStatus());

        await this.sleep(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, WeixinGatewayDefaults.RetryDelayMaxMs);
      }
    }
  }

  private async fetchGetUpdates(
    credential: WeixinQrCredential,
    signal: AbortSignal,
  ): Promise<WeixinGetUpdatesResponse> {
    const response = await this.fetchWithTimeout(credential.baseUrl, '/ilink/bot/getupdates', {
      get_updates_buf: this.cursor,
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: credential.token,
      timeoutMs: this.nextPollTimeoutMs,
      signal,
    });
    return response as WeixinGetUpdatesResponse;
  }

  private async sendTextMessage(
    toUserId: string,
    contextToken: string,
    text: string,
  ): Promise<void> {
    if (!this.credential) {
      throw new Error('Weixin credential is missing.');
    }

    await this.fetchWithTimeout(this.credential.baseUrl, '/ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: randomUUID(),
        message_type: WeixinMessageType.Bot,
        message_state: WeixinMessageState.Finish,
        context_token: contextToken,
        item_list: [
          {
            type: WeixinItemType.Text,
            text_item: { text },
          },
        ],
      },
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: this.credential.token,
      timeoutMs: WeixinGatewayDefaults.ApiTimeoutMs,
    });
  }

  private async handleRawMessage(raw: WeixinRawMessage): Promise<void> {
    const normalized = this.normalizeInboundMessage(raw);
    if (!normalized) {
      return;
    }

    this.contextTokens.set(normalized.conversationId, normalized.contextToken);
    this.lastConversationId = normalized.conversationId;
    this.status = {
      ...this.status,
      lastInboundAt: Date.now(),
      lastError: null,
    };

    const message: IMMessage = {
      platform: 'weixin',
      messageId: normalized.messageId,
      conversationId: normalized.conversationId,
      senderId: normalized.senderId,
      content: normalized.content,
      chatType: 'direct',
      timestamp: normalized.timestamp,
    };

    this.emit('message', message);
    this.emit('status', this.getStatus());

    if (!this.onMessageCallback) {
      return;
    }

    const replyFn = async (text: string): Promise<void> => {
      await this.sendConversationNotification(normalized.conversationId, text);
    };
    await this.onMessageCallback(message, replyFn);
  }

  private normalizeInboundMessage(raw: WeixinRawMessage): {
    messageId: string;
    conversationId: string;
    senderId: string;
    content: string;
    timestamp: number;
    contextToken: string;
  } | null {
    if (raw.message_type !== WeixinMessageType.User) {
      return null;
    }

    const senderId = raw.from_user_id?.trim() || '';
    const contextToken = raw.context_token?.trim() || '';
    if (!senderId || !contextToken) {
      return null;
    }

    if (!this.isInboundAllowed(senderId)) {
      return null;
    }

    const messageIdValue = raw.message_id;
    const messageId = typeof messageIdValue === 'number'
      ? String(messageIdValue)
      : typeof messageIdValue === 'string'
        ? messageIdValue
        : `${Date.now()}`;

    const content = this.extractMessageContent(raw.item_list || []);
    const timestamp = typeof raw.create_time_ms === 'number' && Number.isFinite(raw.create_time_ms)
      ? raw.create_time_ms
      : Date.now();

    return {
      messageId,
      conversationId: senderId,
      senderId,
      content,
      timestamp,
      contextToken,
    };
  }

  private extractMessageContent(items: WeixinMessageItem[]): string {
    const parts = items.map((item) => {
      switch (item.type) {
        case WeixinItemType.Text:
          return item.text_item?.text || '';
        case WeixinItemType.Image:
          return item.image_item?.url || '[image]';
        case WeixinItemType.Voice:
          return item.voice_item?.text || '[voice]';
        case WeixinItemType.File:
          return item.file_item?.file_name || '[file]';
        case WeixinItemType.Video:
          return '[video]';
        default:
          return '';
      }
    }).filter(Boolean);

    return parts.join('\n').trim() || '[empty]';
  }

  private isInboundAllowed(senderId: string): boolean {
    if (!this.config) {
      return false;
    }

    if (this.config.dmPolicy === WeixinPolicy.Disabled) {
      return false;
    }

    if (this.config.dmPolicy === WeixinPolicy.Allowlist) {
      return this.config.allowFrom.includes(senderId);
    }

    if (this.config.dmPolicy === WeixinPolicy.Pairing) {
      // Pairing authorization is enforced at IMCowork handler layer.
      return true;
    }

    return true;
  }

  private chunkText(text: string, limit: number): string[] {
    const chars = Array.from(text);
    const chunks: string[] = [];
    for (let index = 0; index < chars.length; index += limit) {
      chunks.push(chars.slice(index, index + limit).join(''));
    }
    return chunks.length > 0 ? chunks : [''];
  }

  private randomWechatUin(): string {
    const value = randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(value), 'utf8').toString('base64');
  }

  private async fetchWithTimeout(
    baseUrl: string,
    endpoint: string,
    body: unknown,
    options: {
      token: string;
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const url = `${normalizedBaseUrl}${endpoint}`;

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${options.token}`,
          'X-WECHAT-UIN': this.randomWechatUin(),
        },
        body: JSON.stringify(body),
        signal,
      });

      const text = await response.text();
      let payload: any = {};
      if (text.trim()) {
        payload = JSON.parse(text);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${payload?.errmsg || text}`);
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
