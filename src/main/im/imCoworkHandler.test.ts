import { describe, expect, test } from 'vitest';
import type { CoworkMessage } from '../coworkStore';
import { selectRunMessagesForReply } from './imCoworkHandler';

const createMessage = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  timestamp: number,
): CoworkMessage => ({
  id,
  type,
  content,
  timestamp,
});

describe('selectRunMessagesForReply', () => {
  test('keeps reply messages scoped to current run ids', () => {
    const sessionMessages: CoworkMessage[] = [
      createMessage('old-user', 'user', 'first question', 1),
      createMessage('old-assistant', 'assistant', 'first answer', 2),
      createMessage('run-user', 'user', 'second question', 3),
      createMessage('run-assistant', 'assistant', 'second answer', 4),
    ];
    const runMessages: CoworkMessage[] = [
      createMessage('run-user', 'user', 'second question', 3),
      createMessage('run-assistant', 'assistant', 'second answer', 4),
    ];

    const result = selectRunMessagesForReply(sessionMessages, runMessages);
    expect(result.map((item) => item.id)).toEqual(['run-user', 'run-assistant']);
  });

  test('prefers canonical session copy when content has been updated', () => {
    const sessionMessages: CoworkMessage[] = [
      createMessage('run-assistant', 'assistant', 'final content', 4),
    ];
    const runMessages: CoworkMessage[] = [
      createMessage('run-assistant', 'assistant', 'stale stream content', 4),
    ];

    const result = selectRunMessagesForReply(sessionMessages, runMessages);
    expect(result[0]?.content).toBe('final content');
  });

  test('falls back to run messages when ids cannot be reconciled', () => {
    const sessionMessages: CoworkMessage[] = [
      createMessage('other', 'assistant', 'other reply', 10),
    ];
    const runMessages: CoworkMessage[] = [
      createMessage('run-assistant', 'assistant', 'run reply', 11),
    ];

    const result = selectRunMessagesForReply(sessionMessages, runMessages);
    expect(result).toEqual(runMessages);
  });
});
