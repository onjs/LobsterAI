export interface ScheduledTaskHelperDeps {
  getIMGatewayManager: () => {
    getConfig: () => Record<string, unknown> | null;
  } | null;
}

let deps: ScheduledTaskHelperDeps | null = null;

export function initScheduledTaskHelpers(d: ScheduledTaskHelperDeps): void {
  deps = d;
}

type ScheduledTaskChannelMeta = {
  value: string;
  label: string;
  configKey: string;
};

const SCHEDULED_TASK_CHANNELS: ScheduledTaskChannelMeta[] = [
  { value: 'dingtalk', label: 'DingTalk', configKey: 'dingtalk' },
  { value: 'feishu', label: 'Feishu', configKey: 'feishu' },
  { value: 'telegram', label: 'Telegram', configKey: 'telegram' },
  { value: 'discord', label: 'Discord', configKey: 'discord' },
  { value: 'qqbot', label: 'QQ', configKey: 'qq' },
  { value: 'wecom', label: 'WeCom', configKey: 'wecom' },
  { value: 'popo', label: 'POPO', configKey: 'popo' },
  { value: 'nim', label: 'NIM', configKey: 'nim' },
  { value: 'openclaw-weixin', label: 'WeChat', configKey: 'weixin' },
  { value: 'xiaomifeng', label: 'Xiaomifeng', configKey: 'xiaomifeng' },
];

const MULTI_INSTANCE_CONFIG_KEYS = new Set(['dingtalk', 'feishu', 'qq']);

function isConfigKeyEnabled(key: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  if (MULTI_INSTANCE_CONFIG_KEYS.has(key)) {
    const instances = (value as { instances?: unknown[] }).instances;
    if (Array.isArray(instances) && instances.length > 0) {
      return instances.some(
        (instance) => instance
          && typeof instance === 'object'
          && (instance as { enabled?: boolean }).enabled === true,
      );
    }
    return (value as { enabled?: boolean }).enabled === true;
  }

  return (value as { enabled?: boolean }).enabled === true;
}

export function listScheduledTaskChannels(): Array<{ value: string; label: string; accountId?: string }> {
  const manager = deps?.getIMGatewayManager();
  const config = manager?.getConfig();
  if (!config) {
    return [...SCHEDULED_TASK_CHANNELS];
  }

  const configRecord = config as Record<string, unknown>;
  const enabledKeys = new Set<string>();
  const instancesByKey = new Map<string, Array<{ accountId: string; instanceName: string }>>();

  for (const [key, value] of Object.entries(configRecord)) {
    if (!isConfigKeyEnabled(key, value)) continue;
    enabledKeys.add(key);

    if (MULTI_INSTANCE_CONFIG_KEYS.has(key)) {
      const instances = (value as { instances?: unknown[] }).instances ?? [];
      const entries = instances
        .filter((instance) => (
          instance
          && typeof instance === 'object'
          && (instance as { enabled?: boolean }).enabled === true
        ))
        .map((instance) => {
          const item = instance as { instanceId?: string; instanceName?: string };
          const instanceId = (item.instanceId ?? '').trim();
          return {
            accountId: instanceId.slice(0, 8),
            instanceName: item.instanceName || instanceId.slice(0, 8),
          };
        })
        .filter((entry) => entry.accountId);
      if (entries.length > 0) {
        instancesByKey.set(key, entries);
      }
    }
  }

  const result: Array<{ value: string; label: string; accountId?: string }> = [];
  for (const option of SCHEDULED_TASK_CHANNELS) {
    if (!enabledKeys.has(option.configKey)) continue;
    const instances = instancesByKey.get(option.configKey);
    if (instances && instances.length > 0) {
      for (const instance of instances) {
        result.push({
          value: option.value,
          label: instance.instanceName,
          accountId: instance.accountId,
        });
      }
      continue;
    }
    result.push({
      value: option.value,
      label: option.label,
    });
  }

  return result;
}
