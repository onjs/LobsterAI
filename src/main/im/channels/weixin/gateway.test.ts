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
});
