/**
 * Native Feishu gateway for yd_cowork engine.
 * Uses WebSocket by default; webhook is gated behind an internal env switch.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_FEISHU_STATUS,
  type FeishuGatewayStatus,
  type FeishuOpenClawConfig,
  type IMMessage,
} from '../../types';
import { parseMediaMarkers, stripMediaMarkers } from '../../dingtalkMediaParser';
import { WebhookHub } from '../../gateway/webhookHub';

const FeishuConnectionMode = {
  Websocket: 'websocket',
  Webhook: 'webhook',
} as const;

type FeishuConnectionMode = typeof FeishuConnectionMode[keyof typeof FeishuConnectionMode];

const FeishuChatType = {
  P2P: 'p2p',
  Private: 'private',
  Single: 'single',
} as const;

const FeishuPolicy = {
  Open: 'open',
  Allowlist: 'allowlist',
  Disabled: 'disabled',
} as const;

const FeishuMessageType = {
  Text: 'text',
  Image: 'image',
  Audio: 'audio',
  File: 'file',
  Video: 'video',
} as const;

const FeishuEvent = {
  MessageReceive: 'im.message.receive_v1',
} as const;

const FeishuGatewayDefaults = {
  WebhookPath: '/feishu/event',
  WebhookHost: '127.0.0.1',
  WebhookPort: 3110,
  WebhookRoutePrefix: 'yd_cowork_feishu_webhook',
  ExperimentalWebhookEnv: 'LOBSTERAI_IM_FEISHU_WEBHOOK_EXPERIMENTAL',
} as const;

export class YdFeishuGateway extends EventEmitter {
  private status: FeishuGatewayStatus = { ...DEFAULT_FEISHU_STATUS };
  private config: FeishuOpenClawConfig | null = null;
  private wsClient: any | null = null;
  private webhookHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
  private webhookRouteId: string | null = null;
  private larkSdkModule: any | null = null;
  private larkDeliverModule: any | null = null;
  private onMessageCallback?: (
    message: IMMessage,
    replyFn: (text: string) => Promise<void>,
  ) => Promise<void>;
  private stopRequested = false;
  private lastConversationId: string | null = null;

  constructor(private readonly webhookHub: WebhookHub) {
    super();
  }

  getStatus(): FeishuGatewayStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  isRunning(): boolean {
    return Boolean(this.wsClient || this.webhookRouteId);
  }

  setMessageCallback(
    callback: (message: IMMessage, replyFn: (text: string) => Promise<void>) => Promise<void>,
  ): void {
    this.onMessageCallback = callback;
  }

  async start(config: FeishuOpenClawConfig): Promise<void> {
    await this.stop();
    this.stopRequested = false;
    this.config = { ...config };

    if (!config.enabled) {
      this.status = {
        ...this.status,
        connected: false,
        startedAt: null,
        error: null,
      };
      this.emit('status', this.getStatus());
      return;
    }

    if (!config.appId || !config.appSecret) {
      throw new Error('Feishu appId/appSecret is required');
    }

    this.status = {
      ...this.status,
      connected: false,
      startedAt: new Date().toISOString(),
      error: null,
    };
    this.emit('status', this.getStatus());

    try {
      await this.probeBotIdentity();
      if (this.resolveConnectionMode(config) === FeishuConnectionMode.Webhook) {
        await this.startWebhookServer();
      } else {
        await this.startWebSocketClient();
      }
      this.status = { ...this.status, connected: true, error: null };
      this.emit('connected');
      this.emit('status', this.getStatus());
      console.log('[YdFeishuGateway] gateway started successfully');
    } catch (error: any) {
      this.status = {
        ...this.status,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit('error', error);
      this.emit('status', this.getStatus());
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const hadConnection = this.status.connected || this.isRunning();

    if (this.wsClient) {
      try {
        this.wsClient.close?.({ force: true });
      } catch (error) {
        console.warn('[YdFeishuGateway] failed to close websocket client:', error);
      } finally {
        this.wsClient = null;
      }
    }

    if (this.webhookRouteId) {
      try {
        await this.webhookHub.unregisterRoute(this.webhookRouteId);
      } catch (error) {
        console.warn('[YdFeishuGateway] failed to unregister webhook route:', error);
      } finally {
        this.webhookRouteId = null;
        this.webhookHandler = null;
      }
    }

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
    this.start(this.config).catch((error) => {
      console.error('[YdFeishuGateway] reconnect failed:', error);
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
    if (!this.config?.enabled) {
      throw new Error('Feishu gateway is not enabled');
    }
    if (!conversationId.trim()) {
      throw new Error('Feishu conversationId is empty');
    }

    const deliver = await this.loadLarkDeliverModule();
    const cfg = this.buildFeishuLarkConfig();
    const mediaMarkers = parseMediaMarkers(text);
    const plainText = stripMediaMarkers(text, mediaMarkers).trim();

    if (plainText) {
      await deliver.sendTextLark({
        cfg,
        to: conversationId,
        text: plainText,
      });
    }

    for (const marker of mediaMarkers) {
      const prepared = await this.prepareOutboundMedia(marker.path);
      await deliver.sendMediaLark({
        cfg,
        to: conversationId,
        mediaUrl: prepared.mediaUrl,
        mediaLocalRoots: prepared.mediaLocalRoots,
      });
    }

    this.status = {
      ...this.status,
      lastOutboundAt: Date.now(),
      error: null,
    };
    this.emit('status', this.getStatus());
  }

  private async loadLarkSdkModule(): Promise<any> {
    if (this.larkSdkModule) {
      return this.larkSdkModule;
    }
    this.larkSdkModule = await import('@larksuiteoapi/node-sdk');
    return this.larkSdkModule;
  }

  private async loadLarkDeliverModule(): Promise<any> {
    if (this.larkDeliverModule) {
      return this.larkDeliverModule;
    }
    this.larkDeliverModule = await import('@larksuite/openclaw-lark');
    return this.larkDeliverModule;
  }

  private resolveConnectionMode(config: FeishuOpenClawConfig): FeishuConnectionMode {
    // Product policy: user-facing IM channel defaults to WS/poll flows.
    // Webhook mode is kept behind an internal env switch only.
    const enableExperimentalWebhook = process.env[FeishuGatewayDefaults.ExperimentalWebhookEnv] === '1';
    if (!enableExperimentalWebhook) {
      if (config.connectionMode === FeishuConnectionMode.Webhook) {
        console.log('[YdFeishuGateway] webhook mode is ignored because experimental webhook switch is disabled');
      }
      return FeishuConnectionMode.Websocket;
    }
    return config.connectionMode === FeishuConnectionMode.Webhook
      ? FeishuConnectionMode.Webhook
      : FeishuConnectionMode.Websocket;
  }

  private resolveLarkDomain(rawDomain: string, Lark: any): any {
    if (rawDomain === 'lark') {
      return Lark.Domain.Lark;
    }
    if (rawDomain === 'feishu') {
      return Lark.Domain.Feishu;
    }
    return rawDomain.replace(/\/+$/, '');
  }

  private resolveWebhookPath(rawPath?: string): string {
    const value = rawPath?.trim();
    if (!value) {
      return FeishuGatewayDefaults.WebhookPath;
    }
    return value.startsWith('/') ? value : `/${value}`;
  }

  private resolveWebhookHost(rawHost?: string): string {
    const value = rawHost?.trim();
    return value || FeishuGatewayDefaults.WebhookHost;
  }

  private resolveWebhookPort(rawPort?: number): number {
    if (typeof rawPort === 'number' && Number.isFinite(rawPort) && rawPort > 0) {
      return Math.floor(rawPort);
    }
    return FeishuGatewayDefaults.WebhookPort;
  }

  private buildDispatcherOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    if (this.config?.encryptKey?.trim()) {
      options.encryptKey = this.config.encryptKey.trim();
    }
    if (this.config?.verificationToken?.trim()) {
      options.verificationToken = this.config.verificationToken.trim();
    }
    return options;
  }

  private async probeBotIdentity(): Promise<void> {
    const Lark = await this.loadLarkSdkModule();
    if (!this.config?.appId || !this.config?.appSecret) {
      return;
    }
    try {
      const client = new Lark.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain: this.resolveLarkDomain(this.config.domain, Lark),
      });
      const response = await client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });
      if (response.code !== 0) {
        console.warn(`[YdFeishuGateway] failed to probe bot info: ${response.msg || response.code}`);
        return;
      }
      const botOpenId = response?.bot?.open_id ?? response?.data?.bot?.open_id ?? null;
      this.status = {
        ...this.status,
        botOpenId,
      };
    } catch (error) {
      console.warn('[YdFeishuGateway] failed to probe bot identity:', error);
    }
  }

  private async startWebSocketClient(): Promise<void> {
    const Lark = await this.loadLarkSdkModule();
    if (!this.config?.appId || !this.config?.appSecret) {
      throw new Error('Feishu appId/appSecret is required');
    }
    const wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: this.resolveLarkDomain(this.config.domain, Lark),
      loggerLevel: this.config.debug ? Lark.LoggerLevel.debug : Lark.LoggerLevel.info,
      autoReconnect: true,
    });
    const eventDispatcher = new Lark.EventDispatcher(this.buildDispatcherOptions());
    eventDispatcher.register({
      [FeishuEvent.MessageReceive]: async (data: any) => {
        await this.handleInboundEvent(data);
      },
    });
    this.wsClient = wsClient;
    await wsClient.start({ eventDispatcher });
  }

  private async startWebhookServer(): Promise<void> {
    const Lark = await this.loadLarkSdkModule();
    const webhookPath = this.resolveWebhookPath(this.config?.webhookPath);
    const webhookHost = this.resolveWebhookHost(this.config?.webhookHost);
    const webhookPort = this.resolveWebhookPort(this.config?.webhookPort);

    const eventDispatcher = new Lark.EventDispatcher(this.buildDispatcherOptions());
    eventDispatcher.register({
      [FeishuEvent.MessageReceive]: async (data: any) => {
        await this.handleInboundEvent(data);
      },
    });

    this.webhookHandler = Lark.adaptDefault(webhookPath, eventDispatcher, {
      autoChallenge: true,
    });
    const routeId = [
      FeishuGatewayDefaults.WebhookRoutePrefix,
      webhookHost,
      webhookPort,
      webhookPath,
    ].join(':');

    await this.webhookHub.registerRoute({
      routeId,
      host: webhookHost,
      port: webhookPort,
      path: webhookPath,
      handler: async (req, res) => {
        if (!this.webhookHandler) {
          res.statusCode = 503;
          res.end('Service Unavailable');
          return;
        }
        this.webhookHandler(req, res);
      },
    });

    this.webhookRouteId = routeId;
    console.log(`[YdFeishuGateway] webhook route registered at ${webhookHost}:${webhookPort}${webhookPath}`);
  }

  private async handleInboundEvent(payload: any): Promise<void> {
    if (this.stopRequested) {
      return;
    }
    const event = this.resolveInboundEvent(payload);
    if (!event?.message) {
      return;
    }

    const normalized = this.normalizeInboundMessage(event);
    if (!normalized) {
      return;
    }

    this.lastConversationId = normalized.conversationId;
    this.status = {
      ...this.status,
      lastInboundAt: Date.now(),
      error: null,
    };
    this.emit('message', normalized);
    this.emit('status', this.getStatus());

    if (!this.onMessageCallback) {
      return;
    }

    const replyFn = async (text: string): Promise<void> => {
      await this.sendConversationNotification(normalized.conversationId, text);
    };
    await this.onMessageCallback(normalized, replyFn);
  }

  private resolveInboundEvent(payload: any): any {
    if (payload?.event?.message) {
      return payload.event;
    }
    if (payload?.message) {
      return payload;
    }
    if (payload?.data?.event?.message) {
      return payload.data.event;
    }
    if (payload?.data?.message) {
      return payload.data;
    }
    return null;
  }

  private normalizeInboundMessage(event: any): IMMessage | null {
    const message = event?.message;
    const senderIdentity = event?.sender?.sender_id ?? {};
    const senderId = (
      senderIdentity.open_id
      || senderIdentity.user_id
      || senderIdentity.union_id
      || ''
    ).trim();
    const messageId = message?.message_id?.trim() || '';
    const conversationId = message?.chat_id?.trim() || '';
    if (!senderId || !messageId || !conversationId) {
      return null;
    }

    const rawChatType = String(message?.chat_type || '').toLowerCase();
    const isDirectChat = rawChatType === FeishuChatType.P2P
      || rawChatType === FeishuChatType.Private
      || rawChatType === FeishuChatType.Single;
    const chatType = isDirectChat ? 'direct' : 'group';
    if (!this.isInboundAllowed(chatType, senderId, conversationId, message)) {
      return null;
    }

    const textContent = this.extractMessageContent(message);
    const timestampValue = Number.parseInt(message?.create_time || '', 10);

    return {
      platform: 'feishu',
      messageId,
      conversationId,
      senderId,
      senderName: senderIdentity.user_id || senderIdentity.open_id || undefined,
      groupName: message?.chat_name || undefined,
      content: textContent,
      chatType,
      timestamp: Number.isFinite(timestampValue) ? timestampValue : Date.now(),
    };
  }

  private isInboundAllowed(
    chatType: IMMessage['chatType'],
    senderId: string,
    conversationId: string,
    message: any,
  ): boolean {
    if (!this.config) {
      return false;
    }

    if (chatType === 'direct') {
      if (this.config.dmPolicy === FeishuPolicy.Disabled) {
        return false;
      }
      if (this.config.dmPolicy === FeishuPolicy.Allowlist) {
        return this.config.allowFrom.includes(senderId);
      }
      return true;
    }

    if (this.config.groupPolicy === FeishuPolicy.Disabled) {
      return false;
    }
    const groupAllowFrom = Array.isArray(this.config.groupAllowFrom)
      ? this.config.groupAllowFrom
      : [];
    if (
      this.config.groupPolicy === FeishuPolicy.Allowlist
      // Empty allowlist should not block all group traffic by default.
      && groupAllowFrom.length > 0
      && !groupAllowFrom.includes(conversationId)
    ) {
      return false;
    }

    const wildcardGroup = this.config.groups?.['*'] ?? {};
    const scopedGroup = this.config.groups?.[conversationId] ?? {};
    const senderAllowFrom = scopedGroup.allowFrom ?? wildcardGroup.allowFrom ?? [];
    if (Array.isArray(senderAllowFrom) && senderAllowFrom.length > 0 && !senderAllowFrom.includes(senderId)) {
      return false;
    }

    const requireMention = scopedGroup.requireMention ?? wildcardGroup.requireMention ?? false;
    if (!requireMention) {
      return true;
    }
    const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
    if (!this.status.botOpenId) {
      // Fallback when bot identity probe fails: if Feishu still provides any
      // mention marker, treat it as a bot mention to avoid dead channels.
      const rawContent = typeof message?.content === 'string' ? message.content : '';
      const hasMentionMarker = mentions.length > 0 || /@_user_\d+/.test(rawContent);
      if (!hasMentionMarker) {
        console.warn('[YdFeishuGateway] requireMention is enabled but botOpenId is unavailable and no mention marker was found, dropping group message');
        return false;
      }
      console.warn('[YdFeishuGateway] botOpenId is unavailable, using mention-marker fallback for group message');
      return true;
    }
    return mentions.some((item: any) => item?.id?.open_id === this.status.botOpenId);
  }

  private extractMessageContent(message: any): string {
    const messageType = String(message?.message_type || '');
    const rawContent = typeof message?.content === 'string' ? message.content : '';
    const mentions = Array.isArray(message?.mentions) ? message.mentions : [];

    if (!rawContent) {
      return this.fallbackContentForType(messageType);
    }

    try {
      const parsed = JSON.parse(rawContent);
      if (typeof parsed?.text === 'string') {
        return this.stripMentionKeys(parsed.text, mentions) || this.fallbackContentForType(messageType);
      }
    } catch {
      if (messageType === FeishuMessageType.Text) {
        return this.stripMentionKeys(rawContent, mentions) || this.fallbackContentForType(messageType);
      }
    }
    return this.fallbackContentForType(messageType);
  }

  private stripMentionKeys(text: string, mentions: any[]): string {
    let next = text;
    for (const item of mentions) {
      const key = typeof item?.key === 'string' ? item.key : '';
      if (!key) {
        continue;
      }
      next = next.replace(new RegExp(this.escapeRegExp(key), 'g'), '');
    }
    return next.trim();
  }

  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private fallbackContentForType(messageType: string): string {
    if (messageType === FeishuMessageType.Image) {
      return '[Image message]';
    }
    if (messageType === FeishuMessageType.Audio) {
      return '[Audio message]';
    }
    if (messageType === FeishuMessageType.Video) {
      return '[Video message]';
    }
    if (messageType === FeishuMessageType.File) {
      return '[File message]';
    }
    return '[Unsupported message type]';
  }

  private buildFeishuLarkConfig(): Record<string, unknown> {
    return {
      channels: {
        feishu: {
          enabled: this.config?.enabled ?? false,
          appId: this.config?.appId ?? '',
          appSecret: this.config?.appSecret ?? '',
          domain: this.config?.domain ?? 'feishu',
          dmPolicy: this.config?.dmPolicy ?? FeishuPolicy.Open,
          allowFrom: this.config?.allowFrom ?? [],
          groupPolicy: this.config?.groupPolicy ?? FeishuPolicy.Open,
          groupAllowFrom: this.config?.groupAllowFrom ?? [],
          groups: this.config?.groups ?? {},
          historyLimit: this.config?.historyLimit ?? 50,
          mediaMaxMb: this.config?.mediaMaxMb ?? 30,
          replyMode: this.config?.replyMode ?? 'auto',
          debug: this.config?.debug ?? false,
          connectionMode: this.resolveConnectionMode(this.config ?? ({} as FeishuOpenClawConfig)),
          verificationToken: this.config?.verificationToken ?? '',
          encryptKey: this.config?.encryptKey ?? '',
        },
      },
    };
  }

  private normalizeMediaPath(input: string): string {
    if (!input) {
      return input;
    }
    if (input.startsWith('~/')) {
      return path.join(os.homedir(), input.slice(2));
    }
    return input;
  }

  private async prepareOutboundMedia(inputPath: string): Promise<{
    mediaUrl: string;
    mediaLocalRoots: string[];
  }> {
    const normalizedPath = this.normalizeMediaPath(inputPath).trim();
    if (!normalizedPath) {
      throw new Error('Feishu media path is empty');
    }

    if (/^https?:\/\//i.test(normalizedPath)) {
      throw new Error('Feishu media remote URL is not allowed, please use a local absolute file path');
    }

    const filePath = this.resolveLocalMediaAbsolutePath(normalizedPath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('Feishu media path must point to a file');
    }
    return {
      mediaUrl: filePath,
      mediaLocalRoots: [path.dirname(filePath)],
    };
  }

  private resolveLocalMediaAbsolutePath(rawPath: string): string {
    let normalizedPath = rawPath;
    if (normalizedPath.startsWith('file://')) {
      try {
        normalizedPath = decodeURIComponent(normalizedPath.replace(/^file:\/\//, ''));
      } catch {
        normalizedPath = normalizedPath.replace(/^file:\/\//, '');
      }
    }
    if (!path.isAbsolute(normalizedPath)) {
      throw new Error('Feishu media local path must be absolute');
    }
    return normalizedPath;
  }

}
