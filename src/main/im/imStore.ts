/**
 * IM Gateway Store
 * SQLite operations for IM configuration storage
 */

import type { SqlJsCompatDatabase } from '../sqliteStore';
import {
  IMGatewayConfig,
  DingTalkOpenClawConfig,
  FeishuOpenClawConfig,
  TelegramOpenClawConfig,
  QQConfig,
  DiscordOpenClawConfig,
  NimConfig,
  XiaomifengConfig,
  WecomOpenClawConfig,
  PopoOpenClawConfig,
  WeixinOpenClawConfig,
  WeixinStoredCredential,
  WeixinContextTokenRecord,
  WeixinContextTokenStatus,
  WeixinPendingOutboundRecord,
  WeixinPendingOutboundReason,
  WeixinPendingOutboundStatus,
  IMSettings,
  IMPlatform,
  IMSessionMapping,
  IMSessionRoute,
  DEFAULT_DINGTALK_OPENCLAW_CONFIG,
  DEFAULT_FEISHU_OPENCLAW_CONFIG,
  DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
  DEFAULT_QQ_CONFIG,
  DEFAULT_DISCORD_OPENCLAW_CONFIG,
  DEFAULT_NIM_CONFIG,
  DEFAULT_XIAOMIFENG_CONFIG,
  DEFAULT_WECOM_CONFIG,
  DEFAULT_POPO_CONFIG,
  DEFAULT_WEIXIN_CONFIG,
  DEFAULT_IM_SETTINGS,
} from './types';
import {
  ensureImGatewayMigrationSchema,
  ImGatewayMigrationConfigKey,
  ImGatewayMigrationEnvKey,
  ImGatewayMigrationPhase,
} from './imGatewayMigrations';
import {
  GatewayDeliveryStatus,
  GatewayRoute,
  GatewayRunStatus,
  type GatewayDeliveryStatus as GatewayDeliveryStatusType,
  type GatewayRunStatus as GatewayRunStatusType,
} from './gateway/constants';

interface StoredConversationReplyRoute {
  channel: string;
  to: string;
  accountId?: string;
}

export interface IMOutboundDeliveryRecord {
  id: string;
  runId: string;
  platform: IMPlatform;
  conversationId: string;
  threadId: string | null;
  payloadJson: string;
  status: GatewayDeliveryStatusType;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IMRecoverableGatewayRunRecord {
  runId: string;
  platform: IMPlatform;
  conversationId: string | null;
  routeKey: string;
  coworkSessionId: string;
  status: GatewayRunStatusType;
  startedAt: number;
}

export class IMStore {
  private db: SqlJsCompatDatabase;
  private saveDb: () => void;

  constructor(db: SqlJsCompatDatabase, saveDb: () => void = () => {}) {
    this.db = db;
    this.saveDb = saveDb;
    this.initializeTables();
    this.migrateDefaults();
  }

  private initializeTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // IM session mappings table for Cowork mode
    this.db.run(`
      CREATE TABLE IF NOT EXISTS im_session_mappings (
        im_conversation_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        cowork_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        PRIMARY KEY (im_conversation_id, platform)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS weixin_context_tokens (
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        context_token TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        last_success_at INTEGER,
        last_error_at INTEGER,
        last_error_message TEXT,
        PRIMARY KEY (account_id, conversation_id)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS weixin_pending_outbound (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        text TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expire_at INTEGER NOT NULL,
        sent_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_message TEXT,
        updated_at INTEGER NOT NULL
      );
    `);

    // Migration: Add agent_id column to im_session_mappings
    const mappingCols = this.db.exec('PRAGMA table_info(im_session_mappings)');
    const mappingColNames = (mappingCols[0]?.values ?? []).map((r) => r[1] as string);
    if (!mappingColNames.includes('agent_id')) {
      this.db.run("ALTER TABLE im_session_mappings ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'");
    }

    const storedPhase = this.getConfigValue<string>(ImGatewayMigrationConfigKey.Phase);
    ensureImGatewayMigrationSchema({
      db: this.db,
      saveDb: this.saveDb,
      envPhase: process.env[ImGatewayMigrationEnvKey.Phase],
      storedPhase,
      defaultPhase: ImGatewayMigrationPhase.Phase3,
      persistPhase: (phase) => this.setConfigValue(ImGatewayMigrationConfigKey.Phase, phase),
    });

    this.saveDb();
  }

