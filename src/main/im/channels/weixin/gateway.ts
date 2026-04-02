import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { promises as dnsPromises } from 'dns';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  DEFAULT_WEIXIN_STATUS,
  type IMMediaAttachment,
  type IMMessage,
  type MediaMarker,
  type WeixinGatewayStatus,
  type WeixinOpenClawConfig,
} from '../../types';
import { parseMediaMarkers, stripMediaMarkers } from '../../dingtalkMediaParser';
import type { WeixinQrCredential } from './auth';

export const WeixinGatewayErrorCode = {
  MissingContextToken: 'missing_context_token',
  SessionExpired: 'session_expired',
  ApiError: 'api_error',
} as const;

export type WeixinGatewayErrorCode = typeof WeixinGatewayErrorCode[keyof typeof WeixinGatewayErrorCode];

export class WeixinGatewayError extends Error {
  readonly code: WeixinGatewayErrorCode;
  readonly details?: string;

  constructor(code: WeixinGatewayErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'WeixinGatewayError';
    this.code = code;
    this.details = details;
  }
}

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

const WeixinChatType = {
  Direct: 'direct',
  Group: 'group',
} as const;

const WeixinMessageState = {
  Finish: 2,
} as const;

const WeixinTypingStatus = {
  Start: 1,
  Stop: 2,
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
  CdnUploadTimeoutMs: 20_000,
  RetryDelayMs: 1_000,
  RetryDelayMaxMs: 10_000,
  CdnUploadMaxRetries: 3,
  SessionExpiredCode: -14,
  TextChunkLimit: 2_000,
  RemoteMediaDownloadTimeoutMs: 15_000,
  RemoteMediaMaxBytes: 30 * 1024 * 1024,
  CdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c',
  RemoteMediaDir: 'lobsterai-weixin-media',
  InboundMediaDir: 'lobsterai-weixin-inbound',
} as const;

const WeixinInboundMessageDefaults = {
  HexPayloadMinLength: 128,
} as const;

const WeixinInboundPlaceholder = {
  Image: '[image]',
  Voice: '[voice]',
  File: '[file]',
  Video: '[video]',
  Binary: '[binary payload omitted]',
} as const;

interface WeixinMessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
  image_item?: {
    url?: string;
    media?: {
      encrypted_query_param?: string;
      encrypt_query_param?: string;
      aes_key?: string;
      encrypt_type?: number;
    };
    mid_size?: number;
  };
  voice_item?: {
    text?: string;
    media?: {
      encrypted_query_param?: string;
      encrypt_query_param?: string;
      aes_key?: string;
      encrypt_type?: number;
    };
    encode_type?: number;
  };
  file_item?: {
    file_name?: string;
    len?: string;
    media?: {
      encrypted_query_param?: string;
      encrypt_query_param?: string;
      aes_key?: string;
      encrypt_type?: number;
    };
  };
  video_item?: {
    media?: {
      encrypted_query_param?: string;
      encrypt_query_param?: string;
      aes_key?: string;
      encrypt_type?: number;
    };
    video_size?: number;
  };
}

interface WeixinRawMessage {
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  chat_type?: string | number;
  conversation_id?: string;
  group_id?: string;
  room_id?: string;
  chat_id?: string;
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

interface WeixinSendMessageResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

interface WeixinGetConfigResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  typing_ticket?: string;
}

interface WeixinSendTypingResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

interface WeixinGetUploadUrlResponse {
  upload_param?: string;
  errcode?: number;
  errmsg?: string;
}

const WeixinUploadMediaType = {
  Image: 1,
  Video: 2,
  File: 3,
  Voice: 4,
} as const;

type WeixinUploadMediaType = typeof WeixinUploadMediaType[keyof typeof WeixinUploadMediaType];

const WeixinOutboundMediaKind = {
  Image: 'image',
  Video: 'video',
  File: 'file',
  Voice: 'voice',
} as const;

type WeixinOutboundMediaKind = typeof WeixinOutboundMediaKind[keyof typeof WeixinOutboundMediaKind];

const WeixinVoiceEncodeTypeByExtension: Record<string, number> = {
  pcm: 1,
  wav: 1,
  adpcm: 2,
  speex: 4,
  amr: 5,
  silk: 6,
  mp3: 7,
  ogg: 8,
};

interface WeixinUploadedMedia {
  downloadEncryptedQueryParam: string;
  aesKeyBase64: string;
  fileSize: number;
  fileSizeCiphertext: number;
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
  private activeTypingConversations = new Set<string>();
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

  setConversationContextToken(conversationId: string, contextToken: string): void {
    const normalizedConversationId = conversationId.trim();
    const normalizedContextToken = contextToken.trim();
    if (!normalizedConversationId || !normalizedContextToken) {
      return;
    }
    this.contextTokens.set(normalizedConversationId, normalizedContextToken);
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
    this.activeTypingConversations.clear();
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
      throw new WeixinGatewayError(
        WeixinGatewayErrorCode.MissingContextToken,
        'Weixin context token is missing for this conversation. Wait for an inbound message first.',
      );
    }

