import type { GatewayInboundEnvelope, GatewayInboundResult } from './types';

export type InboundBusHandler = (
  envelope: GatewayInboundEnvelope,
) => Promise<GatewayInboundResult | null>;

export class InboundBus {
  private handlers: InboundBusHandler[] = [];

  registerHandler(handler: InboundBusHandler): void {
    this.handlers.push(handler);
  }

  async publish(envelope: GatewayInboundEnvelope): Promise<GatewayInboundResult | null> {
    for (const handler of this.handlers) {
      const result = await handler(envelope);
      if (result) {
        return result;
      }
    }
    return null;
  }
}
