import { describe, expect, test } from 'vitest';
import { InboundBus } from './inboundBus';

describe('InboundBus', () => {
  test('returns the first non-null handler result', async () => {
    const bus = new InboundBus();
    const callOrder: string[] = [];

    bus.registerHandler(async () => {
      callOrder.push('first');
      return null;
    });

    bus.registerHandler(async (envelope) => {
      callOrder.push('second');
      return {
        runId: envelope.runId,
        platform: envelope.platform,
        conversationId: envelope.conversationId,
        replyText: 'ok',
        completedAt: Date.now(),
      };
    });

    bus.registerHandler(async () => {
      callOrder.push('third');
      return null;
    });

    const result = await bus.publish({
      runId: 'run-1',
      eventId: 'evt-1',
      platform: 'nim',
      conversationId: 'conv-1',
      threadId: null,
      receivedAt: Date.now(),
      message: {
        platform: 'nim',
        messageId: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u-1',
        content: 'hello',
        chatType: 'direct',
        timestamp: Date.now(),
      },
      replyFn: async () => undefined,
    });

    expect(result?.replyText).toBe('ok');
    expect(callOrder).toEqual(['first', 'second']);
  });
});