    const mediaMarkers = parseMediaMarkers(text);
    const plainText = stripMediaMarkers(text, mediaMarkers).trim();
    const outboundText = plainText || (mediaMarkers.length === 0 ? text.trim() : '');
    if (!outboundText && mediaMarkers.length === 0) {
      throw new Error('Weixin outbound text is empty.');
    }

    const hasActiveTyping = this.activeTypingConversations.has(normalizedConversationId);
    if (!hasActiveTyping) {
      await this.sendTypingStateBestEffort(
        normalizedConversationId,
        contextToken,
        WeixinTypingStatus.Start,
      );
    }

    try {
      if (outboundText) {
        for (const chunk of this.chunkText(outboundText, WeixinGatewayDefaults.TextChunkLimit)) {
          await this.sendTextMessage(normalizedConversationId, contextToken, chunk);
        }
      }

      for (const marker of mediaMarkers) {
        await this.sendMediaMarkerMessage(normalizedConversationId, contextToken, marker);
      }
    } finally {
      if (!hasActiveTyping) {
        await this.sendTypingStateBestEffort(
          normalizedConversationId,
          contextToken,
          WeixinTypingStatus.Stop,
        );
      }
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
    await this.sendMessageItems(toUserId, contextToken, [
      {
        type: WeixinItemType.Text,
        text_item: { text },
      },
    ], WeixinMessageState.Finish);
  }

