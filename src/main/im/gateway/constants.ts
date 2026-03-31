export const GatewayRoute = {
  KeySeparator: ':',
  NoThread: '_',
  DefaultAgentId: 'main',
} as const;

export const GatewayBus = {
  Inbound: 'inbound',
  Outbound: 'outbound',
} as const;

export const GatewayRunStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type GatewayRunStatus = typeof GatewayRunStatus[keyof typeof GatewayRunStatus];

export const GatewayDeliveryStatus = {
  Pending: 'pending',
  Sending: 'sending',
  Sent: 'sent',
  Failed: 'failed',
  DeadLetter: 'dead_letter',
} as const;

export type GatewayDeliveryStatus = typeof GatewayDeliveryStatus[keyof typeof GatewayDeliveryStatus];

export const GatewayDeliveryPolicy = {
  DefaultMaxRetries: 2,
  RetryBackoffBaseMs: 1_000,
} as const;
