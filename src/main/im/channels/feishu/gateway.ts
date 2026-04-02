/**
 * Native Feishu gateway for yd_cowork engine.
 * Uses WebSocket by default; webhook is gated behind an internal env switch.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
  DEFAULT_FEISHU_STATUS,
  type FeishuGatewayStatus,
  type IMMediaAttachment,
  type FeishuOpenClawConfig,
  type IMMessage,
  type MediaMarker,
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

const FeishuApi = {
  CreateMessage: '/open-apis/im/v1/messages',
  ReceiveIdTypeChatId: 'chat_id',
  MessageTypeText: 'text',
  MessageTypeImage: 'image',
  MessageTypeFile: 'file',
  MessageTypeAudio: 'audio',
  MessageTypeMedia: 'media',
  ImageUploadTypeMessage: 'message',
} as const;

const FeishuGatewayDefaults = {
  WebhookPath: '/feishu/event',
  WebhookHost: '127.0.0.1',
  WebhookPort: 3110,
  WebhookRoutePrefix: 'yd_cowork_feishu_webhook',
  ExperimentalWebhookEnv: 'LOBSTERAI_IM_FEISHU_WEBHOOK_EXPERIMENTAL',
  InboundMediaDir: 'lobsterai-feishu-inbound',
} as const;

const FeishuFileType = {
  Opus: 'opus',
  Mp4: 'mp4',
  Pdf: 'pdf',
  Doc: 'doc',
  Xls: 'xls',
  Ppt: 'ppt',
  Stream: 'stream',
} as const;

type FeishuFileType = typeof FeishuFileType[keyof typeof FeishuFileType];

const FeishuFileTypeByExtension: Record<string, FeishuFileType> = {
  '.opus': FeishuFileType.Opus,
  '.ogg': FeishuFileType.Opus,
  '.mp4': FeishuFileType.Mp4,
  '.mov': FeishuFileType.Mp4,
  '.avi': FeishuFileType.Mp4,
  '.mkv': FeishuFileType.Mp4,
  '.webm': FeishuFileType.Mp4,
  '.pdf': FeishuFileType.Pdf,
  '.doc': FeishuFileType.Doc,
  '.docx': FeishuFileType.Doc,
  '.xls': FeishuFileType.Xls,
  '.xlsx': FeishuFileType.Xls,
  '.csv': FeishuFileType.Xls,
  '.ppt': FeishuFileType.Ppt,
  '.pptx': FeishuFileType.Ppt,
};

const FeishuInboundResourceType = {
  Image: 'image',
  File: 'file',
} as const;

type FeishuInboundResourceType = typeof FeishuInboundResourceType[keyof typeof FeishuInboundResourceType];

const MimeToExtension: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};

export class YdFeishuGateway extends EventEmitter {
  private status: FeishuGatewayStatus = { ...DEFAULT_FEISHU_STATUS };
  private config: FeishuOpenClawConfig | null = null;
  private wsClient: any | null = null;
  private webhookHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
  private webhookRouteId: string | null = null;
  private larkSdkModule: any | null = null;
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

    const mediaMarkers = parseMediaMarkers(text);
    const outboundMediaMarkers = mediaMarkers.filter((marker) => !this.shouldSkipOutboundMediaEcho(marker.path));
    const plainText = stripMediaMarkers(text, mediaMarkers).trim();
    const failedMediaMarkers: MediaMarker[] = [];

    if (plainText) {
      await this.sendTextMessage(conversationId, plainText);
    }

    if (outboundMediaMarkers.length > 0) {
      for (const marker of outboundMediaMarkers) {
        try {
          await this.sendMediaMessage(conversationId, marker);
        } catch (error) {
          failedMediaMarkers.push(marker);
          console.warn('[YdFeishuGateway] failed to send media marker, skipped this marker:', {
            type: marker.type,
            path: marker.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (!plainText && failedMediaMarkers.length > 0) {
      await this.sendTextMessage(conversationId, this.buildMediaSendFallbackText(failedMediaMarkers.length));
    }

    if (failedMediaMarkers.length > 0) {
      const failedSummary = failedMediaMarkers
        .map((item) => `${item.type}:${item.path}`)
        .join(', ');
      this.status = {
        ...this.status,
        error: `Feishu media markers were skipped: ${failedSummary}`,
      };
    } else {
      this.status = {
        ...this.status,
        error: null,
      };
    }

    this.status = {
      ...this.status,
      lastOutboundAt: Date.now(),
    };
    this.emit('status', this.getStatus());
  }

  private shouldSkipOutboundMediaEcho(rawPath: string): boolean {
    const normalizedPath = this.normalizeMediaPath(rawPath).replace(/\\/g, '/').toLowerCase();
    return normalizedPath.includes('/lobsterai-feishu-inbound/')
      || normalizedPath.includes('/lobsterai-weixin-inbound/');
  }

  private buildMediaSendFallbackText(failedCount: number): string {
    if (failedCount <= 1) {
      return 'Attachment could not be sent because the local file is unavailable.';
    }
    return `${failedCount} attachments could not be sent because local files are unavailable.`;
  }

  private async loadLarkSdkModule(): Promise<any> {
    if (this.larkSdkModule) {
      return this.larkSdkModule;
    }
    this.larkSdkModule = await import('@larksuiteoapi/node-sdk');
    return this.larkSdkModule;
  }

  private async sendTextMessage(conversationId: string, text: string): Promise<void> {
    const client = await this.createLarkClient();
    await this.sendMessageByType(client, conversationId, FeishuApi.MessageTypeText, { text });
  }

  private async sendMediaMessage(conversationId: string, marker: MediaMarker): Promise<void> {
    const prepared = await this.prepareOutboundMedia(marker.path);
    const client = await this.createLarkClient();

    if (marker.type === FeishuMessageType.Image) {
      const uploadResponse = await client.im.image.create({
        data: {
          image_type: FeishuApi.ImageUploadTypeMessage,
          image: prepared.fileBuffer,
        },
      });
      const imageKey = uploadResponse?.data?.image_key ?? uploadResponse?.image_key;
      if (!imageKey) {
        throw new Error(`Feishu image upload failed: ${uploadResponse?.msg || uploadResponse?.code || 'missing image_key'}`);
      }
      await this.sendMessageByType(client, conversationId, FeishuApi.MessageTypeImage, { image_key: imageKey });
      return;
    }

    const fileType = this.resolveFeishuFileType(prepared.filePath);
    const uploadResponse = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: prepared.fileName,
        file: prepared.fileBuffer,
      },
    });
    const fileKey = uploadResponse?.data?.file_key ?? uploadResponse?.file_key;
    if (!fileKey) {
      throw new Error(`Feishu file upload failed: ${uploadResponse?.msg || uploadResponse?.code || 'missing file_key'}`);
    }
    const messageType = this.resolveMediaMessageType(marker.type);
    await this.sendMessageByType(client, conversationId, messageType, { file_key: fileKey });
  }

  private resolveMediaMessageType(markerType: MediaMarker['type']): string {
    if (markerType === FeishuMessageType.Audio) {
      return FeishuApi.MessageTypeAudio;
    }
    if (markerType === FeishuMessageType.Video) {
      return FeishuApi.MessageTypeMedia;
    }
    return FeishuApi.MessageTypeFile;
  }

  private resolveFeishuFileType(filePath: string): FeishuFileType {
    const extension = path.extname(filePath).toLowerCase();
    return FeishuFileTypeByExtension[extension] ?? FeishuFileType.Stream;
  }

  private async createLarkClient(): Promise<any> {
    const Lark = await this.loadLarkSdkModule();
    return new Lark.Client({
      appId: this.config?.appId,
      appSecret: this.config?.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: this.resolveLarkDomain(this.config?.domain ?? 'feishu', Lark),
    });
  }

  private async sendMessageByType(
    client: any,
    conversationId: string,
    messageType: string,
    content: Record<string, string>,
  ): Promise<void> {
    const response = await client.request({
      method: 'POST',
      url: FeishuApi.CreateMessage,
      params: {
        receive_id_type: FeishuApi.ReceiveIdTypeChatId,
      },
      data: {
        receive_id: conversationId,
        msg_type: messageType,
        content: JSON.stringify(content),
      },
    });
    if (response?.code !== 0) {
      throw new Error(`Feishu send message failed: ${response?.msg || response?.code || 'unknown'}`);
    }
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

    const normalized = await this.normalizeInboundMessage(event);
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

  private async normalizeInboundMessage(event: any): Promise<IMMessage | null> {
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

    const contentResult = await this.extractMessageContent(message);
    const timestampValue = Number.parseInt(message?.create_time || '', 10);

    return {
      platform: 'feishu',
      messageId,
      conversationId,
      senderId,
      senderName: senderIdentity.user_id || senderIdentity.open_id || undefined,
      groupName: message?.chat_name || undefined,
      content: contentResult.content,
      chatType,
      timestamp: Number.isFinite(timestampValue) ? timestampValue : Date.now(),
      attachments: contentResult.attachments,
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

  private async extractMessageContent(message: any): Promise<{
    content: string;
    attachments?: IMMediaAttachment[];
  }> {
    const messageType = String(message?.message_type || '');
    const rawContent = typeof message?.content === 'string' ? message.content : '';
    const mentions = Array.isArray(message?.mentions) ? message.mentions : [];

    if (!rawContent) {
      return {
        content: this.fallbackContentForType(messageType),
      };
    }

    try {
      const parsed = JSON.parse(rawContent);
      if (typeof parsed?.text === 'string') {
        return {
          content: this.stripMentionKeys(parsed.text, mentions) || this.fallbackContentForType(messageType),
        };
      }
      const mediaResult = await this.tryExtractMediaContent(message, parsed);
      if (mediaResult) {
        return mediaResult;
      }
    } catch {
      if (messageType === FeishuMessageType.Text) {
        return {
          content: this.stripMentionKeys(rawContent, mentions) || this.fallbackContentForType(messageType),
        };
      }
    }
    return {
      content: this.fallbackContentForType(messageType),
    };
  }

  private async tryExtractMediaContent(message: any, parsedContent: any): Promise<{
    content: string;
    attachments: IMMediaAttachment[];
  } | null> {
    const messageType = String(message?.message_type || '');
    const messageId = String(message?.message_id || '').trim();
    if (!messageId) {
      return null;
    }

    const isImage = messageType === FeishuMessageType.Image;
    const fileKey = String((isImage ? parsedContent?.image_key : parsedContent?.file_key) || '').trim();
    if (!fileKey) {
      return null;
    }

    const resourceType: FeishuInboundResourceType = isImage
      ? FeishuInboundResourceType.Image
      : FeishuInboundResourceType.File;

    try {
      const downloaded = await this.downloadInboundMediaResource({
        messageId,
        fileKey,
        resourceType,
      });
      const attachmentType: IMMediaAttachment['type'] = isImage
        ? 'image'
        : (messageType === FeishuMessageType.Video ? 'video'
          : (messageType === FeishuMessageType.Audio ? 'audio' : 'document'));
      const attachment: IMMediaAttachment = {
        type: attachmentType,
        localPath: downloaded.localPath,
        mimeType: downloaded.mimeType,
        fileName: downloaded.fileName,
        fileSize: downloaded.fileSize,
      };
      const content = isImage
        ? `![image](${pathToFileURL(downloaded.localPath).toString()})`
        : `[${attachmentType}] ${downloaded.fileName}`;
      return {
        content,
        attachments: [attachment],
      };
    } catch (error) {
      console.warn('[YdFeishuGateway] failed to resolve inbound media resource, fallback to placeholder:', {
        messageId,
        messageType,
        fileKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async downloadInboundMediaResource(params: {
    messageId: string;
    fileKey: string;
    resourceType: FeishuInboundResourceType;
  }): Promise<{
    localPath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> {
    const client = await this.createLarkClient();
    const response = await client.im.messageResource.get({
      path: {
        message_id: params.messageId,
        file_key: params.fileKey,
      },
      params: {
        type: params.resourceType,
      },
    });
    const stream = response?.getReadableStream?.();
    if (!stream) {
      throw new Error('Feishu message resource stream is unavailable');
    }
    const buffer = await this.readStreamToBuffer(stream);
    if (!buffer.length) {
      throw new Error('Feishu message resource is empty');
    }

    const maxBytes = (this.config?.mediaMaxMb ?? 30) * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`Feishu inbound media exceeds max size: ${buffer.length} > ${maxBytes}`);
    }

    const headers = response?.headers;
    const mimeType = this.extractContentType(headers, params.resourceType);
    const headerFileName = this.extractFileNameFromHeaders(headers);
    const finalFileName = this.ensureFileNameExtension(
      headerFileName || params.fileKey,
      mimeType,
      params.resourceType,
    );
    const mediaDir = path.join(os.tmpdir(), FeishuGatewayDefaults.InboundMediaDir);
    await fs.mkdir(mediaDir, { recursive: true });
    const localPath = path.join(mediaDir, `${Date.now()}-${params.fileKey}${path.extname(finalFileName)}`);
    await fs.writeFile(localPath, buffer);
    return {
      localPath,
      fileName: finalFileName,
      fileSize: buffer.length,
      mimeType,
    };
  }

  private async readStreamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer | Uint8Array | string) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
          return;
        }
        if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
          return;
        }
        chunks.push(Buffer.from(String(chunk)));
      });
      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', reject);
    });
  }

  private extractContentType(
    headers: Record<string, unknown> | undefined,
    resourceType: FeishuInboundResourceType,
  ): string {
    const value = this.readHeaderValue(headers, 'content-type').split(';')[0].trim().toLowerCase();
    if (value) {
      return value;
    }
    if (resourceType === FeishuInboundResourceType.Image) {
      return 'image/jpeg';
    }
    return 'application/octet-stream';
  }

  private extractFileNameFromHeaders(headers: Record<string, unknown> | undefined): string {
    const contentDisposition = this.readHeaderValue(headers, 'content-disposition');
    if (!contentDisposition) {
      return '';
    }
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
      } catch {
        return utf8Match[1].trim().replace(/^"|"$/g, '');
      }
    }
    const fallbackMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1].trim();
    }
    return '';
  }

  private ensureFileNameExtension(
    fileName: string,
    mimeType: string,
    resourceType: FeishuInboundResourceType,
  ): string {
    const normalized = fileName.trim() || 'resource';
    const extension = path.extname(normalized);
    if (extension) {
      return normalized;
    }
    const resolvedExtension = MimeToExtension[mimeType] || (resourceType === FeishuInboundResourceType.Image ? '.jpg' : '.bin');
    return `${normalized}${resolvedExtension}`;
  }

  private readHeaderValue(headers: Record<string, unknown> | undefined, name: string): string {
    if (!headers || typeof headers !== 'object') {
      return '';
    }
    const normalizedName = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== normalizedName) {
        continue;
      }
      const value = headers[key];
      if (Array.isArray(value)) {
        return String(value[0] ?? '');
      }
      return String(value ?? '');
    }
    return '';
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
    filePath: string;
    fileName: string;
    fileBuffer: Buffer;
  }> {
    const normalizedPath = this.normalizeMediaPath(inputPath).trim();
    if (!normalizedPath) {
      throw new Error('Feishu media path is empty');
    }

    if (/^https?:\/\//i.test(normalizedPath)) {
      throw new Error('Feishu media remote URL is not allowed, please use a local absolute file path');
    }

    const filePath = this.resolveLocalMediaAbsolutePath(normalizedPath);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Feishu media file does not exist: ${filePath}`);
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error('Feishu media path must point to a file');
    }
    const fileBuffer = await fs.readFile(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      fileBuffer,
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