  private async sendMessageItems(
    toUserId: string,
    contextToken: string,
    items: WeixinMessageItem[],
    messageState: number = WeixinMessageState.Finish,
  ): Promise<void> {
    if (!this.credential) {
      throw new Error('Weixin credential is missing.');
    }

    const response = await this.fetchWithTimeout(this.credential.baseUrl, '/ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: randomUUID(),
        message_type: WeixinMessageType.Bot,
        message_state: messageState,
        context_token: contextToken,
        item_list: items,
      },
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: this.credential.token,
      timeoutMs: WeixinGatewayDefaults.ApiTimeoutMs,
    });

    this.assertSendMessageResponse(response as WeixinSendMessageResponse);
  }

  private async fetchTypingTicket(
    toUserId: string,
    contextToken: string,
  ): Promise<string | null> {
    if (!this.credential) {
      throw new Error('Weixin credential is missing.');
    }

    const response = await this.fetchWithTimeout(this.credential.baseUrl, '/ilink/bot/getconfig', {
      ilink_user_id: toUserId,
      context_token: contextToken,
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: this.credential.token,
      timeoutMs: WeixinGatewayDefaults.ApiTimeoutMs,
    });

    const payload = response as WeixinGetConfigResponse;
    this.assertSendTypingResponse(payload, 'getconfig');
    const typingTicket = payload.typing_ticket?.trim() || '';
    if (!typingTicket) {
      return null;
    }
    return typingTicket;
  }

  private async sendTypingState(
    toUserId: string,
    typingTicket: string,
    status: number,
  ): Promise<void> {
    if (!this.credential) {
      throw new Error('Weixin credential is missing.');
    }

    const response = await this.fetchWithTimeout(this.credential.baseUrl, '/ilink/bot/sendtyping', {
      ilink_user_id: toUserId,
      typing_ticket: typingTicket,
      status,
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: this.credential.token,
      timeoutMs: WeixinGatewayDefaults.ApiTimeoutMs,
    });
    this.assertSendTypingResponse(response as WeixinSendTypingResponse, 'sendtyping');
  }

  private async sendTypingStateBestEffort(
    toUserId: string,
    contextToken: string,
    status: number,
  ): Promise<boolean> {
    try {
      const typingTicket = await this.fetchTypingTicket(toUserId, contextToken);
      if (!typingTicket) {
        console.debug('[YdWeixinGateway] getconfig returned no typing ticket, skipping typing update');
        return false;
      }
      await this.sendTypingState(toUserId, typingTicket, status);
      return true;
    } catch (error) {
      console.debug('[YdWeixinGateway] Failed to send typing state; continuing reply flow:', error);
      return false;
    }
  }

  private assertSendTypingResponse(
    payload: WeixinGetConfigResponse | WeixinSendTypingResponse,
    endpoint: string,
  ): void {
    const errorCode = payload.errcode ?? payload.ret ?? 0;
    if (errorCode !== 0) {
      if (errorCode === WeixinGatewayDefaults.SessionExpiredCode) {
        throw new WeixinGatewayError(
          WeixinGatewayErrorCode.SessionExpired,
          'Weixin session expired. Please login again.',
          payload.errmsg,
        );
      }
      throw new WeixinGatewayError(
        WeixinGatewayErrorCode.ApiError,
        `Weixin ${endpoint} failed: ${payload.errmsg || errorCode}`,
        payload.errmsg,
      );
    }
  }

  private assertSendMessageResponse(payload: WeixinSendMessageResponse): void {
    const errorCode = payload.errcode ?? payload.ret ?? 0;
    if (errorCode !== 0) {
      if (errorCode === WeixinGatewayDefaults.SessionExpiredCode) {
        throw new WeixinGatewayError(
          WeixinGatewayErrorCode.SessionExpired,
          'Weixin session expired. Please login again.',
          payload.errmsg,
        );
      }
      throw new WeixinGatewayError(
        WeixinGatewayErrorCode.ApiError,
        `Weixin sendmessage failed: ${payload.errmsg || errorCode}`,
        payload.errmsg,
      );
    }
  }

  private async sendMediaMarkerMessage(
    toUserId: string,
    contextToken: string,
    marker: MediaMarker,
  ): Promise<void> {
    const prepared = await this.prepareOutboundMediaFile(marker.path);
    try {
      const preferredKind = this.resolveMediaKind(marker, prepared.filePath);
      const kindsToTry: WeixinOutboundMediaKind[] = preferredKind === WeixinOutboundMediaKind.Voice
        ? [WeixinOutboundMediaKind.Voice, WeixinOutboundMediaKind.File]
        : [preferredKind];
      let lastError: unknown = null;

      for (const kind of kindsToTry) {
        try {
          const uploaded = await this.uploadMediaToCdn({
            filePath: prepared.filePath,
            toUserId,
            mediaType: this.resolveUploadMediaType(kind),
          });
          const item = this.buildMediaItem(kind, uploaded, prepared.filePath, marker.name);
          await this.sendMessageItems(toUserId, contextToken, [item]);
          return;
        } catch (error) {
          lastError = error;
          if (kind !== WeixinOutboundMediaKind.Voice) {
            throw error;
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to send Weixin media item');
    } finally {
      if (prepared.tempFilePath) {
        await fs.rm(prepared.tempFilePath, { force: true }).catch(() => {});
      }
    }
  }

  private buildMediaItem(
    kind: WeixinOutboundMediaKind,
    uploaded: WeixinUploadedMedia,
    filePath: string,
    explicitName?: string,
  ): WeixinMessageItem {
    const media = {
      encrypt_query_param: uploaded.downloadEncryptedQueryParam,
      aes_key: uploaded.aesKeyBase64,
      encrypt_type: 1,
    };

    if (kind === WeixinOutboundMediaKind.Image) {
      return {
        type: WeixinItemType.Image,
        image_item: {
          media,
          mid_size: uploaded.fileSizeCiphertext,
        },
      };
    }

    if (kind === WeixinOutboundMediaKind.Video) {
      return {
        type: WeixinItemType.Video,
        video_item: {
          media,
          video_size: uploaded.fileSizeCiphertext,
        },
      };
    }

    if (kind === WeixinOutboundMediaKind.Voice) {
      const extension = path.extname(filePath).replace('.', '').toLowerCase();
      return {
        type: WeixinItemType.Voice,
        voice_item: {
          media,
          encode_type: WeixinVoiceEncodeTypeByExtension[extension] ?? undefined,
        },
      };
    }

    const fileName = explicitName?.trim() || path.basename(filePath);
    return {
      type: WeixinItemType.File,
      file_item: {
        media,
        file_name: fileName,
        len: String(uploaded.fileSize),
      },
    };
  }

  private resolveUploadMediaType(kind: WeixinOutboundMediaKind): WeixinUploadMediaType {
    if (kind === WeixinOutboundMediaKind.Image) {
      return WeixinUploadMediaType.Image;
    }
    if (kind === WeixinOutboundMediaKind.Video) {
      return WeixinUploadMediaType.Video;
    }
    if (kind === WeixinOutboundMediaKind.Voice) {
      return WeixinUploadMediaType.Voice;
    }
    return WeixinUploadMediaType.File;
  }

  private resolveMediaKind(marker: MediaMarker, filePath: string): WeixinOutboundMediaKind {
    if (marker.type === 'image') {
      return WeixinOutboundMediaKind.Image;
    }
    if (marker.type === 'video') {
      return WeixinOutboundMediaKind.Video;
    }
    if (marker.type === 'audio') {
      return WeixinOutboundMediaKind.Voice;
    }
    if (marker.type === 'file') {
      const extension = path.extname(filePath).replace('.', '').toLowerCase();
      if (['mp3', 'wav', 'ogg', 'amr', 'm4a', 'aac', 'pcm', 'silk', 'speex'].includes(extension)) {
        return WeixinOutboundMediaKind.Voice;
      }
      if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(extension)) {
        return WeixinOutboundMediaKind.Image;
      }
      if (['mp4', 'mov', 'm4v', 'webm'].includes(extension)) {
        return WeixinOutboundMediaKind.Video;
      }
    }
    return WeixinOutboundMediaKind.File;
  }

  private async prepareOutboundMediaFile(sourcePath: string): Promise<{
    filePath: string;
    tempFilePath: string | null;
  }> {
    const normalized = this.normalizeMediaPath(sourcePath);
    if (!normalized) {
      throw new Error('Weixin media path is empty.');
    }
    if (/^https?:\/\//i.test(normalized)) {
      const tempFilePath = await this.downloadRemoteMediaToTemp(normalized);
      return { filePath: tempFilePath, tempFilePath };
    }

    const absolutePath = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(normalized);
    await fs.access(absolutePath);
    return { filePath: absolutePath, tempFilePath: null };
  }

  private normalizeMediaPath(input: string): string {
    const value = input.trim();
    if (!value) {
      return value;
    }
    if (value.startsWith('~/')) {
      return path.join(os.homedir(), value.slice(2));
    }
    if (value.startsWith('file://')) {
      try {
        return decodeURIComponent(value.replace(/^file:\/\//, ''));
      } catch {
        return value.replace(/^file:\/\//, '');
      }
    }
    return value;
  }

  private async downloadRemoteMediaToTemp(url: string): Promise<string> {
    const safeUrl = await this.assertSafeRemoteMediaUrl(url);
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      WeixinGatewayDefaults.RemoteMediaDownloadTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(safeUrl.toString(), {
        signal: timeoutController.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Weixin media download failed: HTTP ${response.status}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (
        Number.isFinite(contentLength)
        && contentLength > WeixinGatewayDefaults.RemoteMediaMaxBytes
      ) {
        throw new Error('Weixin media download exceeds max allowed size.');
      }
    }

    const buffer = await this.readResponseBodyWithLimit(
      response,
      WeixinGatewayDefaults.RemoteMediaMaxBytes,
    );
    const pathname = safeUrl.pathname;
    const extension = path.extname(pathname) || '.bin';
    const tempDir = path.join(os.tmpdir(), WeixinGatewayDefaults.RemoteMediaDir);
    await fs.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, `${Date.now()}-${randomUUID()}${extension}`);
    await fs.writeFile(tempFilePath, buffer);
    return tempFilePath;
  }

  private async readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) {
      return Buffer.alloc(0);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw new Error('Weixin media download exceeds max allowed size.');
      }
      chunks.push(chunk);
    }

    return Buffer.concat(chunks, totalBytes);
  }

  private async assertSafeRemoteMediaUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('Invalid remote media URL.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP(S) remote media URLs are allowed.');
    }

    const host = parsed.hostname.trim().toLowerCase();
    const hostForIpCheck = this.normalizeUrlHostname(host);
    if (!host) {
      throw new Error('Remote media URL hostname is empty.');
    }
    if (hostForIpCheck === 'localhost' || hostForIpCheck.endsWith('.localhost')) {
      throw new Error('Remote media URL points to localhost, which is not allowed.');
    }

    const ipVersion = net.isIP(hostForIpCheck);
    if (ipVersion && this.isPrivateOrInternalIp(hostForIpCheck)) {
      throw new Error('Remote media URL points to a private/internal IP, which is not allowed.');
    }

    if (!ipVersion) {
      const addresses = await dnsPromises.lookup(hostForIpCheck, { all: true, verbatim: true });
      if (!addresses.length) {
        throw new Error('Remote media URL hostname cannot be resolved.');
      }
      for (const address of addresses) {
        if (this.isPrivateOrInternalIp(address.address)) {
          throw new Error('Remote media URL resolves to a private/internal IP, which is not allowed.');
        }
      }
    }

    return parsed;
  }

  private normalizeUrlHostname(hostname: string): string {
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      return hostname.slice(1, -1);
    }
    return hostname;
  }

  private extractMappedIpv4FromIpv6(ipv6: string): string | null {
    if (!ipv6.startsWith('::ffff:')) {
      return null;
    }
    const mapped = ipv6.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      return mapped;
    }
    const parts = mapped.split(':');
    if (parts.length === 2 && /^[0-9a-f]{1,4}$/i.test(parts[0]) && /^[0-9a-f]{1,4}$/i.test(parts[1])) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      if (Number.isNaN(high) || Number.isNaN(low)) {
        return null;
      }
      return [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
      ].join('.');
    }
    return null;
  }

  private isPrivateOrInternalIp(ip: string): boolean {
    if (ip.includes('%')) {
      return true;
    }
    const normalized = ip.toLowerCase();
    const mappedIpv4 = this.extractMappedIpv4FromIpv6(normalized);
    if (mappedIpv4) {
      return this.isPrivateOrInternalIp(mappedIpv4);
    }
    const version = net.isIP(normalized);
    if (version === 4) {
      const parts = normalized.split('.').map((part) => Number(part));
      if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return true;
      }
      const [a, b] = parts;
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a >= 224) return true;
      return false;
    }
    if (version === 6) {
      if (normalized === '::1' || normalized === '::') return true;
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
      if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
      if (normalized.startsWith('ff')) return true;
      return false;
    }
    return true;
  }

  private async uploadMediaToCdn(params: {
    filePath: string;
    toUserId: string;
    mediaType: WeixinUploadMediaType;
  }): Promise<WeixinUploadedMedia> {
    if (!this.credential) {
      throw new Error('Weixin credential is missing.');
    }

    const plainBuffer = await fs.readFile(params.filePath);
    const rawSize = plainBuffer.length;
    const rawFileMd5 = createHash('md5').update(plainBuffer).digest('hex');
    const fileSizeCiphertext = this.aesEcbPaddedSize(rawSize);
    const fileKey = randomBytes(16).toString('hex');
    const aesKey = randomBytes(16);
    const aesKeyHex = aesKey.toString('hex');
    const uploadUrlResponse = await this.fetchWithTimeout(this.credential.baseUrl, '/ilink/bot/getuploadurl', {
      filekey: fileKey,
      media_type: params.mediaType,
      to_user_id: params.toUserId,
      rawsize: rawSize,
      rawfilemd5: rawFileMd5,
      filesize: fileSizeCiphertext,
      no_need_thumb: true,
      aeskey: aesKeyHex,
      base_info: {
        channel_version: '1.0.0',
      },
    }, {
      token: this.credential.token,
      timeoutMs: WeixinGatewayDefaults.ApiTimeoutMs,
    });
    const payload = uploadUrlResponse as WeixinGetUploadUrlResponse;
    const uploadParam = payload.upload_param?.trim() || '';
    if (!uploadParam) {
      throw new Error(`Weixin getuploadurl failed: ${payload.errmsg || 'upload_param is empty'}`);
    }

    const downloadEncryptedQueryParam = await this.uploadBufferToCdn({
      plainBuffer,
      uploadParam,
      fileKey,
      aesKey,
    });
    return {
      downloadEncryptedQueryParam,
      aesKeyBase64: aesKey.toString('base64'),
      fileSize: rawSize,
      fileSizeCiphertext,
    };
  }

  private async uploadBufferToCdn(params: {
    plainBuffer: Buffer;
    uploadParam: string;
    fileKey: string;
    aesKey: Buffer;
  }): Promise<string> {
    const ciphertext = this.encryptAesEcb(params.plainBuffer, params.aesKey);
    const uploadUrl = `${WeixinGatewayDefaults.CdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.fileKey)}`;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= WeixinGatewayDefaults.CdnUploadMaxRetries; attempt += 1) {
      try {
        const response = await this.fetchCdnBinary(uploadUrl, ciphertext, WeixinGatewayDefaults.CdnUploadTimeoutMs);
        if (response.status >= 400 && response.status < 500) {
          const body = await response.text();
          throw new Error(`Weixin CDN upload client error ${response.status}: ${body}`);
        }
        if (response.status !== 200) {
          const body = await response.text();
          throw new Error(`Weixin CDN upload server error ${response.status}: ${body}`);
        }
        const downloadParam = response.headers.get('x-encrypted-param')?.trim() || '';
        if (!downloadParam) {
          throw new Error('Weixin CDN upload response missing x-encrypted-param');
        }
        return downloadParam;
      } catch (error) {
        lastError = error;
        if (attempt < WeixinGatewayDefaults.CdnUploadMaxRetries) {
          continue;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Weixin CDN upload failed.');
  }

  private async fetchCdnBinary(url: string, payload: Buffer, timeoutMs: number): Promise<Response> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(payload),
        signal: timeoutController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private encryptAesEcb(plainBuffer: Buffer, key: Buffer): Buffer {
    const cipher = createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  }

  private aesEcbPaddedSize(plainSize: number): number {
    return Math.ceil((plainSize + 1) / 16) * 16;
  }

  private async handleRawMessage(raw: WeixinRawMessage): Promise<void> {
    const normalized = await this.normalizeInboundMessage(raw);
    if (!normalized) {
      return;
    }

    this.contextTokens.set(normalized.conversationId, normalized.contextToken);
    this.emit('contextToken', {
      accountId: this.credential?.accountId ?? '',
      conversationId: normalized.conversationId,
      contextToken: normalized.contextToken,
      updatedAt: Date.now(),
    });
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
      chatType: normalized.chatType,
      timestamp: normalized.timestamp,
      attachments: normalized.attachments.length > 0 ? normalized.attachments : undefined,
    };

    this.emit('message', message);
    this.emit('status', this.getStatus());

    if (!this.onMessageCallback) {
      return;
    }

    const hasActiveTyping = this.activeTypingConversations.has(normalized.conversationId);
    let startedTypingInCallbackFlow = false;
    if (!hasActiveTyping) {
      const started = await this.sendTypingStateBestEffort(
        normalized.conversationId,
        normalized.contextToken,
        WeixinTypingStatus.Start,
      );
      if (started) {
        this.activeTypingConversations.add(normalized.conversationId);
        startedTypingInCallbackFlow = true;
      }
    }

    const replyFn = async (text: string): Promise<void> => {
      await this.sendConversationNotification(normalized.conversationId, text);
    };
    try {
      await this.onMessageCallback(message, replyFn);
    } finally {
      if (startedTypingInCallbackFlow && this.activeTypingConversations.has(normalized.conversationId)) {
        await this.sendTypingStateBestEffort(
          normalized.conversationId,
          normalized.contextToken,
          WeixinTypingStatus.Stop,
        );
        this.activeTypingConversations.delete(normalized.conversationId);
      }
    }
  }

  private async normalizeInboundMessage(raw: WeixinRawMessage): Promise<{
    messageId: string;
    conversationId: string;
    senderId: string;
    chatType: IMMessage['chatType'];
    content: string;
    attachments: IMMediaAttachment[];
    timestamp: number;
    contextToken: string;
  } | null> {
    if (raw.message_type !== WeixinMessageType.User) {
      return null;
    }

    const senderId = raw.from_user_id?.trim() || '';
    const contextToken = raw.context_token?.trim() || '';
    if (!senderId || !contextToken) {
      return null;
    }

    const chatType = this.resolveInboundChatType(raw);
    const conversationId = this.resolveInboundConversationId(raw, senderId, chatType);
    if (!conversationId) {
      return null;
    }

    if (!this.isInboundAllowed(senderId, chatType, conversationId)) {
      return null;
    }

    const messageIdValue = raw.message_id;
    const messageId = typeof messageIdValue === 'number'
      ? String(messageIdValue)
      : typeof messageIdValue === 'string'
        ? messageIdValue
        : `${Date.now()}`;

    const { content, attachments } = await this.extractMessageContent(raw.item_list || []);
    const timestamp = typeof raw.create_time_ms === 'number' && Number.isFinite(raw.create_time_ms)
      ? raw.create_time_ms
      : Date.now();

    return {
      messageId,
      conversationId,
      senderId,
      chatType,
      content,
      attachments,
      timestamp,
      contextToken,
    };
  }

  private resolveInboundChatType(raw: WeixinRawMessage): IMMessage['chatType'] {
    const rawChatType = raw.chat_type;
    if (typeof rawChatType === 'string') {
      const normalized = rawChatType.trim().toLowerCase();
      if (normalized.includes('group') || normalized.includes('chatroom') || normalized.includes('room')) {
        return WeixinChatType.Group;
      }
      if (normalized.includes('direct') || normalized.includes('single') || normalized.includes('private')) {
        return WeixinChatType.Direct;
      }
    }

    const groupCandidates = [
      raw.group_id,
      raw.room_id,
      raw.chat_id,
      this.isChatroomIdentifier(raw.to_user_id) ? raw.to_user_id : '',
      this.isChatroomIdentifier(raw.conversation_id) ? raw.conversation_id : '',
      this.isChatroomIdentifier(raw.from_user_id) ? raw.from_user_id : '',
    ];
    if (groupCandidates.some((value) => (value || '').trim())) {
      return WeixinChatType.Group;
    }

    return WeixinChatType.Direct;
  }

  private resolveInboundConversationId(
    raw: WeixinRawMessage,
    senderId: string,
    chatType: IMMessage['chatType'],
  ): string {
    if (chatType === WeixinChatType.Group) {
      const candidates = [
        raw.group_id,
        raw.room_id,
        raw.chat_id,
        this.isChatroomIdentifier(raw.conversation_id) ? raw.conversation_id : '',
        this.isChatroomIdentifier(raw.to_user_id) ? raw.to_user_id : '',
        this.isChatroomIdentifier(raw.from_user_id) ? raw.from_user_id : '',
      ];
      for (const candidate of candidates) {
        const normalized = candidate?.trim() || '';
        if (normalized) {
          return normalized;
        }
      }
      return '';
    }

    return senderId;
  }

  private isChatroomIdentifier(value: string | undefined): boolean {
    const normalized = value?.trim() || '';
    if (!normalized) {
      return false;
    }
    return normalized.endsWith('@chatroom') || normalized.startsWith('chatroom_');
  }

  private async extractMessageContent(items: WeixinMessageItem[]): Promise<{
    content: string;
    attachments: IMMediaAttachment[];
  }> {
    const parts: string[] = [];
    const attachments: IMMediaAttachment[] = [];
    for (const item of items) {
      if (item.type === WeixinItemType.Text) {
        const normalized = this.normalizeInboundTextContent(item.text_item?.text || '');
        if (normalized) {
          parts.push(normalized);
        }
        continue;
      }

      if (item.type === WeixinItemType.Image) {
        const normalized = await this.normalizeInboundImageContent(item, attachments);
        if (normalized) {
          parts.push(normalized);
        }
        continue;
      }

      if (item.type === WeixinItemType.Voice) {
        parts.push(this.normalizeInboundVoiceContent(item));
        continue;
      }

      if (item.type === WeixinItemType.File) {
        parts.push(this.normalizeInboundFileContent(item));
        continue;
      }

      if (item.type === WeixinItemType.Video) {
        parts.push(WeixinInboundPlaceholder.Video);
      }
    }

    return {
      content: parts.join('\n').trim() || '[empty]',
      attachments,
    };
  }

  private normalizeInboundTextContent(text: string): string {
    const normalized = text.trim();
    if (!normalized) {
      return '';
    }
    if (this.isLikelyHexPayload(normalized)) {
      return WeixinInboundPlaceholder.Binary;
    }
    return normalized;
  }

  private async normalizeInboundImageContent(
    item: WeixinMessageItem,
    attachments: IMMediaAttachment[],
  ): Promise<string> {
    const mediaMarkdown = await this.tryNormalizeInboundImageFromMedia(item, attachments);
    if (mediaMarkdown) {
      return mediaMarkdown;
    }

    const imageUrl = item.image_item?.url?.trim() || '';
    if (
      imageUrl
      && this.isDisplayableRemoteUrl(imageUrl)
      && !this.isLikelyHexPayload(imageUrl)
      && !this.isWeixinCdnUrl(imageUrl)
    ) {
      return `![image](${imageUrl})`;
    }

    return WeixinInboundPlaceholder.Image;
  }

  private normalizeInboundVoiceContent(item: WeixinMessageItem): string {
    const transcript = this.normalizeInboundTextContent(item.voice_item?.text || '');
    if (transcript && transcript !== WeixinInboundPlaceholder.Binary) {
      return transcript;
    }
    return WeixinInboundPlaceholder.Voice;
  }

  private normalizeInboundFileContent(item: WeixinMessageItem): string {
    const fileName = this.normalizeInboundTextContent(item.file_item?.file_name || '');
    if (fileName && fileName !== WeixinInboundPlaceholder.Binary) {
      return fileName;
    }
    return WeixinInboundPlaceholder.File;
  }

  private isLikelyHexPayload(value: string): boolean {
    const compact = value.replace(/\s+/g, '');
    if (!compact || compact.length < WeixinInboundMessageDefaults.HexPayloadMinLength) {
      return false;
    }
    if (compact.length % 2 !== 0) {
      return false;
    }
    return /^[0-9a-f]+$/i.test(compact);
  }

  private isDisplayableRemoteUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private isWeixinCdnUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      const hostname = parsed.hostname.trim().toLowerCase();
      return hostname.endsWith('cdn.weixin.qq.com');
    } catch {
      return false;
    }
  }

  private async tryNormalizeInboundImageFromMedia(
    item: WeixinMessageItem,
    attachments: IMMediaAttachment[],
  ): Promise<string | null> {
    const media = item.image_item?.media;
    const encryptedQuery = media?.encrypted_query_param?.trim()
      || media?.encrypt_query_param?.trim()
      || '';
    if (!encryptedQuery || this.isLikelyHexPayload(encryptedQuery)) {
      return null;
    }

    const aesKey = media?.aes_key?.trim() || '';
    if (!aesKey || this.isLikelyHexPayload(aesKey)) {
      return null;
    }

    try {
      const downloaded = await this.downloadAndStoreInboundImage({
        encryptedQuery,
        aesKeyBase64: aesKey,
      });
      attachments.push({
        type: 'image',
        localPath: downloaded.localPath,
        mimeType: downloaded.mimeType,
        fileName: path.basename(downloaded.localPath),
        fileSize: downloaded.fileSize,
      });
      return `![image](${pathToFileURL(downloaded.localPath).toString()})`;
    } catch (error) {
      console.warn('[YdWeixinGateway] failed to decode inbound image media, using placeholder:', error);
      return null;
    }
  }

  private async downloadAndStoreInboundImage(params: {
    encryptedQuery: string;
    aesKeyBase64: string;
  }): Promise<{
    localPath: string;
    mimeType: string;
    fileSize: number;
  }> {
    const downloadUrl = this.buildInboundImageDownloadUrl(
      params.encryptedQuery,
      params.aesKeyBase64,
    );
    const safeUrl = await this.assertSafeRemoteMediaUrl(downloadUrl);

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      WeixinGatewayDefaults.RemoteMediaDownloadTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(safeUrl.toString(), {
        method: 'GET',
        signal: timeoutController.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Weixin inbound image download failed: HTTP ${response.status}`);
    }

    const encryptedBuffer = await this.readResponseBodyWithLimit(
      response,
      WeixinGatewayDefaults.RemoteMediaMaxBytes,
    );
    const decryptedBuffer = this.decryptInboundMediaPayload(encryptedBuffer, params.aesKeyBase64);
    const inferred = this.inferInboundImageFileInfo(decryptedBuffer);

    const mediaDir = path.join(os.tmpdir(), WeixinGatewayDefaults.InboundMediaDir);
    await fs.mkdir(mediaDir, { recursive: true });

    const localPath = path.join(
      mediaDir,
      `${Date.now()}-${randomUUID()}${inferred.extension}`,
    );
    await fs.writeFile(localPath, decryptedBuffer);

    return {
      localPath,
      mimeType: inferred.mimeType,
      fileSize: decryptedBuffer.length,
    };
  }

  private buildInboundImageDownloadUrl(encryptedQuery: string, aesKeyBase64: string): string {
    const downloadBase = `${WeixinGatewayDefaults.CdnBaseUrl}/download`;
    let query = encryptedQuery.trim().replace(/^\?+/, '');

    if (!query.includes('=')) {
      query = `encrypted_query_param=${encodeURIComponent(query)}`;
    } else {
      query = query.replace(/(^|&)encrypt_query_param=/i, '$1encrypted_query_param=');
      if (!/(^|&)encrypted_query_param=/i.test(query)) {
        query = `encrypted_query_param=${encodeURIComponent(query)}`;
      }
    }

    if (aesKeyBase64 && !/(^|&)aes_key=/i.test(query)) {
      query = `${query}&aes_key=${encodeURIComponent(aesKeyBase64)}`;
    }
    return `${downloadBase}?${query}`;
  }

  private decryptInboundMediaPayload(encryptedBuffer: Buffer, aesKeyBase64: string): Buffer {
    const keyBuffer = this.decodeInboundAesKey(aesKeyBase64);

    try {
      const decipher = createDecipheriv('aes-128-ecb', keyBuffer, null);
      decipher.setAutoPadding(true);
      return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    } catch (error) {
      if (this.isLikelyImageBuffer(encryptedBuffer)) {
        return encryptedBuffer;
      }
      throw error;
    }
  }

  private decodeInboundAesKey(rawValue: string): Buffer {
    const decoded = this.decodeBase64Loose(rawValue);
    if (decoded.length === 16) {
      return decoded;
    }

    const decodedAscii = decoded.toString('ascii').trim();
    if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decodedAscii)) {
      return Buffer.from(decodedAscii, 'hex');
    }

    const normalizedRaw = rawValue.trim();
    if (/^[0-9a-f]{32}$/i.test(normalizedRaw)) {
      return Buffer.from(normalizedRaw, 'hex');
    }

    throw new Error(`Invalid Weixin aes key length: ${decoded.length}`);
  }

  private decodeBase64Loose(rawValue: string): Buffer {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw new Error('Weixin aes key is empty.');
    }
    let normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const paddingLength = normalized.length % 4;
    if (paddingLength > 0) {
      normalized = `${normalized}${'='.repeat(4 - paddingLength)}`;
    }
    return Buffer.from(normalized, 'base64');
  }

  private inferInboundImageFileInfo(buffer: Buffer): { extension: string; mimeType: string } {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      return { extension: '.png', mimeType: 'image/png' };
    }
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
      return { extension: '.jpg', mimeType: 'image/jpeg' };
    }
    if (buffer.length >= 6) {
      const header6 = buffer.subarray(0, 6).toString('ascii');
      if (header6 === 'GIF87a' || header6 === 'GIF89a') {
        return { extension: '.gif', mimeType: 'image/gif' };
      }
    }
    if (
      buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { extension: '.webp', mimeType: 'image/webp' };
    }
    if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
      return { extension: '.bmp', mimeType: 'image/bmp' };
    }

    return { extension: '.bin', mimeType: 'application/octet-stream' };
  }

  private isLikelyImageBuffer(buffer: Buffer): boolean {
    const inferred = this.inferInboundImageFileInfo(buffer);
    return inferred.mimeType.startsWith('image/');
  }

  private isInboundAllowed(
    senderId: string,
    chatType: IMMessage['chatType'],
    conversationId: string,
  ): boolean {
    if (!this.config) {
      return false;
    }

    if (chatType === WeixinChatType.Group) {
      if (this.config.groupPolicy === WeixinPolicy.Disabled) {
        return false;
      }

      if (this.config.groupPolicy === WeixinPolicy.Allowlist) {
        return this.config.groupAllowFrom.includes(conversationId);
      }

      return true;
    }

    if (this.config.dmPolicy === WeixinPolicy.Disabled) {
      return false;
    }

    if (this.config.dmPolicy === WeixinPolicy.Allowlist) {
      return this.config.allowFrom.includes(senderId);
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
