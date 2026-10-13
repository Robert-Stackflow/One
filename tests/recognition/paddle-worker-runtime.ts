import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import { PaddleRunner } from '../../src/main/recognition/paddle-runner';
import type { PaddleModelFiles, PaddleArtifact } from '../../src/main/recognition/paddle-job';

export async function paddleWorkerBench(directory: string) {
  const artifact = async (name: string): Promise<PaddleArtifact> => {
    const path = join(directory, name), bytes = await readFile(path);
    return { path, bytes: (await stat(path)).size, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const model: PaddleModelFiles = { id: 'ppocr-v6-tiny', revision: 'pinned-fixture',
    detection: await artifact('pp-ocrv6-tiny-det.onnx'), recognition: await artifact('pp-ocrv6-tiny-rec.onnx'),
    detectionConfig: await artifact('pp-ocrv6-tiny-det.yml'), recognitionConfig: await artifact('pp-ocrv6-tiny-rec.yml') };
  const png = await readFile(join(directory, 'paddle-rec-sample-0.png')), metadata = await sharp(png).metadata();
  const size = { width: metadata.width!, height: metadata.height! }, original = createHash('sha256').update(png).digest('hex');
  const runner = new PaddleRunner(join(directory, 'paddle-worker.cjs'), 60000, 300);
  const child = () => (runner as unknown as { child?: ChildProcess }).child!;
  try {
    const first = await runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 });
    if (!/ONE OCR 2026/.test(first.text)) console.error(JSON.stringify({ workerSample: { size, text: first.text, words: first.words, quads: first.document?.blocks.flatMap(block=>block.lines.map(line=>line.quad)) } }));
    assert.match(first.text, /ONE OCR 2026/); assert.equal(first.actualBackend, 'cpu');
    const initialPid = child().pid;
    await runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 });
    assert.equal(child().pid, initialPid, 'warm tasks reuse the owned process and loaded sessions');
    const initialChild=child();await runner.run(png,size,'eng',{...model,revision:model.revision+'-updated'},{device:'cpu',deviceId:0});
    assert.notEqual(child().pid,initialPid,'changed weights/config revision replaces the native process');
    assert.ok(initialChild.exitCode!==null||initialChild.signalCode!==null,'old model process exits before new inference');
    let cancel = false;
    const pending = runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 }, (_value, phase) => {
      if (!cancel && phase === 'recognizing') { cancel = true; void runner.cancel(); }
    });
    await assert.rejects(runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 }), /正在识别/);
    await assert.rejects(pending, /取消/); assert.equal(child(), undefined);
    assert.equal(createHash('sha256').update(png).digest('hex'), original);
    await runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 });
    const stale = child(), exited = once(stale, 'exit'); stale.kill(); await exited;
    assert.match((await runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 })).text, /ONE OCR 2026/);
    const idleChild = child(); await once(idleChild, 'exit'); assert.equal(child(), undefined);
    await assert.rejects(runner.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0, memoryMiB: 128 }), /内存预算/);
    assert.equal(child(), undefined, 'budget failure must release the inference process');
    const mutable = Buffer.from(png), mutableSize = { ...size };
    const retained = runner.run(mutable, mutableSize, 'eng', model, { device: 'cpu', deviceId: 0 });
    mutable.fill(0); mutableSize.width = 1;
    assert.equal((await retained).document!.source.sha256, original, 'caller mutation must not change the task snapshot');
  } finally { await runner.close(); }
  const invalidGPU = new PaddleRunner(join(directory, 'paddle-worker.cjs'), 60000, 1000);
  try {
    const large = await sharp(png).extend({ top: 0, left: 0, right: 1000 - size.width, bottom: 1000 - size.height, background: '#fff' }).png().toBuffer();
    const result = await invalidGPU.run(large, { width: 1000, height: 1000 }, 'eng', model, { device: 'auto', deviceId: 31 });
    assert.equal(result.actualBackend, 'cpu'); assert.ok(result.fallbackReason, 'an unavailable DirectML adapter must cause an explicit CPU fallback');
    assert.match(result.text, /ONE OCR 2026/);
  } finally { await invalidGPU.close(); }
  const stub = join(directory, 'paddle-fallback-fixture.cjs');
  await writeFile(stub, `process.on('message',job=>{if(job.backend==='dml')process.send({id:job.id,ok:false,kind:'loading',error:'fixture GPU unavailable'});else process.send({id:job.id,ok:true,result:{width:1000,height:1000,language:job.language,confidence:90,text:'retained input',words:[]}})});`);
  const fallback = new PaddleRunner(stub, 10000, 1000);
  try {
    const value = await fallback.run(png, { width: 1000, height: 1000 }, 'eng', model, { device: 'auto', deviceId: 0 });
    assert.equal(value.actualBackend, 'cpu'); assert.match(value.fallbackReason!, /GPU unavailable/);
    await assert.rejects(fallback.run(png, { width: 1000, height: 1000 }, 'eng', model, { device: 'gpu', deviceId: 0 }), /切换 CPU/);
  } finally { await fallback.close(); }
  const hang = join(directory, 'paddle-timeout-fixture.cjs'); await writeFile(hang, `process.on('message',()=>{});`);
  const timeout = new PaddleRunner(hang, 150, 1000);
  try { await assert.rejects(timeout.run(png, size, 'eng', model, { device: 'cpu', deviceId: 0 }), /超时/); }
  finally { await timeout.close(); }
  console.log('Paddle process: actual CPU inference, warm reuse, cancellation/overlap, immutable input, crash/idle/budget recovery, unavailable DirectML adapter fallback, forced GPU failure and timeout passed.');
}
