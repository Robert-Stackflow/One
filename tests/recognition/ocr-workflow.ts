import test from 'node:test';
import assert from 'node:assert/strict';
import { OCRWorkflow } from '../../src/main/recognition/ocr-workflow';
import { CaptureDelivery } from '../../src/main/capture/capture-delivery';
import {
  defaultWorkflows,
  workflowsFrom,
  type CaptureAction,
} from '../../src/shared/capture/capture-workflow';
import { captureRequest } from '../../src/shared/capture/capture-session';
import { defaultEffects } from '../../src/shared/capture/image-output';
import type { OCRResult } from '../../src/shared/recognition/ocr';
import type { TranslationConfig, TranslationLanguage } from '../../src/shared/recognition/translation';
const recognized: OCRResult = {
  text: 'Private sample',
  confidence: 90,
  width: 100,
  height: 50,
  words: [],
  language: 'chi_sim+eng',
};
const config: TranslationConfig = {
  revision: 'revision',
  provider: 'chat',
  endpoint: 'https://example.com/v1/chat/completions',
  model: 'model',
  region: '',
  keySaved: true,
  ready: true,
  error: '',
};
function fixture() {
  const calls: string[] = [];
  const host = {
    prepare: async (_png: Buffer) => {
      calls.push('prepare');
      return 'token';
    },
    valid: (token: string) => token === 'token',
    config: async () => config,
    recognize: async () => {
      calls.push('ocr');
      return recognized;
    },
    translate: async (
      _token: string,
      text: string,
      target: TranslationLanguage,
      revision: string,
    ) => {
      calls.push('translate');
      assert.equal(text, recognized.text);
      assert.equal(revision, config.revision);
      return { source: text, text: 'Translated', target, revision, endpoint: config.endpoint };
    },
    cancel: async () => {
      calls.push('cancel');
    },
  };
  return { host, calls, workflow: new OCRWorkflow(host) };
}
test('capture translation is explicit, ordered, targets are persisted and result polling contains no text', async () => {
  const { workflow, calls } = fixture();
  assert.equal(await workflow.run('owner', Buffer.from('png'), 'en'), true);
  assert.deepEqual(calls, ['prepare', 'ocr', 'translate']);
  assert.equal(workflow.state?.status, 'done');
  assert.ok(!JSON.stringify(workflow.state).includes(recognized.text));
  const result = workflow.read('token', workflow.state!.id);
  assert.equal(result.source, recognized.text);
  assert.equal(result.translation?.target, 'en');
  assert.throws(() => workflow.read('stale', workflow.state!.id), /失效/);
  assert.throws(() => workflow.read('token', 'stale'), /失效/);
  const defaults = defaultWorkflows();
  assert.ok(defaults.every((w) => !w.actions.includes('translate')));
  const saved = workflowsFrom([
    { ...defaults[0], actions: ['copy', 'translate'], translationTarget: 'ja' },
  ]);
  assert.equal(saved[0].translationTarget, 'ja');
  assert.throws(() => workflowsFrom([{ ...saved[0], translationTarget: 'invalid' }]), /语言/);
  assert.equal(workflowsFrom([{ ...saved[0], actions: ['copy'] }])[0].translationTarget, undefined);
  const request = {
    token: 'token',
    selection: { x: 0, y: 0, width: 10, height: 10 },
    actions: ['translate'],
    png: 'x',
    effects: defaultEffects(),
    workflowId: 'configured',
  };
  assert.equal(captureRequest(request, 'token', 10, 10, false).workflowId, 'configured');
  assert.throws(
    () => captureRequest({ ...request, workflowId: '../bad' }, 'token', 10, 10, false),
    /请求/,
  );
});
test('missing configuration and OCR failure do not send any text; translation failure is visible and retryable', async () => {
  const missing = fixture();
  missing.host.config = async () => ({ ...config, ready: false });
  await assert.rejects(missing.workflow.run('owner', Buffer.alloc(1), 'en'), /配置/);
  assert.deepEqual(missing.calls, ['prepare']);
  assert.equal(missing.workflow.state?.status, 'failed');
  const failed = fixture();
  failed.host.recognize = async () => {
    throw Error('OCR failed');
  };
  await assert.rejects(failed.workflow.run('owner', Buffer.alloc(1), 'en'), /OCR failed/);
  assert.deepEqual(failed.calls, ['prepare']);
  const retry = fixture();
  const translate = retry.host.translate;
  retry.host.translate = async () => {
    throw Error('Translation failed');
  };
  await assert.rejects(retry.workflow.run('owner', Buffer.alloc(1), 'en'), /Translation failed/);
  assert.equal(retry.workflow.read('token', retry.workflow.state!.id).source, recognized.text);
  retry.host.translate = translate;
  assert.equal(await retry.workflow.run('owner', Buffer.alloc(1), 'ja'), true);
  assert.equal(retry.workflow.state?.target, 'ja');
});
test('workflow cancellation is owner-scoped, prevents late translation, and invalidates closed results', async () => {
  const f = fixture();
  let release!: () => void;
  f.host.recognize = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return recognized;
  };
  f.host.cancel = async () => {
    release();
  };
  const task = f.workflow.run('owner', Buffer.alloc(1), 'en');
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(f.workflow.run('other', Buffer.alloc(1), 'en'), /正在执行/);
  await f.workflow.cancel('other');
  assert.equal(f.workflow.active, true);
  const canceled = f.workflow.cancel('owner');
  await canceled;
  assert.equal(await task, false);
  assert.ok(!f.calls.includes('translate'));
  assert.equal(f.workflow.state?.status, 'canceled');
  f.workflow.closed();
  assert.throws(() => f.workflow.read('token', 'stale'), /失效/);
});
test('configured translation target participates in delivery receipts, while retry skips completed preceding actions', async () => {
  const delivery = new CaptureDelivery(),
    calls: string[] = [];
  let fail = true;
  const deliver = async (action: CaptureAction) => {
    calls.push(action);
    if (action === 'translate' && fail) throw Error('Retry');
    return true;
  };
  const first = await delivery.execute(
    Buffer.from('png'),
    ['copy', 'translate', 'save'],
    deliver,
    'en',
  );
  assert.equal(first.receipts[0].status, 'completed');
  assert.equal(first.receipts[1].status, 'failed');
  fail = false;
  assert.equal(
    (await delivery.execute(Buffer.from('png'), ['copy', 'translate', 'save'], deliver, 'en'))
      .completed,
    true,
  );
  assert.deepEqual(calls, ['copy', 'translate', 'translate', 'save']);
  await delivery.execute(Buffer.from('png'), ['copy', 'translate', 'save'], deliver, 'ja');
  assert.deepEqual(calls.slice(-3), ['copy', 'translate', 'save']);
});
