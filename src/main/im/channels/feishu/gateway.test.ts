import { describe, expect, test, vi } from 'vitest';
import { WebhookHub } from '../../gateway/webhookHub';
import { DEFAULT_FEISHU_OPENCLAW_CONFIG, DEFAULT_FEISHU_STATUS } from '../../types';
import { YdFeishuGateway } from './gateway';

function createConfiguredGateway(): YdFeishuGateway {
  const gateway = new YdFeishuGateway(new WebhookHub());
  (gateway as any).config = {
    ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
    enabled: true,
    appId: 'app-id',
    appSecret: 'app-secret',
    groupPolicy: 'open',
    groups: {
      '*': {
        requireMention: true,
      },
    },
  };
  (gateway as any).status = {
    ...DEFAULT_FEISHU_STATUS,
    connected: true,
  };
  return gateway;
}

describe('YdFeishuGateway', () => {
  test('drops group message when requireMention is enabled and no mention marker exists', () => {
    const gateway = createConfiguredGateway();
    const normalized = (gateway as any).normalizeInboundMessage({
      sender: {
        sender_id: {
          open_id: 'sender-open-id',
          user_id: 'sender-user-id',
        },
      },
      message: {
        message_id: 'msg-1',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
        mentions: [],
        create_time: String(Date.now()),
      },
    });
    expect(normalized).toBeNull();
  });

  test('accepts group message when requireMention is enabled, botOpenId is missing, and mentions are present', () => {
    const gateway = createConfiguredGateway();
    const normalized = (gateway as any).normalizeInboundMessage({
      sender: {
        sender_id: {
          open_id: 'sender-open-id',
          user_id: 'sender-user-id',
        },
      },
      message: {
        message_id: 'msg-1b',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: '@_user_1 hello' }),
        mentions: [{ id: { open_id: 'some-open-id' } }],
        create_time: String(Date.now()),
      },
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.chatType).toBe('group');
  });

  test('accepts group message when mention contains botOpenId', () => {
    const gateway = createConfiguredGateway();
    (gateway as any).status = {
      ...DEFAULT_FEISHU_STATUS,
      connected: true,
      botOpenId: 'bot-open-id',
    };
    const normalized = (gateway as any).normalizeInboundMessage({
      sender: {
        sender_id: {
          open_id: 'sender-open-id',
          user_id: 'sender-user-id',
        },
      },
      message: {
        message_id: 'msg-2',
        chat_id: 'chat-1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
        mentions: [{ id: { open_id: 'bot-open-id' } }],
        create_time: String(Date.now()),
      },
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.chatType).toBe('group');
  });

  test('treats empty group allowlist as open when policy is allowlist', () => {
    const gateway = new YdFeishuGateway(new WebhookHub());
    (gateway as any).config = {
      ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
      enabled: true,
      appId: 'app-id',
      appSecret: 'app-secret',
      groupPolicy: 'allowlist',
      groupAllowFrom: [],
      groups: {
        '*': {
          requireMention: false,
        },
      },
    };
    (gateway as any).status = {
      ...DEFAULT_FEISHU_STATUS,
      connected: true,
    };
    const normalized = (gateway as any).normalizeInboundMessage({
      sender: {
        sender_id: {
          open_id: 'sender-open-id',
          user_id: 'sender-user-id',
        },
      },
      message: {
        message_id: 'msg-2b',
        chat_id: 'chat-2',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello from group' }),
        mentions: [],
        create_time: String(Date.now()),
      },
    });
    expect(normalized).not.toBeNull();
  });

  test('rejects remote media URL', async () => {
    const gateway = createConfiguredGateway();
    const sendTextLark = vi.fn().mockResolvedValue(undefined);
    const sendMediaLark = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(gateway as any, 'loadLarkDeliverModule').mockResolvedValue({
      sendTextLark,
      sendMediaLark,
    });

    await expect(
      gateway.sendConversationNotification(
        'chat-1',
        '[DINGTALK_FILE]{"path":"http://127.0.0.1/test.pdf"}[/DINGTALK_FILE]',
      ),
    ).rejects.toThrow(/remote URL is not allowed/i);
    expect(sendMediaLark).not.toHaveBeenCalled();
  });

  test('sends plain text through lark sdk without loading deliver module', async () => {
    const gateway = createConfiguredGateway();
    const request = vi.fn().mockResolvedValue({ code: 0 });
    const loadLarkDeliverModuleSpy = vi
      .spyOn(gateway as any, 'loadLarkDeliverModule')
      .mockResolvedValue({});
    vi.spyOn(gateway as any, 'loadLarkSdkModule').mockResolvedValue({
      AppType: { SelfBuild: 'self_build' },
      Domain: { Feishu: 'feishu', Lark: 'lark' },
      Client: class {
        request = request;
      },
    });

    await gateway.sendConversationNotification('chat-1', 'hello');

    expect(request).toHaveBeenCalledTimes(1);
    expect(loadLarkDeliverModuleSpy).not.toHaveBeenCalled();
  });

  test('rejects public remote media URL', async () => {
    const gateway = createConfiguredGateway();
    const sendTextLark = vi.fn().mockResolvedValue(undefined);
    const sendMediaLark = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(gateway as any, 'loadLarkDeliverModule').mockResolvedValue({
      sendTextLark,
      sendMediaLark,
    });

    await expect(
      gateway.sendConversationNotification(
        'chat-1',
        '[DINGTALK_FILE]{"path":"https://8.8.8.8/test.pdf"}[/DINGTALK_FILE]',
      ),
    ).rejects.toThrow(/remote URL is not allowed/i);
    expect(sendMediaLark).not.toHaveBeenCalled();
  });

  test('rejects relative local media path', async () => {
    const gateway = createConfiguredGateway();
    const sendTextLark = vi.fn().mockResolvedValue(undefined);
    const sendMediaLark = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(gateway as any, 'loadLarkDeliverModule').mockResolvedValue({
      sendTextLark,
      sendMediaLark,
    });

    await expect(
      gateway.sendConversationNotification(
        'chat-1',
        '[DINGTALK_FILE]{"path":"relative/path/test.pdf"}[/DINGTALK_FILE]',
      ),
    ).rejects.toThrow(/must be absolute/i);
    expect(sendMediaLark).not.toHaveBeenCalled();
  });

  test('accepts direct message payload shape from lark sdk callback', async () => {
    const gateway = createConfiguredGateway();
    const onMessageCallback = vi.fn().mockResolvedValue(undefined);
    gateway.setMessageCallback(onMessageCallback);

    await (gateway as any).handleInboundEvent({
      event_id: 'evt-1',
      sender: {
        sender_id: {
          user_id: 'ou_user_only',
        },
      },
      message: {
        message_id: 'msg-direct-1',
        chat_id: 'oc_direct_1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
        create_time: String(Date.now()),
      },
    });

    expect(onMessageCallback).toHaveBeenCalledTimes(1);
    const [message] = onMessageCallback.mock.calls[0];
    expect(message.platform).toBe('feishu');
    expect(message.senderId).toBe('ou_user_only');
    expect(message.chatType).toBe('direct');
  });
});
