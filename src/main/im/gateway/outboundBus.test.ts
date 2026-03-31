import { describe, expect, test } from 'vitest';
import { OutboundBus } from './outboundBus';

describe('OutboundBus', () => {
  test('runs all handlers in order', async () => {
    const bus = new OutboundBus();
    const calls: string[] = [];

    bus.registerHandler(async () => {
      calls.push('a');
    });

    bus.registerHandler(async () => {
      calls.push('b');
    });

    await bus.publish({
      runId: 'run-1',
      platform: 'nim',
      conversationId: 'conv-1',
      text: 'hello',
      createdAt: Date.now(),
      deliver: async () => undefined,
    });

    expect(calls).toEqual(['a', 'b']);
  });
});