  /**
   * Migrate existing IM configs to ensure stable defaults.
   */
  private migrateDefaults(): void {
    const platforms = ['dingtalk', 'feishu', 'telegram', 'discord', 'nim', 'xiaomifeng', 'qq', 'wecom', 'popo', 'weixin'] as const;
    let changed = false;

    for (const platform of platforms) {
      const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [platform]);
      if (!result[0]?.values[0]) continue;

      try {
        const config = JSON.parse(result[0].values[0][0] as string);
        if (config.debug === undefined || config.debug === false) {
          config.debug = true;
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(config), now, platform]
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    const settingsResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['settings']);
    if (settingsResult[0]?.values[0]) {
      try {
        const settings = JSON.parse(settingsResult[0].values[0][0] as string) as Partial<IMSettings>;
        // Keep IM and desktop behavior aligned: skills auto-routing should be on by default.
        // Historical renderer default could persist `skillsEnabled: false` unintentionally.
        if (settings.skillsEnabled !== true) {
          settings.skillsEnabled = true;
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(settings), now, 'settings']
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate feishu renderMode from 'text' to 'card' (previous renderer default was incorrect)
    const feishuResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['feishu']);
    if (feishuResult[0]?.values[0]) {
      try {
        const feishuConfig = JSON.parse(feishuResult[0].values[0][0] as string) as Partial<{ renderMode: string }>;
        if (feishuConfig.renderMode === 'text') {
          feishuConfig.renderMode = 'card';
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(feishuConfig), now, 'feishu']
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Telegram config to new OpenClaw format
    const oldTelegramResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['telegram']);
    const newTelegramResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['telegramOpenClaw']);
    if (oldTelegramResult[0]?.values[0] && !newTelegramResult[0]?.values[0]) {
      try {
        const oldConfig = JSON.parse(oldTelegramResult[0].values[0][0] as string) as {
          enabled?: boolean;
          botToken?: string;
          allowedUserIds?: string[];
          debug?: boolean;
        };
        if (oldConfig.botToken) {
          const hasAllowList = Array.isArray(oldConfig.allowedUserIds) && oldConfig.allowedUserIds.length > 0;
          const newConfig = {
            ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botToken: oldConfig.botToken,
            allowFrom: oldConfig.allowedUserIds ?? [],
            dmPolicy: hasAllowList ? 'allowlist' as const : 'pairing' as const,
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.db.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['telegramOpenClaw', JSON.stringify(newConfig), now]
          );
          this.db.run('DELETE FROM im_config WHERE key = ?', ['telegram']);
          changed = true;
          console.log('[IMStore] Migrated old Telegram config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Discord config to new OpenClaw format
    const oldDiscordResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['discord']);
    const newDiscordResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['discordOpenClaw']);
    if (oldDiscordResult[0]?.values[0] && !newDiscordResult[0]?.values[0]) {
      try {
        const oldConfig = JSON.parse(oldDiscordResult[0].values[0][0] as string) as {
          enabled?: boolean;
          botToken?: string;
          debug?: boolean;
        };
        if (oldConfig.botToken) {
          const newConfig = {
            ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botToken: oldConfig.botToken,
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.db.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['discordOpenClaw', JSON.stringify(newConfig), now]
          );
          this.db.run('DELETE FROM im_config WHERE key = ?', ['discord']);
          changed = true;
          console.log('[IMStore] Migrated old Discord config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Feishu config to new OpenClaw format
    const oldFeishuResult2 = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['feishu']);
    const newFeishuResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['feishuOpenClaw']);
    if (oldFeishuResult2[0]?.values[0] && !newFeishuResult[0]?.values[0]) {
      try {
        const oldConfig = JSON.parse(oldFeishuResult2[0].values[0][0] as string) as Partial<{ enabled: boolean; appId: string; appSecret: string; domain: string; debug: boolean }>;
        if (oldConfig.appId) {
          const newConfig: FeishuOpenClawConfig = {
            ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            appId: oldConfig.appId,
            appSecret: oldConfig.appSecret ?? '',
            domain: oldConfig.domain || 'feishu',
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.db.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['feishuOpenClaw', JSON.stringify(newConfig), now]
          );
          this.db.run('DELETE FROM im_config WHERE key = ?', ['feishu']);
          changed = true;
          console.log('[IMStore] Migrated old Feishu config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native DingTalk config to new OpenClaw format
    const oldDingtalkResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['dingtalk']);
    const newDingtalkResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['dingtalkOpenClaw']);
    if (oldDingtalkResult[0]?.values[0] && !newDingtalkResult[0]?.values[0]) {
      try {
        const oldConfig = JSON.parse(oldDingtalkResult[0].values[0][0] as string) as Partial<{ enabled: boolean; clientId: string; clientSecret: string; debug: boolean }>;
        if (oldConfig.clientId) {
          const newConfig: DingTalkOpenClawConfig = {
            ...DEFAULT_DINGTALK_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            clientId: oldConfig.clientId,
            clientSecret: oldConfig.clientSecret ?? '',
            debug: oldConfig.debug ?? false,
          };
          const now = Date.now();
          this.db.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['dingtalkOpenClaw', JSON.stringify(newConfig), now]
          );
          this.db.run('DELETE FROM im_config WHERE key = ?', ['dingtalk']);
          changed = true;
          console.log('[IMStore] Migrated old DingTalk config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native WeCom config to new OpenClaw format
    const oldWecomResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['wecom']);
    const newWecomResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['wecomOpenClaw']);
    if (oldWecomResult[0]?.values[0] && !newWecomResult[0]?.values[0]) {
      try {
        const oldConfig = JSON.parse(oldWecomResult[0].values[0][0] as string) as Partial<{ enabled: boolean; botId: string; secret: string; debug: boolean }>;
        if (oldConfig.botId) {
          const newConfig: WecomOpenClawConfig = {
            ...DEFAULT_WECOM_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botId: oldConfig.botId,
            secret: oldConfig.secret ?? '',
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.db.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['wecomOpenClaw', JSON.stringify(newConfig), now]
          );
          this.db.run('DELETE FROM im_config WHERE key = ?', ['wecom']);
          changed = true;
          console.log('[IMStore] Migrated old WeCom config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate popo configs that have token but no connectionMode:
    // These are existing webhook users from before connectionMode was introduced.
    // Preserve their setup by explicitly setting connectionMode to 'webhook'.
    const popoResult = this.db.exec('SELECT value FROM im_config WHERE key = ?', ['popo']);
    if (popoResult[0]?.values[0]) {
      try {
        const popoConfig = JSON.parse(popoResult[0].values[0][0] as string) as Partial<PopoOpenClawConfig>;
        if (popoConfig.token && !popoConfig.connectionMode) {
          popoConfig.connectionMode = 'webhook';
          const now = Date.now();
          this.db.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(popoConfig), now, 'popo']
          );
          changed = true;
          console.log('[IMStore] Migrated popo config: inferred connectionMode=webhook from existing token');
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (changed) {
      this.saveDb();
    }
  }

  // ==================== Generic Config Operations ====================

  private getConfigValue<T>(key: string): T | undefined {
    const result = this.db.exec('SELECT value FROM im_config WHERE key = ?', [key]);
    if (!result[0]?.values[0]) return undefined;
    const value = result[0].values[0][0] as string;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`Failed to parse im_config value for ${key}`, error);
      return undefined;
    }
  }

  private setConfigValue<T>(key: string, value: T): void {
    const now = Date.now();
    this.db.run(`
      INSERT INTO im_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `, [key, JSON.stringify(value), now]);
    this.saveDb();
  }

  // ==================== Full Config Operations ====================

  getConfig(): IMGatewayConfig {
    const dingtalk = this.getConfigValue<DingTalkOpenClawConfig>('dingtalkOpenClaw') ?? DEFAULT_DINGTALK_OPENCLAW_CONFIG;
    const feishu = this.getConfigValue<FeishuOpenClawConfig>('feishuOpenClaw') ?? DEFAULT_FEISHU_OPENCLAW_CONFIG;
    const telegram = this.getConfigValue<TelegramOpenClawConfig>('telegramOpenClaw') ?? DEFAULT_TELEGRAM_OPENCLAW_CONFIG;
    const discord = this.getConfigValue<DiscordOpenClawConfig>('discordOpenClaw') ?? DEFAULT_DISCORD_OPENCLAW_CONFIG;
    const nim = this.getConfigValue<NimConfig>('nim') ?? DEFAULT_NIM_CONFIG;
    const xiaomifeng = this.getConfigValue<XiaomifengConfig>('xiaomifeng') ?? DEFAULT_XIAOMIFENG_CONFIG;
    const qq = this.getConfigValue<QQConfig>('qq') ?? DEFAULT_QQ_CONFIG;
    const wecom = this.getConfigValue<WecomOpenClawConfig>('wecomOpenClaw') ?? DEFAULT_WECOM_CONFIG;
    const popo = this.getConfigValue<PopoOpenClawConfig>('popo') ?? DEFAULT_POPO_CONFIG;
    const weixin = this.getConfigValue<WeixinOpenClawConfig>('weixin') ?? DEFAULT_WEIXIN_CONFIG;
    const settings = this.getConfigValue<IMSettings>('settings') ?? DEFAULT_IM_SETTINGS;

    // Resolve enabled field: default to false for safety
    // User must explicitly enable the service by setting enabled: true
    const resolveEnabled = <T extends { enabled?: boolean }>(stored: T, defaults: T): T => {
      const merged = { ...defaults, ...stored };
      // If enabled is not explicitly set, default to false (safer behavior)
      if (stored.enabled === undefined) {
        return { ...merged, enabled: false };
      }
      return merged;
    };

    return {
      dingtalk: resolveEnabled(dingtalk, DEFAULT_DINGTALK_OPENCLAW_CONFIG),
      feishu: resolveEnabled(feishu, DEFAULT_FEISHU_OPENCLAW_CONFIG),
      telegram: resolveEnabled(telegram, DEFAULT_TELEGRAM_OPENCLAW_CONFIG),
      discord: resolveEnabled(discord, DEFAULT_DISCORD_OPENCLAW_CONFIG),
      nim: resolveEnabled(nim, DEFAULT_NIM_CONFIG),
      xiaomifeng: resolveEnabled(xiaomifeng, DEFAULT_XIAOMIFENG_CONFIG),
      qq: resolveEnabled(qq, DEFAULT_QQ_CONFIG),
      wecom: resolveEnabled(wecom, DEFAULT_WECOM_CONFIG),
      popo: resolveEnabled(popo, DEFAULT_POPO_CONFIG),
      weixin: resolveEnabled(weixin, DEFAULT_WEIXIN_CONFIG),
      settings: { ...DEFAULT_IM_SETTINGS, ...settings },
    };
  }

  setConfig(config: Partial<IMGatewayConfig>): void {
    if (config.dingtalk) {
      this.setDingTalkOpenClawConfig(config.dingtalk);
    }
    if (config.feishu) {
      this.setFeishuOpenClawConfig(config.feishu);
    }
    if (config.telegram) {
      this.setTelegramOpenClawConfig(config.telegram);
    }
    if (config.discord) {
      this.setDiscordOpenClawConfig(config.discord);
    }
    if (config.nim) {
      this.setNimConfig(config.nim);
    }
    if (config.xiaomifeng) {
      this.setXiaomifengConfig(config.xiaomifeng);
    }
    if (config.qq) {
      this.setQQConfig(config.qq);
    }
    if (config.wecom) {
      this.setWecomConfig(config.wecom);
    }
    if (config.popo) {
      this.setPopoConfig(config.popo);
    }
    if (config.weixin) {
      this.setWeixinConfig(config.weixin);
    }
    if (config.settings) {
      this.setIMSettings(config.settings);
    }
  }

  // ==================== DingTalk OpenClaw Config ====================

  getDingTalkOpenClawConfig(): DingTalkOpenClawConfig {
    const stored = this.getConfigValue<DingTalkOpenClawConfig>('dingtalkOpenClaw');
    return { ...DEFAULT_DINGTALK_OPENCLAW_CONFIG, ...stored };
  }

  setDingTalkOpenClawConfig(config: Partial<DingTalkOpenClawConfig>): void {
    const current = this.getDingTalkOpenClawConfig();
    this.setConfigValue('dingtalkOpenClaw', { ...current, ...config });
  }

  // ==================== Feishu OpenClaw Config ====================

  getFeishuOpenClawConfig(): FeishuOpenClawConfig {
    const stored = this.getConfigValue<FeishuOpenClawConfig>('feishuOpenClaw');
    return { ...DEFAULT_FEISHU_OPENCLAW_CONFIG, ...stored };
  }

  setFeishuOpenClawConfig(config: Partial<FeishuOpenClawConfig>): void {
    const current = this.getFeishuOpenClawConfig();
    this.setConfigValue('feishuOpenClaw', { ...current, ...config });
  }

  // ==================== Discord OpenClaw Config ====================

  getDiscordOpenClawConfig(): DiscordOpenClawConfig {
    const stored = this.getConfigValue<DiscordOpenClawConfig>('discordOpenClaw');
    return { ...DEFAULT_DISCORD_OPENCLAW_CONFIG, ...stored };
  }

  setDiscordOpenClawConfig(config: Partial<DiscordOpenClawConfig>): void {
    const current = this.getDiscordOpenClawConfig();
    this.setConfigValue('discordOpenClaw', { ...current, ...config });
  }

  // ==================== NIM Config ====================

  getNimConfig(): NimConfig {
    const stored = this.getConfigValue<NimConfig>('nim');
    return { ...DEFAULT_NIM_CONFIG, ...stored };
  }

  setNimConfig(config: Partial<NimConfig>): void {
    const current = this.getNimConfig();
    this.setConfigValue('nim', { ...current, ...config });
  }

  // ==================== Xiaomifeng Config ====================

  getXiaomifengConfig(): XiaomifengConfig {
    const stored = this.getConfigValue<XiaomifengConfig>('xiaomifeng');
    return { ...DEFAULT_XIAOMIFENG_CONFIG, ...stored };
  }

  setXiaomifengConfig(config: Partial<XiaomifengConfig>): void {
    const current = this.getXiaomifengConfig();
    this.setConfigValue('xiaomifeng', { ...current, ...config });
  }

  // ==================== Telegram OpenClaw Config ====================

  getTelegramOpenClawConfig(): TelegramOpenClawConfig {
    const stored = this.getConfigValue<TelegramOpenClawConfig>('telegramOpenClaw');
    return { ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG, ...stored };
  }

  setTelegramOpenClawConfig(config: Partial<TelegramOpenClawConfig>): void {
    const current = this.getTelegramOpenClawConfig();
    this.setConfigValue('telegramOpenClaw', { ...current, ...config });
  }

  // ==================== QQ Config ====================

  getQQConfig(): QQConfig {
    const stored = this.getConfigValue<QQConfig>('qq');
    return { ...DEFAULT_QQ_CONFIG, ...stored };
  }

  setQQConfig(config: Partial<QQConfig>): void {
    const current = this.getQQConfig();
    this.setConfigValue('qq', { ...current, ...config });
  }

  // ==================== WeCom OpenClaw Config ====================

  getWecomConfig(): WecomOpenClawConfig {
    const stored = this.getConfigValue<WecomOpenClawConfig>('wecomOpenClaw');
    return { ...DEFAULT_WECOM_CONFIG, ...stored };
  }

  setWecomConfig(config: Partial<WecomOpenClawConfig>): void {
    const current = this.getWecomConfig();
    this.setConfigValue('wecomOpenClaw', { ...current, ...config });
  }

  // ==================== POPO ====================

  getPopoConfig(): PopoOpenClawConfig {
    const stored = this.getConfigValue<PopoOpenClawConfig>('popo');
    return { ...DEFAULT_POPO_CONFIG, ...stored };
  }

  setPopoConfig(config: Partial<PopoOpenClawConfig>): void {
    const current = this.getPopoConfig();
    this.setConfigValue('popo', { ...current, ...config });
  }

  // ==================== Weixin (微信) ====================

  getWeixinConfig(): WeixinOpenClawConfig {
    const stored = this.getConfigValue<WeixinOpenClawConfig>('weixin');
    return { ...DEFAULT_WEIXIN_CONFIG, ...stored };
  }

  setWeixinConfig(config: Partial<WeixinOpenClawConfig>): void {
    const current = this.getWeixinConfig();
    this.setConfigValue('weixin', { ...current, ...config });
  }

  getWeixinCredential(accountId: string): WeixinStoredCredential | null {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) return null;
    return this.getConfigValue<WeixinStoredCredential>(`weixinCredential:${normalizedAccountId}`) ?? null;
  }

  setWeixinCredential(accountId: string, credential: {
    token: string;
    baseUrl: string;
    userId: string;
  }): WeixinStoredCredential {
    const normalizedAccountId = accountId.trim();
    const normalizedBaseUrl = credential.baseUrl.trim().replace(/\/+$/, '');
    const record: WeixinStoredCredential = {
      accountId: normalizedAccountId,
      token: credential.token.trim(),
      baseUrl: normalizedBaseUrl,
      userId: credential.userId.trim(),
      updatedAt: Date.now(),
    };
    this.setConfigValue(`weixinCredential:${normalizedAccountId}`, record);
    return record;
  }

  getWeixinContextToken(accountId: string, conversationId: string): WeixinContextTokenRecord | null {
    const normalizedAccountId = accountId.trim();
    const normalizedConversationId = conversationId.trim();
    if (!normalizedAccountId || !normalizedConversationId) return null;

    const result = this.db.exec(
      `SELECT account_id, conversation_id, context_token, status, updated_at, last_success_at, last_error_at, last_error_message
       FROM weixin_context_tokens
       WHERE account_id = ? AND conversation_id = ?
       LIMIT 1`,
      [normalizedAccountId, normalizedConversationId],
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      accountId: row[0] as string,
      conversationId: row[1] as string,
      contextToken: row[2] as string,
      status: row[3] as WeixinContextTokenStatus,
      updatedAt: row[4] as number,
      lastSuccessAt: (row[5] as number | null) ?? null,
      lastErrorAt: (row[6] as number | null) ?? null,
      lastErrorMessage: (row[7] as string | null) ?? null,
    };
  }

  listWeixinContextTokens(accountId: string): WeixinContextTokenRecord[] {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) return [];

    const result = this.db.exec(
      `SELECT account_id, conversation_id, context_token, status, updated_at, last_success_at, last_error_at, last_error_message
       FROM weixin_context_tokens
       WHERE account_id = ?
       ORDER BY updated_at DESC`,
      [normalizedAccountId],
    );
    if (!result[0]?.values) return [];

    return result[0].values.map((row) => ({
      accountId: row[0] as string,
      conversationId: row[1] as string,
      contextToken: row[2] as string,
      status: row[3] as WeixinContextTokenStatus,
      updatedAt: row[4] as number,
      lastSuccessAt: (row[5] as number | null) ?? null,
      lastErrorAt: (row[6] as number | null) ?? null,
      lastErrorMessage: (row[7] as string | null) ?? null,
    }));
  }

  upsertWeixinContextToken(params: {
    accountId: string;
    conversationId: string;
    contextToken: string;
    status?: WeixinContextTokenStatus;
  }): WeixinContextTokenRecord | null {
    const normalizedAccountId = params.accountId.trim();
    const normalizedConversationId = params.conversationId.trim();
    const normalizedContextToken = params.contextToken.trim();
    if (!normalizedAccountId || !normalizedConversationId || !normalizedContextToken) {
      return null;
    }

    const now = Date.now();
    const status = params.status ?? WeixinContextTokenStatus.Active;
    const previous = this.getWeixinContextToken(normalizedAccountId, normalizedConversationId);
    this.db.run(
      `INSERT INTO weixin_context_tokens (
        account_id,
        conversation_id,
        context_token,
        status,
        updated_at,
        last_success_at,
        last_error_at,
        last_error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, conversation_id) DO UPDATE SET
        context_token = excluded.context_token,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_success_at = COALESCE(weixin_context_tokens.last_success_at, excluded.last_success_at),
        last_error_at = excluded.last_error_at,
        last_error_message = excluded.last_error_message`,
      [
        normalizedAccountId,
        normalizedConversationId,
        normalizedContextToken,
        status,
        now,
        previous?.lastSuccessAt ?? null,
        status === WeixinContextTokenStatus.Active ? null : now,
        status === WeixinContextTokenStatus.Active ? null : previous?.lastErrorMessage ?? null,
      ],
    );
    this.saveDb();
    return this.getWeixinContextToken(normalizedAccountId, normalizedConversationId);
  }

  markWeixinContextTokenStale(params: {
    accountId: string;
    conversationId: string;
    errorMessage?: string;
  }): WeixinContextTokenRecord | null {
    const normalizedAccountId = params.accountId.trim();
    const normalizedConversationId = params.conversationId.trim();
    if (!normalizedAccountId || !normalizedConversationId) return null;

    const current = this.getWeixinContextToken(normalizedAccountId, normalizedConversationId);
    if (!current) return null;

    const now = Date.now();
    this.db.run(
      `UPDATE weixin_context_tokens
       SET status = ?, updated_at = ?, last_error_at = ?, last_error_message = ?
       WHERE account_id = ? AND conversation_id = ?`,
      [
        WeixinContextTokenStatus.Stale,
        now,
        now,
        params.errorMessage?.trim() || null,
        normalizedAccountId,
        normalizedConversationId,
      ],
    );
    this.saveDb();
    return this.getWeixinContextToken(normalizedAccountId, normalizedConversationId);
  }

  markWeixinContextTokenSendSuccess(accountId: string, conversationId: string): void {
    const normalizedAccountId = accountId.trim();
    const normalizedConversationId = conversationId.trim();
    if (!normalizedAccountId || !normalizedConversationId) return;

    const now = Date.now();
    this.db.run(
      `UPDATE weixin_context_tokens
       SET status = ?, updated_at = ?, last_success_at = ?, last_error_at = NULL, last_error_message = NULL
       WHERE account_id = ? AND conversation_id = ?`,
      [
        WeixinContextTokenStatus.Active,
        now,
        now,
        normalizedAccountId,
        normalizedConversationId,
      ],
    );
    this.saveDb();
  }

  enqueueWeixinPendingOutbound(params: {
    id: string;
    accountId: string;
    conversationId: string;
    text: string;
    reason: WeixinPendingOutboundReason;
    expireAt: number;
  }): WeixinPendingOutboundRecord | null {
    const id = params.id.trim();
    const accountId = params.accountId.trim();
    const conversationId = params.conversationId.trim();
    const text = params.text.trim();
    if (!id || !accountId || !conversationId || !text) {
      return null;
    }

    const now = Date.now();
    this.db.run(
      `INSERT OR REPLACE INTO weixin_pending_outbound (
        id,
        account_id,
        conversation_id,
        text,
        reason,
        status,
        created_at,
        expire_at,
        sent_at,
        attempts,
        last_error_message,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        conversationId,
        text,
        params.reason,
        WeixinPendingOutboundStatus.Pending,
        now,
        params.expireAt,
        null,
        0,
        null,
        now,
      ],
    );
    this.saveDb();
    return this.getWeixinPendingOutboundById(id);
  }

  private getWeixinPendingOutboundById(id: string): WeixinPendingOutboundRecord | null {
    const result = this.db.exec(
      `SELECT id, account_id, conversation_id, text, reason, status, created_at, expire_at, sent_at, attempts, last_error_message, updated_at
       FROM weixin_pending_outbound
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      id: row[0] as string,
      accountId: row[1] as string,
      conversationId: row[2] as string,
      text: row[3] as string,
      reason: row[4] as WeixinPendingOutboundReason,
      status: row[5] as WeixinPendingOutboundStatus,
      createdAt: row[6] as number,
      expireAt: row[7] as number,
      sentAt: (row[8] as number | null) ?? null,
      attempts: (row[9] as number) ?? 0,
      lastErrorMessage: (row[10] as string | null) ?? null,
      updatedAt: row[11] as number,
    };
  }

  listWeixinPendingOutbound(accountId: string, conversationId: string, limit = 20): WeixinPendingOutboundRecord[] {
    const normalizedAccountId = accountId.trim();
    const normalizedConversationId = conversationId.trim();
    if (!normalizedAccountId || !normalizedConversationId) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const result = this.db.exec(
      `SELECT id, account_id, conversation_id, text, reason, status, created_at, expire_at, sent_at, attempts, last_error_message, updated_at
       FROM weixin_pending_outbound
       WHERE account_id = ?
         AND conversation_id = ?
         AND status = ?
         AND expire_at > ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [
        normalizedAccountId,
        normalizedConversationId,
        WeixinPendingOutboundStatus.Pending,
        Date.now(),
        safeLimit,
      ],
    );
    if (!result[0]?.values) return [];

    return result[0].values.map((row) => ({
      id: row[0] as string,
      accountId: row[1] as string,
      conversationId: row[2] as string,
      text: row[3] as string,
      reason: row[4] as WeixinPendingOutboundReason,
      status: row[5] as WeixinPendingOutboundStatus,
      createdAt: row[6] as number,
      expireAt: row[7] as number,
      sentAt: (row[8] as number | null) ?? null,
      attempts: (row[9] as number) ?? 0,
      lastErrorMessage: (row[10] as string | null) ?? null,
      updatedAt: row[11] as number,
    }));
  }

  markWeixinPendingOutboundSent(id: string): void {
    const normalizedId = id.trim();
    if (!normalizedId) return;
    const now = Date.now();
    this.db.run(
      `UPDATE weixin_pending_outbound
       SET status = ?, sent_at = ?, attempts = attempts + 1, last_error_message = NULL, updated_at = ?
       WHERE id = ?`,
      [
        WeixinPendingOutboundStatus.Sent,
        now,
        now,
        normalizedId,
      ],
    );
    this.saveDb();
  }

  markWeixinPendingOutboundFailed(id: string, errorMessage: string): void {
    const normalizedId = id.trim();
    if (!normalizedId) return;
    const now = Date.now();
    this.db.run(
      `UPDATE weixin_pending_outbound
       SET status = ?, attempts = attempts + 1, last_error_message = ?, updated_at = ?
       WHERE id = ?`,
      [
        WeixinPendingOutboundStatus.Failed,
        errorMessage.trim() || null,
        now,
        normalizedId,
      ],
    );
    this.saveDb();
  }

  expireWeixinPendingOutbound(now = Date.now()): number {
    this.db.run(
      `UPDATE weixin_pending_outbound
       SET status = ?, updated_at = ?
       WHERE status = ?
         AND expire_at <= ?`,
      [
        WeixinPendingOutboundStatus.Expired,
        now,
        WeixinPendingOutboundStatus.Pending,
        now,
      ],
    );
    const affected = this.db.getRowsModified();
    if (affected > 0) {
      this.saveDb();
    }
    return affected;
  }

  // ==================== IM Settings ====================

  getIMSettings(): IMSettings {
    const stored = this.getConfigValue<IMSettings>('settings');
    return { ...DEFAULT_IM_SETTINGS, ...stored };
  }

  setIMSettings(settings: Partial<IMSettings>): void {
    const current = this.getIMSettings();
    this.setConfigValue('settings', { ...current, ...settings });
  }

  // ==================== Utility ====================

  /**
   * Clear all IM configuration
   */
  clearConfig(): void {
    this.db.run('DELETE FROM im_config');
    this.saveDb();
  }

  /**
   * Check if IM is configured (at least one platform has credentials)
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    const hasDingTalk = !!(config.dingtalk.clientId && config.dingtalk.clientSecret);
    const hasFeishu = !!(config.feishu.appId && config.feishu.appSecret);
    const hasTelegram = !!config.telegram.botToken;
    const hasDiscord = !!config.discord.botToken;
    const hasNim = !!(config.nim.appKey && config.nim.account && config.nim.token);
    const hasXiaomifeng = !!(config.xiaomifeng?.clientId && config.xiaomifeng?.secret);
    const hasQQ = !!(config.qq?.appId && config.qq?.appSecret);
    const hasWecom = !!(config.wecom?.botId && config.wecom?.secret);
    const hasWeixin = !!config.weixin?.accountId;
    return hasDingTalk || hasFeishu || hasTelegram || hasDiscord || hasNim || hasXiaomifeng || hasQQ || hasWecom || hasWeixin;
  }

  // ==================== Notification Target Persistence ====================

  /**
   * Get persisted notification target for a platform
   */
  getNotificationTarget(platform: IMPlatform): any | null {
    return this.getConfigValue<any>(`notification_target:${platform}`) ?? null;
  }

  /**
   * Persist notification target for a platform
   */
  setNotificationTarget(platform: IMPlatform, target: any): void {
    this.setConfigValue(`notification_target:${platform}`, target);
  }

  getConversationReplyRoute(
    platform: IMPlatform,
    conversationId: string,
  ): StoredConversationReplyRoute | null {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return null;
    }
    return this.getConfigValue<StoredConversationReplyRoute>(
      `conversation_reply_route:${platform}:${normalizedConversationId}`,
    ) ?? null;
  }

  setConversationReplyRoute(
    platform: IMPlatform,
    conversationId: string,
    route: StoredConversationReplyRoute,
  ): void {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return;
    }
    this.setConfigValue(`conversation_reply_route:${platform}:${normalizedConversationId}`, route);
  }

  // ==================== Session Mapping Operations ====================

  /**
   * Get session mapping by IM conversation ID and platform
   */
  getSessionMapping(imConversationId: string, platform: IMPlatform): IMSessionMapping | null {
    const result = this.db.exec(
      'SELECT im_conversation_id, platform, cowork_session_id, agent_id, created_at, last_active_at FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      agentId: (row[3] as string) || 'main',
      createdAt: row[4] as number,
      lastActiveAt: row[5] as number,
    };
  }

  /**
   * Find the IM mapping that owns a given cowork session ID.
   */
  getSessionMappingByCoworkSessionId(coworkSessionId: string): IMSessionMapping | null {
    const result = this.db.exec(
      'SELECT im_conversation_id, platform, cowork_session_id, agent_id, created_at, last_active_at FROM im_session_mappings WHERE cowork_session_id = ? LIMIT 1',
      [coworkSessionId]
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      agentId: (row[3] as string) || 'main',
      createdAt: row[4] as number,
      lastActiveAt: row[5] as number,
    };
  }

  /**
   * Create a new session mapping
   */
  createSessionMapping(imConversationId: string, platform: IMPlatform, coworkSessionId: string, agentId: string = 'main'): IMSessionMapping {
    const now = Date.now();
    this.db.run(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, agent_id, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)',
      [imConversationId, platform, coworkSessionId, agentId, now, now]
    );
    this.saveDb();
    return {
      imConversationId,
      platform,
      coworkSessionId,
      agentId,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * Update last active time for a session mapping
   */
  updateSessionLastActive(imConversationId: string, platform: IMPlatform): void {
    const now = Date.now();
    this.db.run(
      'UPDATE im_session_mappings SET last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [now, imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Update the target session and agent for an existing mapping.
   * Used when the platform's agent binding changes.
   */
  updateSessionMappingTarget(imConversationId: string, platform: IMPlatform, newCoworkSessionId: string, newAgentId: string): void {
    const now = Date.now();
    this.db.run(
      'UPDATE im_session_mappings SET cowork_session_id = ?, agent_id = ?, last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [newCoworkSessionId, newAgentId, now, imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Delete a session mapping
   */
  deleteSessionMapping(imConversationId: string, platform: IMPlatform): void {
    this.db.run(
      'DELETE FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Delete all session mappings that reference a given cowork session ID.
   * Called when a cowork session is deleted so that the IM conversation
   * can be re-synced as a fresh session.
   */
  deleteSessionMappingByCoworkSessionId(coworkSessionId: string): void {
    this.db.run(
      'DELETE FROM im_session_mappings WHERE cowork_session_id = ?',
      [coworkSessionId]
    );
    this.saveDb();
  }

  /**
   * List all session mappings for a platform
   */
  listSessionMappings(platform?: IMPlatform): IMSessionMapping[] {
    const query = platform
      ? 'SELECT im_conversation_id, platform, cowork_session_id, agent_id, created_at, last_active_at FROM im_session_mappings WHERE platform = ? ORDER BY last_active_at DESC'
      : 'SELECT im_conversation_id, platform, cowork_session_id, agent_id, created_at, last_active_at FROM im_session_mappings ORDER BY last_active_at DESC';
    const params = platform ? [platform] : [];
    const result = this.db.exec(query, params);
    if (!result[0]?.values) return [];
    return result[0].values.map(row => ({
      imConversationId: row[0] as string,
      platform: row[1] as IMPlatform,
      coworkSessionId: row[2] as string,
      agentId: (row[3] as string) || 'main',
      createdAt: row[4] as number,
      lastActiveAt: row[5] as number,
    }));
  }

  // ==================== Session Route Operations ====================

  getSessionRoute(routeKey: string): IMSessionRoute | null {
    const result = this.db.exec(
      'SELECT route_key, platform, conversation_id, thread_id, agent_id, provider, cowork_session_id, last_event_id, created_at, updated_at FROM im_session_routes WHERE route_key = ? LIMIT 1',
      [routeKey],
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      routeKey: row[0] as string,
      platform: row[1] as IMPlatform,
      conversationId: row[2] as string,
      threadId: (row[3] as string | null) ?? null,
      agentId: row[4] as string,
      provider: row[5] as 'openclaw' | 'yd_cowork',
      coworkSessionId: row[6] as string,
      lastEventId: (row[7] as string | null) ?? null,
      createdAt: row[8] as number,
      updatedAt: row[9] as number,
    };
  }

  findSessionRoute(params: {
    platform: IMPlatform;
    conversationId: string;
    threadId?: string | null;
    agentId: string;
  }): IMSessionRoute | null {
    const normalizedThreadId = params.threadId?.trim() || null;
    const result = this.db.exec(
      normalizedThreadId
        ? 'SELECT route_key, platform, conversation_id, thread_id, agent_id, provider, cowork_session_id, last_event_id, created_at, updated_at FROM im_session_routes WHERE platform = ? AND conversation_id = ? AND thread_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1'
        : 'SELECT route_key, platform, conversation_id, thread_id, agent_id, provider, cowork_session_id, last_event_id, created_at, updated_at FROM im_session_routes WHERE platform = ? AND conversation_id = ? AND thread_id IS NULL AND agent_id = ? ORDER BY updated_at DESC LIMIT 1',
      normalizedThreadId
        ? [params.platform, params.conversationId, normalizedThreadId, params.agentId]
        : [params.platform, params.conversationId, params.agentId],
    );
    if (!result[0]?.values[0]) return null;
    const row = result[0].values[0];
    return {
      routeKey: row[0] as string,
      platform: row[1] as IMPlatform,
      conversationId: row[2] as string,
      threadId: (row[3] as string | null) ?? null,
      agentId: row[4] as string,
      provider: row[5] as 'openclaw' | 'yd_cowork',
      coworkSessionId: row[6] as string,
      lastEventId: (row[7] as string | null) ?? null,
      createdAt: row[8] as number,
      updatedAt: row[9] as number,
    };
  }

  upsertSessionRoute(route: {
    routeKey: string;
    platform: IMPlatform;
    conversationId: string;
    threadId?: string | null;
    agentId: string;
    provider: 'openclaw' | 'yd_cowork';
    coworkSessionId: string;
    lastEventId?: string | null;
  }): IMSessionRoute {
    const now = Date.now();
    const threadId = route.threadId?.trim() || null;
    const lastEventId = route.lastEventId?.trim() || null;
    const previous = this.getSessionRoute(route.routeKey);
    this.db.run(
      `INSERT INTO im_session_routes (
        route_key,
        platform,
        conversation_id,
        thread_id,
        agent_id,
        provider,
        cowork_session_id,
        last_event_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(route_key) DO UPDATE SET
        platform = excluded.platform,
        conversation_id = excluded.conversation_id,
        thread_id = excluded.thread_id,
        agent_id = excluded.agent_id,
        provider = excluded.provider,
        cowork_session_id = excluded.cowork_session_id,
        last_event_id = excluded.last_event_id,
        updated_at = excluded.updated_at`,
      [
        route.routeKey,
        route.platform,
        route.conversationId,
        threadId,
        route.agentId,
        route.provider,
        route.coworkSessionId,
        lastEventId,
        previous?.createdAt ?? now,
        now,
      ],
    );
    this.saveDb();
    return {
      routeKey: route.routeKey,
      platform: route.platform,
      conversationId: route.conversationId,
      threadId,
      agentId: route.agentId,
      provider: route.provider,
      coworkSessionId: route.coworkSessionId,
      lastEventId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
  }

  updateSessionRouteLastEvent(routeKey: string, eventId: string | null): void {
    const now = Date.now();
    this.db.run(
      'UPDATE im_session_routes SET last_event_id = ?, updated_at = ? WHERE route_key = ?',
      [eventId, now, routeKey],
    );
    this.saveDb();
  }

  deleteSessionRoute(routeKey: string): void {
    this.db.run('DELETE FROM im_session_routes WHERE route_key = ?', [routeKey]);
    this.saveDb();
  }

  deleteSessionRoutesByCoworkSessionId(coworkSessionId: string): void {
    this.db.run('DELETE FROM im_session_routes WHERE cowork_session_id = ?', [coworkSessionId]);
    this.saveDb();
  }

  repairSessionRoutesFromLegacyMappings(provider: 'openclaw' | 'yd_cowork'): number {
    const mappings = this.listSessionMappings();
    if (!mappings.length) {
      return 0;
    }
    const now = Date.now();
    let repairedCount = 0;
    for (const mapping of mappings) {
      const agentId = mapping.agentId?.trim() || GatewayRoute.DefaultAgentId;
      const routeKey = [
        mapping.platform,
        mapping.imConversationId,
        GatewayRoute.NoThread,
        agentId,
      ].join(GatewayRoute.KeySeparator);
      const previous = this.getSessionRoute(routeKey);
      const shouldRepair = !previous
        || previous.coworkSessionId !== mapping.coworkSessionId
        || previous.provider !== provider;
      if (!shouldRepair) {
        continue;
      }
      this.db.run(
        `INSERT INTO im_session_routes (
          route_key,
          platform,
          conversation_id,
          thread_id,
          agent_id,
          provider,
          cowork_session_id,
          last_event_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(route_key) DO UPDATE SET
          platform = excluded.platform,
          conversation_id = excluded.conversation_id,
          thread_id = excluded.thread_id,
          agent_id = excluded.agent_id,
          provider = excluded.provider,
          cowork_session_id = excluded.cowork_session_id,
          updated_at = excluded.updated_at`,
        [
          routeKey,
          mapping.platform,
          mapping.imConversationId,
          null,
          agentId,
          provider,
          mapping.coworkSessionId,
          previous?.lastEventId ?? null,
          previous?.createdAt ?? mapping.createdAt ?? now,
          now,
        ],
      );
      repairedCount += 1;
    }
    if (repairedCount > 0) {
      this.saveDb();
    }
    return repairedCount;
  }

  // ==================== Inbound Event / Run Audit Operations ====================

  insertInboundEvent(event: {
    id: string;
    platform: IMPlatform;
    eventId: string;
    conversationId: string;
    threadId?: string | null;
    senderId?: string | null;
    eventType: 'message' | 'command' | 'system';
    contentText?: string | null;
    payloadJson?: string;
    receivedAt: number;
  }): { accepted: boolean } {
    this.db.run(
      `INSERT OR IGNORE INTO im_inbound_events (
        id,
        platform,
        event_id,
        conversation_id,
        thread_id,
        sender_id,
        event_type,
        content_text,
        payload_json,
        received_at,
        dedup_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.platform,
        event.eventId,
        event.conversationId,
        event.threadId?.trim() || null,
        event.senderId?.trim() || null,
        event.eventType,
        event.contentText ?? null,
        event.payloadJson ?? '{}',
        event.receivedAt,
        'accepted',
      ],
    );
    const accepted = this.db.getRowsModified() > 0;
    if (accepted) {
      this.saveDb();
    }
    return { accepted };
  }

  createGatewayRun(params: {
    runId: string;
    provider: 'openclaw' | 'yd_cowork';
    platform: IMPlatform;
    routeKey: string;
    inboundEventId?: string | null;
    coworkSessionId?: string | null;
    status: GatewayRunStatusType | 'timeout';
    metadataJson?: string;
  }): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO im_gateway_runs (
        run_id,
        provider,
        platform,
        route_key,
        inbound_event_id,
        cowork_session_id,
        status,
        started_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.runId,
        params.provider,
        params.platform,
        params.routeKey,
        params.inboundEventId?.trim() || null,
        params.coworkSessionId?.trim() || 'unknown',
        params.status,
        now,
        params.metadataJson ?? '{}',
      ],
    );
    this.saveDb();
  }

  updateGatewayRun(params: {
    runId: string;
    status: GatewayRunStatusType | 'timeout';
    errorCode?: string | null;
    errorMessage?: string | null;
    finishedAt?: number | null;
    routeKey?: string | null;
    coworkSessionId?: string | null;
    metadataJson?: string | null;
  }): void {
    const finishedAt = params.finishedAt ?? null;
    const startedResult = this.db.exec(
      'SELECT started_at FROM im_gateway_runs WHERE run_id = ? LIMIT 1',
      [params.runId],
    );
    const startedAt = (startedResult[0]?.values?.[0]?.[0] as number | undefined) ?? undefined;
    const durationMs = finishedAt && startedAt ? Math.max(0, finishedAt - startedAt) : null;
    this.db.run(
      `UPDATE im_gateway_runs SET
        status = ?,
        error_code = ?,
        error_message = ?,
        finished_at = ?,
        duration_ms = ?,
        route_key = COALESCE(?, route_key),
        cowork_session_id = COALESCE(?, cowork_session_id),
        metadata_json = COALESCE(?, metadata_json)
      WHERE run_id = ?`,
      [
        params.status,
        params.errorCode?.trim() || null,
        params.errorMessage?.trim() || null,
        finishedAt,
        durationMs,
        params.routeKey?.trim() || null,
        params.coworkSessionId?.trim() || null,
        params.metadataJson?.trim() || null,
        params.runId,
      ],
    );
    this.saveDb();
  }

  listRecoverableGatewayRuns(options?: {
    limit?: number;
  }): IMRecoverableGatewayRunRecord[] {
    const limit = options?.limit ?? 50;
    const result = this.db.exec(
      `SELECT
        runs.run_id,
        runs.platform,
        COALESCE(routes.conversation_id, mappings.im_conversation_id, NULL) AS conversation_id,
        runs.route_key,
        runs.cowork_session_id,
        runs.status,
        runs.started_at
      FROM im_gateway_runs AS runs
      LEFT JOIN im_session_routes AS routes
        ON routes.route_key = runs.route_key
      LEFT JOIN im_session_mappings AS mappings
        ON mappings.cowork_session_id = runs.cowork_session_id
        AND mappings.platform = runs.platform
      WHERE
        runs.finished_at IS NULL
        AND runs.status IN (?, ?)
      ORDER BY runs.started_at ASC
      LIMIT ?`,
      [
        GatewayRunStatus.Queued,
        GatewayRunStatus.Running,
        limit,
      ],
    );
    if (!result[0]?.values?.length) {
      return [];
    }
    return result[0].values.map((row) => ({
      runId: row[0] as string,
      platform: row[1] as IMPlatform,
      conversationId: (row[2] as string | null) ?? null,
      routeKey: row[3] as string,
      coworkSessionId: row[4] as string,
      status: row[5] as GatewayRunStatusType,
      startedAt: row[6] as number,
    }));
  }

  insertOutboundDelivery(params: {
    id: string;
    runId: string;
    platform: IMPlatform;
    conversationId: string;
    threadId?: string | null;
    payloadJson: string;
    maxRetries?: number;
  }): { inserted: boolean } {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO im_outbound_deliveries (
        id,
        run_id,
        platform,
        conversation_id,
        thread_id,
        payload_json,
        status,
        retry_count,
        max_retries,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.runId,
        params.platform,
        params.conversationId,
        params.threadId?.trim() || null,
        params.payloadJson,
        GatewayDeliveryStatus.Pending,
        0,
        params.maxRetries ?? 3,
        now,
        now,
      ],
    );
    const inserted = this.db.getRowsModified() > 0;
    if (inserted) {
      this.saveDb();
    }
    return { inserted };
  }

  updateOutboundDeliveryState(params: {
    id: string;
    status: GatewayDeliveryStatusType;
    retryCount?: number;
    nextRetryAt?: number | null;
    lastError?: string | null;
    channelMessageId?: string | null;
  }): void {
    const now = Date.now();
    this.db.run(
      `UPDATE im_outbound_deliveries SET
        status = ?,
        retry_count = COALESCE(?, retry_count),
        next_retry_at = ?,
        last_error = ?,
        channel_message_id = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        params.status,
        params.retryCount ?? null,
        params.nextRetryAt ?? null,
        params.lastError?.trim() || null,
        params.channelMessageId?.trim() || null,
        now,
        params.id,
      ],
    );
    this.saveDb();
  }

  listRecoverableOutboundDeliveries(options?: {
    now?: number;
    staleSendingMs?: number;
    staleFailedMs?: number;
    limit?: number;
  }): IMOutboundDeliveryRecord[] {
    const now = options?.now ?? Date.now();
    const staleSendingMs = options?.staleSendingMs ?? 30_000;
    const staleFailedMs = options?.staleFailedMs ?? 10_000;
    const limit = options?.limit ?? 20;
    const result = this.db.exec(
      `SELECT
        id,
        run_id,
        platform,
        conversation_id,
        thread_id,
        payload_json,
        status,
        retry_count,
        max_retries,
        next_retry_at,
        last_error,
        created_at,
        updated_at
      FROM im_outbound_deliveries
      WHERE
        status = ?
        OR (status = ? AND (next_retry_at IS NULL OR next_retry_at <= ?) AND updated_at <= ?)
        OR (status = ? AND updated_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`,
      [
        GatewayDeliveryStatus.Pending,
        GatewayDeliveryStatus.Failed,
        now,
        now - staleFailedMs,
        GatewayDeliveryStatus.Sending,
        now - staleSendingMs,
        limit,
      ],
    );
    if (!result[0]?.values?.length) {
      return [];
    }
    return result[0].values.map((row) => ({
      id: row[0] as string,
      runId: row[1] as string,
      platform: row[2] as IMPlatform,
      conversationId: row[3] as string,
      threadId: (row[4] as string | null) ?? null,
      payloadJson: row[5] as string,
      status: row[6] as GatewayDeliveryStatusType,
      retryCount: Number(row[7] as number),
      maxRetries: Number(row[8] as number),
      nextRetryAt: (row[9] as number | null) ?? null,
      lastError: (row[10] as string | null) ?? null,
      createdAt: row[11] as number,
      updatedAt: row[12] as number,
    }));
  }

  resetSendingOutboundDeliveries(options?: {
    nextRetryAt?: number;
    lastError?: string;
  }): number {
    const now = options?.nextRetryAt ?? Date.now();
    const lastError = options?.lastError?.trim() || 'Recovered after process restart';
    this.db.run(
      `UPDATE im_outbound_deliveries SET
        status = ?,
        next_retry_at = ?,
        last_error = ?,
        updated_at = ?
      WHERE status = ?`,
      [
        GatewayDeliveryStatus.Failed,
        now,
        lastError,
        now,
        GatewayDeliveryStatus.Sending,
      ],
    );
    const affected = this.db.getRowsModified();
    if (affected > 0) {
      this.saveDb();
    }
    return affected;
  }
}
