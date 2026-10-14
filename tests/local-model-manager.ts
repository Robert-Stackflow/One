import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LocalModelManager } from '../src/main/local-model-manager';
import { OCRModels } from '../src/main/recognition/ocr-models';
import { paddleTinyModel, miganModel } from '../src/main/local-model-catalog';
import { aiModelPath, repairModel } from '../src/main/image-ai-model';
import { LlamaRuntimeStore } from '../src/main/recognition/llama-runtime-store';
import {formulaPlusS} from '../src/main/recognition/formula-model-catalog';
import type {FormulaModelStore} from '../src/main/recognition/formula-model-store';

test('OCR and formula managers share live settings without lost writes; formula metadata avoids inference and unrelated models',async()=>{
  const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'formula-shared-')),models=new OCRModels(join(root,'recognition','models'));
  let installed=0,removed=0,unloaded=0,ready=false;
  const formulas={state:async()=>({ready,downloading:false,inUse:false,diskBytes:ready?12:0,totalBytes:20,downloadedBytes:0}),install:async()=>{installed++;ready=true;},remove:async()=>{removed++;ready=false;}} as unknown as FormulaModelStore;
  const a=new LocalModelManager(root,models,fetch,async()=>{throw Error('unexpected GPU probe');},{formulas,unloadNative:async()=>{unloaded++;}}),b=new LocalModelManager(root,models,fetch,async()=>({gpus:[]}),{formulas});
  a.store.state=async()=>{throw Error('unexpected unrelated model read');};models.state=async()=>{throw Error('unexpected Tesseract read');};
  let state=await a.state(false,'formula');assert.deepEqual(state.entries.map(entry=>entry.id),[formulaPlusS.source.id]);assert.equal(state.choices.formula?.modelId,'service');
  const stale=state.revision;await a.save('formula',{modelId:formulaPlusS.source.id,device:{mode:'cpu'}},stale);
  assert.equal((await b.selection('formula')).modelId,formulaPlusS.source.id);await assert.rejects(b.save('ocr',{modelId:'tesseract',device:{mode:'cpu'}},stale),/已更新/);
  await b.save('ocr',{modelId:paddleTinyModel.id,device:{mode:'auto'}},await b.settingsRevision());assert.equal((await a.selection('ocr')).modelId,paddleTinyModel.id);
  const stored=JSON.parse(await readFile(join(root,'local-models.json'),'utf8'));assert.equal(stored.formula.modelId,formulaPlusS.source.id);assert.equal(stored.ocr.modelId,paddleTinyModel.id);assert.equal(stored.repair.modelId,miganModel.id);
  await b.save('formula',{modelId:'service',device:{mode:'auto'}},await b.settingsRevision());assert.equal((await a.state(false,'formula')).choices.formulaPrevious?.device.mode,'cpu');
  const resumedRoot=join(root,'resumed');await mkdir(resumedRoot);await copyFile(join(root,'local-models.json'),join(resumedRoot,'local-models.json'));const resumed=new LocalModelManager(resumedRoot,new OCRModels(join(resumedRoot,'recognition','models')));assert.equal((await resumed.selection('formula')).modelId,'service');assert.equal((await resumed.state(false,'formula')).choices.formulaPrevious?.modelId,formulaPlusS.source.id);await resumed.stop();
  await a.save('formula',{modelId:formulaPlusS.source.id,device:{mode:'cpu'}},await a.settingsRevision());
  await a.install(formulaPlusS.source.id);assert.equal(installed,1);assert.equal((await a.selectedState('formula')).ready,true);const release=a.use(formulaPlusS.source.id);await assert.rejects(a.remove(formulaPlusS.source.id),/使用/);release();await a.remove(formulaPlusS.source.id);assert.equal(removed,1);assert.equal(unloaded,1);
  await Promise.all([a.stop(),b.stop()]);
});

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

test('OCR dialog and selected state never verify weights or probe devices', async () => {
  const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'ocr-only-'));
  const runtimes=new LlamaRuntimeStore(join(root,'runtimes')),runtimeReads:string[]=[];
  const runtimeState=runtimes.state.bind(runtimes);
  runtimes.state=async(backend,verify=false)=>{
    assert.equal(verify,false,'dialog state must not hash native runtime files');
    runtimeReads.push(backend);return runtimeState(backend,verify);
  };
  const manager=new LocalModelManager(root,new OCRModels(join(root,'recognition','models')),fetch,
    async()=>{throw Error('UI state must not wait for a device probe');},{runtimes});
  const checked:string[]=[],inspect=manager.store.state.bind(manager.store);
  manager.store.state=async(...args)=>{
    checked.push(args[0].id);
    assert.equal(args[2],false,'UI state must not read weights for SHA-256');
    return inspect(...args);
  };
  try {
    const state=await manager.state(true,'ocr');
    assert.deepEqual(runtimeReads.sort(),['cpu','cuda'],'both DeepSeek models share one runtime metadata snapshot');
    assert.ok(state.entries.length>1&&state.entries.every(entry=>entry.purpose==='ocr'));
    assert.ok(!checked.includes(miganModel.id),'opening OCR models never hashes repair weights');
    await manager.save('ocr',{modelId:paddleTinyModel.id,device:{mode:'auto'}},state.revision);
    assert.equal((await manager.selectedState()).title,'PP-OCRv6 tiny');
    await manager.state(false,'ocr');
    await manager.state(true,'ocr');
    await assert.rejects(manager.store.acquire(paddleTinyModel),/SHA-256/,
      'actual model acquisition still requires full integrity verification');
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
