import { randomUUID } from 'crypto';

const WeixinAuthDefaults = {
  BaseUrl: 'https://ilinkai.weixin.qq.com',
  BotType: '3',
  SessionTtlMs: 5 * 60_000,
  QrStatusTimeoutMs: 35_000,
  WaitTimeoutMs: 8 * 60_000,
  WaitRetryDelayMs: 300,
} as const;

const WeixinQrStatus = {
  Wait: 'wait',
  Scanned: 'scaned',
  Confirmed: 'confirmed',
  Expired: 'expired',
} as const;

type WeixinQrStatus = typeof WeixinQrStatus[keyof typeof WeixinQrStatus];

const WeixinAuthErrorCode = {
  StartFailed: 'start_failed',
  SessionNotFound: 'session_not_found',
  SessionExpired: 'session_expired',
  WaitTimeout: 'wait_timeout',
  PollFailed: 'poll_failed',
  InvalidConfirmedPayload: 'invalid_confirmed_payload',
} as const;

export type WeixinAuthErrorCode = typeof WeixinAuthErrorCode[keyof typeof WeixinAuthErrorCode];

export interface WeixinQrCredential {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
}

export interface WeixinQrStartResult {
  ok: boolean;
  sessionKey?: string;
  qrDataUrl?: string;
  errorCode?: WeixinAuthErrorCode;
  errorDetail?: string;
}

export interface WeixinQrWaitResult {
  connected: boolean;
  accountId?: string;
  credential?: WeixinQrCredential;
  errorCode?: WeixinAuthErrorCode;
  errorDetail?: string;
}

interface ActiveLoginSession {
  sessionKey: string;
  baseUrl: string;
  qrcode: string;
  qrDataUrl: string;
  createdAt: number;
}

interface WeixinQrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}

interface WeixinQrStatusResponse {
  status?: WeixinQrStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

export class YdWeixinAuth {
  private readonly sessions = new Map<string, ActiveLoginSession>();

  async startLogin(options?: { baseUrl?: string; force?: boolean; sessionKey?: string }): Promise<WeixinQrStartResult> {
    this.purgeExpiredSessions();
    const sessionKey = options?.sessionKey?.trim() || randomUUID();
    const normalizedBaseUrl = this.normalizeBaseUrl(options?.baseUrl || WeixinAuthDefaults.BaseUrl);

    if (!options?.force) {
      const existing = this.sessions.get(sessionKey);
      if (existing && this.isSessionActive(existing)) {
        return {
          ok: true,
          sessionKey,
          qrDataUrl: existing.qrDataUrl,
        };
      }
    }

    try {
      const response = await this.fetchQrCode(normalizedBaseUrl);
      const qrcode = response?.qrcode?.trim() || '';
      const qrDataUrl = response?.qrcode_img_content?.trim() || '';
      if (!qrcode || !qrDataUrl) {
        return {
          ok: false,
          errorCode: WeixinAuthErrorCode.StartFailed,
          errorDetail: 'qr_response_missing_fields',
        };
      }

      this.sessions.set(sessionKey, {
        sessionKey,
        baseUrl: normalizedBaseUrl,
        qrcode,
        qrDataUrl,
        createdAt: Date.now(),
      });

      return {
        ok: true,
        sessionKey,
        qrDataUrl,
      };
    } catch (error) {
      return {
        ok: false,
        errorCode: WeixinAuthErrorCode.StartFailed,
        errorDetail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async waitLogin(sessionKey: string, options?: { timeoutMs?: number }): Promise<WeixinQrWaitResult> {
    this.purgeExpiredSessions();

    const normalizedSessionKey = sessionKey.trim();
    const session = this.sessions.get(normalizedSessionKey);
    if (!session) {
      return {
        connected: false,
        errorCode: WeixinAuthErrorCode.SessionNotFound,
      };
    }

    if (!this.isSessionActive(session)) {
      this.sessions.delete(normalizedSessionKey);
      return {
        connected: false,
        errorCode: WeixinAuthErrorCode.SessionExpired,
      };
    }

    const timeoutMs = Math.max(1_000, options?.timeoutMs ?? WeixinAuthDefaults.WaitTimeoutMs);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const status = await this.pollQrStatus(session.baseUrl, session.qrcode);
        switch (status.status) {
          case WeixinQrStatus.Wait:
          case WeixinQrStatus.Scanned:
            break;
          case WeixinQrStatus.Expired:
            this.sessions.delete(normalizedSessionKey);
            return {
              connected: false,
              errorCode: WeixinAuthErrorCode.SessionExpired,
            };
          case WeixinQrStatus.Confirmed: {
            const token = status.bot_token?.trim() || '';
            const accountId = status.ilink_bot_id?.trim() || '';
            const userId = status.ilink_user_id?.trim() || '';
            if (!token || !accountId || !userId) {
              this.sessions.delete(normalizedSessionKey);
              return {
                connected: false,
                errorCode: WeixinAuthErrorCode.InvalidConfirmedPayload,
                errorDetail: 'missing_bot_token_or_account_or_user',
              };
            }

            this.sessions.delete(normalizedSessionKey);
            return {
              connected: true,
              accountId,
              credential: {
                token,
                accountId,
                userId,
                baseUrl: this.normalizeBaseUrl(status.baseurl || session.baseUrl),
              },
            };
          }
          default:
            break;
        }
      } catch (error) {
        return {
          connected: false,
          errorCode: WeixinAuthErrorCode.PollFailed,
          errorDetail: error instanceof Error ? error.message : String(error),
        };
      }

      await this.sleep(WeixinAuthDefaults.WaitRetryDelayMs);
    }

    return {
      connected: false,
      errorCode: WeixinAuthErrorCode.WaitTimeout,
    };
  }

  private async fetchQrCode(baseUrl: string): Promise<WeixinQrCodeResponse> {
    const url = new URL(`/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WeixinAuthDefaults.BotType)}`, this.ensureTrailingSlash(baseUrl));
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`wechat_qr_start_http_${response.status}:${body}`);
    }
    return await response.json() as WeixinQrCodeResponse;
  }

  private async pollQrStatus(baseUrl: string, qrcode: string): Promise<WeixinQrStatusResponse> {
    const url = new URL(`/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, this.ensureTrailingSlash(baseUrl));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WeixinAuthDefaults.QrStatusTimeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'iLink-App-ClientVersion': '1',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`wechat_qr_poll_http_${response.status}:${body}`);
      }
      return await response.json() as WeixinQrStatusResponse;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: WeixinQrStatus.Wait };
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private isSessionActive(session: ActiveLoginSession): boolean {
    return Date.now() - session.createdAt < WeixinAuthDefaults.SessionTtlMs;
  }

  private purgeExpiredSessions(): void {
    for (const [sessionKey, session] of this.sessions.entries()) {
      if (!this.isSessionActive(session)) {
        this.sessions.delete(sessionKey);
      }
    }
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '');
  }

  private ensureTrailingSlash(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const WeixinAuthDefaultsConfig = WeixinAuthDefaults;
export const WeixinAuthErrorCodes = WeixinAuthErrorCode;
