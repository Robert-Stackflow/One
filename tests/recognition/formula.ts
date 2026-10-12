import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { formulaSettings, formulaOutput, formulaText, FORMULA_IMAGE } from '../../src/shared/recognition/formula';
import { renderFormulaPreview } from '../../src/shared/recognition/formula-preview';
import { FormulaClient } from '../../src/main/recognition/formula-client';
const config = {
  revision: '11111111-1111-4111-8111-111111111111',
  provider: 'chat' as const,
  endpoint: 'https://vision.example.test/chat/completions',
  model: 'fixture-vision',
  region: '',
  key: 'formula-secret',
};
const png = Buffer.alloc(32);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
const response = (text = '\\frac{a}{b}') =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }),
  );
test('Formula settings require a vision-compatible endpoint and normalize common math wrappers without inventing OCR from plain text', () => {
  assert.equal(formulaSettings(config).model, 'fixture-vision');
  assert.throws(() => formulaSettings({ ...config, provider: 'azure' }), /公式/);
  assert.throws(() => formulaSettings({ ...config, endpoint: 'http://remote.test/api' }), /HTTPS/);
  for (const input of ['\\[x^2\\]', '\\(x^2\\)', '$x^2$', '$$x^2$$', '```latex\nx^2\n```'])
    assert.equal(formulaOutput(input), 'x^2');
  assert.throws(() => formulaOutput('```latex\nx\n```\nprose'), /格式/);
  assert.throws(() => formulaOutput('  '), /未返回/);
  assert.throws(() => formulaText('x'.repeat(16001)), /16,000/);
  assert.throws(() => formulaText('x\0'), /无效/);
  assert.throws(() => formulaText('\ud800'), /无效/);
  for (const input of ['$x$ + $y$', '$$x$$\n$$y$$', '\\[x\\]\\[y\\]'])
    assert.equal(formulaOutput(input), input);
  assert.equal(formulaOutput('$\\$5$'), '\\$5');
});
test('An explicit formula request sends exactly the supplied PNG and configured vision model to a real loopback service', async () => {
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.headers.authorization, 'Bearer formula-secret');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'stream']);
    assert.equal(body.model, config.model);
    assert.equal(
      body.messages[1].content[1].image_url.url,
      'data:image/png;base64,' + png.toString('base64'),
    );
    assert.equal(body.messages[1].content[0].type, 'text');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '\\[x^2\\]' } }] }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/chat',
      result = await new FormulaClient().run({ ...config, endpoint }, png);
    assert.equal(result.text, 'x^2');
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('Formula transport omits ambient credentials, rejects redirects and redacts provider or network errors', async () => {
  let options: RequestInit | undefined;
  const client = new FormulaClient(async (_input, init) => {
    options = init;
    return response();
  });
  assert.equal((await client.run(config, png)).text, '\\frac{a}{b}');
  assert.equal(options!.redirect, 'error');
  assert.equal(options!.credentials, 'omit');
  assert.equal(options!.cache, 'no-store');
  for (const status of [400, 401, 403, 404, 429, 500])
    await assert.rejects(
      new FormulaClient(async () => new Response(config.key, { status })).run(config, png),
      (error) => error instanceof Error && !error.message.includes(config.key),
    );
  await assert.rejects(
    new FormulaClient(async () => {
      throw Error(config.key);
    }).run(config, png),
    /无法连接/,
  );
  assert.throws(() => new FormulaClient().run(config, Buffer.alloc(FORMULA_IMAGE + 1)), /8 MiB/);
  assert.throws(() => new FormulaClient().run(config, Buffer.alloc(32)), /PNG/);
});
test('Formula results reject malformed, empty, oversized and truncated responses', async () => {
  const responses = [
    new Response('not-json'),
    response(''),
    response('x'.repeat(16001)),
    new Response(
      JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] }),
    ),
    new Response('{}', { headers: { 'content-length': '262145' } }),
    new Response(new Uint8Array(262145)),
  ];
  for (const value of responses)
    await assert.rejects(new FormulaClient(async () => value).run(config, png));
});
test('Formula cancellation, overlap and timeout terminate the one request without retry', async () => {
  let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    calls++;
    return new Promise((_ok, no) =>
      init!.signal!.addEventListener('abort', () => no(Error('aborted')), { once: true }),
    );
  };
  const client = new FormulaClient(transport),
    pending = client.run(config, png);
  await assert.rejects(client.run(config, png), /正在识别/);
  await client.cancel();
  await assert.rejects(pending, /取消/);
  assert.equal(calls, 1);
  const keep = setInterval(() => {}, 100);
  try {
    await assert.rejects(new FormulaClient(transport, 15).run(config, png), /超时/);
    assert.equal(calls, 2);
  } finally {
    clearInterval(keep);
  }
});
test('Real KaTeX previews fractions, scripts, matrices and cases with fresh macros and bounded untrusted commands', () => {
  for (const latex of [
    '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
    'x_{i}^{2}',
    '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
    'f(x)=\\begin{cases}x^2&x>0\\\\0&x\\le0\\end{cases}',
  ]) {
    const html = renderFormulaPreview(latex);
    assert.ok(html.includes('class="katex"'));
    assert.ok(html.includes('<math'));
  }
  renderFormulaPreview('\\gdef\\foo{a}\\foo');
  assert.throws(() => renderFormulaPreview('\\foo'));
  for (const latex of [
    '\\href{https://example.test}{x}',
    '\\includegraphics{https://example.test/x.png}',
    '\\htmlClass{evil}{x}',
    '\\def\\a{\\a}\\a',
    '\\frac{a',
  ])
    assert.throws(() => renderFormulaPreview(latex));
});
