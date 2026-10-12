import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { TranslationClient } from '../../src/main/recognition/translation-client';
import {
  translationSettings,
  translationText,
  translationLanguage,
  translationEndpoint,
  azureEndpoint,
  type TranslationConnection,
} from '../../src/shared/recognition/translation';
const connection = (): TranslationConnection => ({
  revision: randomUUID(),
  provider: 'chat',
  endpoint: 'https://translation.example/v1/chat/completions',
  model: 'fixture',
  region: '',
  key: 'fixture-secret-never-log',
});
test('translation validates visible destinations, language, sizes and credentials before sending', () => {
  for (const url of [
    'http://example.com/v1',
    'file:///tmp/x',
    'https://user:pass@example.com',
    'https://example.com?key=secret',
    'https://example.com#x',
  ])
    assert.throws(() => translationEndpoint(url));
  assert.equal(
    translationEndpoint('http://127.0.0.1:9123/translate'),
    'http://127.0.0.1:9123/translate',
  );
  assert.throws(() => translationLanguage('__proto__'));
  assert.throws(() => translationText(''));
  assert.throws(() => translationText('x'.repeat(20001)));
  assert.throws(() => translationSettings({ ...connection(), key: 'key\nHeader:secret' }));
  assert.equal(
    translationSettings({
      ...connection(),
      provider: 'azure',
      endpoint: 'https://untrusted.example',
      model: 'ignored',
    }).endpoint,
    azureEndpoint,
  );
});
test('translation makes one real loopback HTTP request containing text and safely returns provider output', async () => {
  let count = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const b of req) chunks.push(b);
    const value = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, 'Bearer fixture-secret-never-log');
    assert.equal(value.messages[1].content, 'Hello, One.');
    assert.deepEqual(Object.keys(value).sort(), ['messages', 'model', 'stream']);
    assert.equal(
      value.messages.some((m: any) => m.image_url || m.png),
      false,
    );
    count++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '你好，One。' } }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c = {
        ...connection(),
        endpoint: `http://127.0.0.1:${(server.address() as any).port}/v1/chat/completions`,
      },
      result = await new TranslationClient().run(c, 'Hello, One.', 'zh-Hans');
    assert.equal(result.text, '你好，One。');
    assert.equal(result.source, 'Hello, One.');
    assert.equal(count, 1);
  } finally {
    await new Promise<void>((ok, no) => server.close((e) => (e ? no(e) : ok())));
  }
});
test('Azure translation uses fixed destination, key headers, plain text and the requested target', async () => {
  const client = new TranslationClient(async (input, options) => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://api.cognitive.microsofttranslator.com');
    assert.equal(u.searchParams.get('to'), 'en');
    assert.equal(u.searchParams.get('textType'), 'plain');
    assert.deepEqual(JSON.parse(options!.body as string), [{ Text: '你好' }]);
    assert.equal((options!.headers as any)['Ocp-Apim-Subscription-Region'], 'eastasia');
    assert.equal(options!.redirect, 'error');
    assert.equal(options!.credentials, 'omit');
    return Response.json([{ translations: [{ to: 'en', text: 'Hello' }] }]);
  });
  assert.equal(
    (
      await client.run(
        { ...connection(), provider: 'azure', endpoint: azureEndpoint, region: 'eastasia' },
        '你好',
        'en',
      )
    ).text,
    'Hello',
  );
});
test('translation rejects truncated, oversized, malformed and empty responses without echoing provider secrets', async () => {
  for (const body of [
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    { choices: [{ message: { content: '' } }] },
    { error: { message: 'fixture-secret-never-log' } },
    { choices: [{ message: { content: 'x'.repeat(60001) } }] },
  ])
    await assert.rejects(
      new TranslationClient(async () => Response.json(body)).run(connection(), 'hello', 'en'),
      (e) => e instanceof Error && !e.message.includes('fixture-secret'),
    );
  await assert.rejects(
    new TranslationClient(async () => new Response(new Uint8Array(262145))).run(
      connection(),
      'hello',
      'en',
    ),
    /范围/,
  );
  await assert.rejects(
    new TranslationClient(async () => new Response('invalid JSON')).run(
      connection(),
      'hello',
      'en',
    ),
    /格式/,
  );
  await assert.rejects(
    new TranslationClient(
      async () => new Response('x', { headers: { 'content-length': '999999' } }),
    ).run(connection(), 'hello', 'en'),
    /范围/,
  );
  await assert.rejects(
    new TranslationClient(async () => {
      throw Error('翻译 fixture-secret-never-log');
    }).run(connection(), 'hello', 'en'),
    /无法连接/,
  );
  await assert.rejects(
    new TranslationClient(
      async () => new Response('fixture-secret-never-log', { status: 401 }),
    ).run(connection(), 'hello', 'en'),
    /密钥无效/,
  );
});
test('translation cancellation, timeout and overlapping requests do not retry or consume stale results', async () => {
  let count = 0;
  const transport: typeof fetch = async (_url, options) => {
    count++;
    return new Promise((_ok, no) =>
      options!.signal!.addEventListener('abort', () => no(Error('aborted')), { once: true }),
    );
  };
  const client = new TranslationClient(transport),
    pending = client.run(connection(), 'hello', 'en');
  await assert.rejects(client.run(connection(), 'hello', 'en'), /正在翻译/);
  await client.cancel();
  await assert.rejects(pending, /取消/);
  assert.equal(count, 1);
  const timeout = new TranslationClient(transport, 20);
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(timeout.run(connection(), 'hello', 'en'), /超时/);
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(count, 2);
});
