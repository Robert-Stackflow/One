import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalModelManager } from '../src/main/local-model-manager';
import { OCRModels } from '../src/main/recognition/ocr-models';
import { paddleTinyModel, miganModel } from '../src/main/local-model-catalog';
import { aiModelPath, repairModel } from '../src/main/image-ai-model';

test('model choices persist per feature and do not mutate active tasks or allow incompatible GPU settings', async () => {
  const root = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'profile-'));
  const models = new OCRModels(join(root, 'recognition', 'models'));
  await mkdir(models.directory, { recursive: true });
  for (const language of ['eng', 'chi_sim']) await copyFile(resolve('work/current/fixtures/recognition-models', language + '.traineddata'), join(models.directory, language + '.traineddata'));
  const manager = new LocalModelManager(root, models, async () => { throw Error('offline'); }, async () => ({ gpus: [] }));
  let state = await manager.state(); assert.equal(state.choices.ocr.modelId, 'tesseract');
  assert.equal(state.entries.find(entry => entry.id === 'tesseract')!.ready, true);
  const oldChoice = await manager.selection('ocr'), release = manager.use('tesseract');
  const revision = state.revision;
  await manager.save('ocr', { modelId: paddleTinyModel.id, device: { mode: 'cpu' } }, revision);
  assert.equal(oldChoice.modelId, 'tesseract'); await assert.rejects(manager.remove('tesseract'), /正在使用/);
  await assert.rejects(manager.save('ocr', oldChoice, revision), /已更新/);
  state = await manager.state();
  for (const [purpose, choice] of [ ['ocr', { modelId: 'tesseract', device: { mode: 'gpu' } }], ['repair', { modelId: miganModel.id, device: { mode: 'gpu' } }],
    ['formula', { modelId: paddleTinyModel.id, device: { mode: 'cpu' } }], ['repair', { modelId: paddleTinyModel.id, device: { mode: 'cpu' } }] ] as const)
    await assert.rejects(manager.save(purpose, choice, state.revision), /适配|匹配|接入/);
  const reloaded = new LocalModelManager(root, models); assert.equal((await reloaded.selection('ocr')).modelId, paddleTinyModel.id);
  assert.equal((await reloaded.selection('repair')).modelId, miganModel.id);
  release(); release(); await manager.remove('tesseract'); assert.equal((await models.state()).ready, false);
  await manager.stop(); await assert.rejects(manager.install(paddleTinyModel.id), /关闭/);
});

test('OCR model state excludes repair verification', async () => {
  const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'ocr-only-'));
  const manager=new LocalModelManager(root,new OCRModels(join(root,'recognition','models')));
  const checked:string[]=[],inspect=manager.store.state.bind(manager.store);
  manager.store.state=async(...args)=>{checked.push(args[0].id);return inspect(...args);};
  try {
    const state=await manager.state(true,'ocr');
    assert.ok(state.entries.length>1&&state.entries.every(entry=>entry.purpose==='ocr'));
    assert.ok(!checked.includes(miganModel.id),'opening OCR models never hashes repair weights');
  } finally {await manager.stop();}
});

test('manager resumes cancelled downloads and removes shared and legacy repair caches together', async () => {
  const root = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'downloads-'));
  const models = new OCRModels(join(root, 'recognition', 'models'));
  const fixtureRoot = resolve('work/current/capture-reconstruction'), requested: string[] = [];
  let stall = true, started!: () => void;
  const first = new Promise<void>(resolve => { started = resolve; });
  const transport: typeof fetch = async (url, options) => {
    const source = String(url), part = source.includes('_det_onnx') ? 'det' : 'rec', extension = source.endsWith('.yml') ? 'yml' : 'onnx';
    const data = await readFile(join(fixtureRoot, `pp-ocrv6-tiny-${part}.${extension}`));
    const range = new Headers(options?.headers).get('range') || ''; requested.push(range);
    const offset = Number(/^bytes=(\d+)-$/.exec(range)?.[1] || 0);
    if (stall) {
      started(); return new Response(new ReadableStream({ start(controller) { controller.enqueue(data.subarray(0, 32)); } }), { headers: { 'content-length': String(data.length) } });
    }
    return new Response(data.subarray(offset), { status: offset ? 206 : 200, headers: { 'content-length': String(data.length - offset),
      ...(offset ? { 'content-range': `bytes ${offset}-${data.length - 1}/${data.length}` } : {}) } });
  };
  const manager = new LocalModelManager(root, models, transport);
  const task = manager.install(paddleTinyModel.id); await first;
  // Allow the first chunk to be committed before cancelling the request.
  await new Promise(resolve => setTimeout(resolve, 30)); manager.cancel(paddleTinyModel.id);
  await assert.rejects(task, /取消/);
  let state = await manager.state(); const partial = state.entries.find(entry => entry.id === paddleTinyModel.id)!;
  assert.equal(partial.ready, false); assert.equal(partial.downloadedBytes, 32); assert.equal(partial.diskBytes, 32);
  assert.equal(partial.error, '', 'intentional cancellation leaves resumable state without a failure');
  stall = false; await manager.install(paddleTinyModel.id); assert.ok(requested.includes('bytes=32-'));
  state = await manager.state(); assert.equal(state.entries.find(entry => entry.id === paddleTinyModel.id)!.ready, true);
  const lease = await manager.store.acquire(paddleTinyModel); await assert.rejects(manager.remove(paddleTinyModel.id), /使用/);
  lease.release(); await manager.remove(paddleTinyModel.id);
  await mkdir(join(root, 'models'), { recursive: true });
  await copyFile(resolve('work/current/migan-probe/migan_pipeline_v2.onnx'), aiModelPath(root, repairModel));
  state = await manager.state(true); const legacy = state.entries.find(entry => entry.id === miganModel.id)!;
  assert.equal(legacy.ready, true); assert.equal(legacy.diskBytes, repairModel.bytes);
  const count = requested.length; await manager.install(miganModel.id); assert.equal(requested.length, count, 'legacy import does not fetch');
  state = await manager.state(); assert.equal(state.entries.find(entry => entry.id === miganModel.id)!.diskBytes, repairModel.bytes * 2);
  await manager.remove(miganModel.id);
  state = await manager.state(true); const removed = state.entries.find(entry => entry.id === miganModel.id)!;
  assert.equal(removed.ready, false); assert.equal(removed.diskBytes, 0);
  await manager.stop();
});

test('closing a model manager aborts a pending native device query', async () => {
  const root = await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!, 'devices-'));
  let began!: () => void;
  const ready = new Promise<void>(resolve => { began = resolve; });
  const manager = new LocalModelManager(root, new OCRModels(join(root, 'recognition', 'models')), fetch, signal => new Promise((_resolve, reject) => {
    began(); signal!.addEventListener('abort', () => reject(Error('cancelled native query')), { once: true });
  }));
  const query = manager.refreshDevices(); void query.catch(() => {}); await ready;
  await manager.settle(); await assert.rejects(query, /cancelled/); await manager.stop();
});
