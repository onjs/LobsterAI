import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_WEIXIN_STATUS } from '../../types';
import { YdWeixinGateway } from './gateway';

describe('YdWeixinGateway outbound media', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createReadyGateway(): YdWeixinGateway {
    const gateway = new YdWeixinGateway();
    gateway.setCredential({
      accountId: 'wx-account',
      baseUrl: 'https://weixin.example.com',
      token: 'token',
      userId: 'bot-user',
    });
    gateway.setConversationContextToken('user-1', 'ctx-token-1');
    (gateway as any).status = {
      ...DEFAULT_WEIXIN_STATUS,
      connected: true,
    };
    return gateway;
  }

  test('sends text and image media marker in one reply', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-weixin-test-'));
    const imagePath = path.join(tempDir, 'hello.png');
    await fs.writeFile(imagePath, Buffer.from('fake-image-content'));

    const sendPayloads: any[] = [];
    const uploadPayloads: any[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://weixin.example.com/ilink/bot/sendmessage') {
        sendPayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://weixin.example.com/ilink/bot/getuploadurl') {
        uploadPayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ upload_param: 'upload-param-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
        return new Response('', {
          status: 200,
          headers: { 'x-encrypted-param': 'download-param-1' },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const gateway = createReadyGateway();
    await gateway.sendConversationNotification('user-1', `hello world\n![img](${imagePath})`);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(uploadPayloads).toHaveLength(1);
    expect(uploadPayloads[0]?.media_type).toBe(1);
    expect(sendPayloads).toHaveLength(2);
    expect(sendPayloads[0]?.msg?.item_list?.[0]?.type).toBe(1);
    expect(sendPayloads[1]?.msg?.item_list?.[0]?.type).toBe(2);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('sends audio marker as voice message', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobsterai-weixin-test-'));
    const audioPath = path.join(tempDir, 'voice.mp3');
    await fs.writeFile(audioPath, Buffer.from('fake-audio-content'));

    const sendPayloads: any[] = [];
    const uploadPayloads: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === 'https://weixin.example.com/ilink/bot/sendmessage') {
        sendPayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://weixin.example.com/ilink/bot/getuploadurl') {
        uploadPayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ upload_param: 'upload-param-voice' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.startsWith('https://novac2c.cdn.weixin.qq.com/c2c/upload?')) {
        return new Response('', {
          status: 200,
          headers: { 'x-encrypted-param': 'download-param-voice' },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    const gateway = createReadyGateway();
    await gateway.sendConversationNotification(
      'user-1',
      `[DINGTALK_AUDIO]{"path":"${audioPath}"}[/DINGTALK_AUDIO]`,
    );

    expect(uploadPayloads).toHaveLength(1);
    expect(uploadPayloads[0]?.media_type).toBe(4);
    expect(sendPayloads).toHaveLength(1);
    expect(sendPayloads[0]?.msg?.item_list?.[0]?.type).toBe(3);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('rejects remote media URL to localhost/private network', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should not be called for blocked URL');
    });

    const gateway = createReadyGateway();
    await expect(
      gateway.sendConversationNotification(
        'user-1',
        '[DINGTALK_FILE]{"path":"http://127.0.0.1/test.txt"}[/DINGTALK_FILE]',
      ),
    ).rejects.toThrow(/private\/internal IP/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects ipv6-mapped private remote media URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should not be called for blocked URL');
    });

    const gateway = createReadyGateway();
    await expect(
      gateway.sendConversationNotification(
        'user-1',
        '[DINGTALK_FILE]{"path":"http://[::ffff:10.0.0.1]/test.txt"}[/DINGTALK_FILE]',
      ),
    ).rejects.toThrow(/private\/internal IP/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects oversized remote media download by content-length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: {
          'content-length': String(31 * 1024 * 1024),
        },
      }),
    );

    const gateway = new YdWeixinGateway();
    await expect(
      (gateway as any).downloadRemoteMediaToTemp('https://8.8.8.8/test.bin'),
    ).rejects.toThrow(/exceeds max allowed size/i);
  });

  test('normalizes group chat message and enforces group allowlist', async () => {
    const gateway = new YdWeixinGateway();
    (gateway as any).config = {
      enabled: true,
      accountId: 'wx-account',
      dmPolicy: 'open',
      allowFrom: [],
      groupPolicy: 'allowlist',
      groupAllowFrom: ['group-ok@chatroom'],
      debug: false,
    };
    (gateway as any).credential = {
      accountId: 'wx-account',
      baseUrl: 'https://weixin.example.com',
      token: 'token',
      userId: 'bot-user',
    };

    const received: any[] = [];
    gateway.on('message', (message) => received.push(message));

    await (gateway as any).handleRawMessage({
      message_id: 'm-1',
      message_type: 1,
      from_user_id: 'user-a',
      to_user_id: 'group-ok@chatroom',
      context_token: 'ctx-1',
      create_time_ms: Date.now(),
      item_list: [{ type: 1, text_item: { text: 'hello group' } }],
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.chatType).toBe('group');
    expect(received[0]?.conversationId).toBe('group-ok@chatroom');

    await (gateway as any).handleRawMessage({
      message_id: 'm-2',
      message_type: 1,
      from_user_id: 'user-a',
      to_user_id: 'group-denied@chatroom',
      context_token: 'ctx-2',
      create_time_ms: Date.now(),
      item_list: [{ type: 1, text_item: { text: 'blocked' } }],
    });

    expect(received).toHaveLength(1);
  });

  test('normalizes hex-like inbound text payload', async () => {
    const gateway = new YdWeixinGateway();
    (gateway as any).config = {
      enabled: true,
      accountId: 'wx-account',
      dmPolicy: 'open',
      allowFrom: [],
      groupPolicy: 'open',
      groupAllowFrom: [],
      debug: false,
    };
    (gateway as any).credential = {
      accountId: 'wx-account',
      baseUrl: 'https://weixin.example.com',
      token: 'token',
      userId: 'bot-user',
    };

    const received: any[] = [];
    gateway.on('message', (message) => received.push(message));

    const hexPayload = 'ab'.repeat(90);
    await (gateway as any).handleRawMessage({
      message_id: 'm-hex',
      message_type: 1,
      from_user_id: 'user-hex',
      context_token: 'ctx-hex',
      create_time_ms: Date.now(),
      item_list: [{ type: 1, text_item: { text: hexPayload } }],
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.content).toBe('[binary payload omitted]');
  });

  test('normalizes inbound image item with non-url payload', async () => {
    const gateway = new YdWeixinGateway();
    (gateway as any).config = {
      enabled: true,
      accountId: 'wx-account',
      dmPolicy: 'open',
      allowFrom: [],
      groupPolicy: 'open',
      groupAllowFrom: [],
      debug: false,
    };
    (gateway as any).credential = {
      accountId: 'wx-account',
      baseUrl: 'https://weixin.example.com',
      token: 'token',
      userId: 'bot-user',
    };

    const received: any[] = [];
    gateway.on('message', (message) => received.push(message));

    await (gateway as any).handleRawMessage({
      message_id: 'm-image',
      message_type: 1,
      from_user_id: 'user-image',
      context_token: 'ctx-image',
      create_time_ms: Date.now(),
      item_list: [{ type: 2, image_item: { url: 'ab'.repeat(64) } }],
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.content).toBe('[image]');
  });
});
