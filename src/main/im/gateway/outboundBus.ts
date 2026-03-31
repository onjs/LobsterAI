import type { GatewayOutboundEnvelope } from './types';

export type OutboundBusHandler = (envelope: GatewayOutboundEnvelope) => Promise<void>;

export class OutboundBus {
  private handlers: OutboundBusHandler[] = [];

  registerHandler(handler: OutboundBusHandler): void {
    this.handlers.push(handler);
  }

  async publish(envelope: GatewayOutboundEnvelope): Promise<void> {
    for (const handler of this.handlers) {
      await handler(envelope);
    }
  }
}
