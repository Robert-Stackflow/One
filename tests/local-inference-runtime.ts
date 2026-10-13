import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import { LocalInferenceScheduler } from '../src/main/local-inference-scheduler';
import { LocalModelStore } from '../src/main/local-model-store';
import { paddleTinyModel } from '../src/main/local-model-catalog';
import { acquirePaddleModel } from '../src/main/recognition/paddle-models';
import { PaddleRunner } from '../src/main/recognition/paddle-runner';
import { OCRRunner } from '../src/main/recognition/ocr-runner';
import { OCRModels } from '../src/main/recognition/ocr-models';
import { ImageAiService } from '../src/main/image-ai-service';
const directory = process.env.ONE_INFERENCE_TEST_ROOT!, data = join(directory, 'profile'), output = join(directory, 'output');
app.setPath('userData', data);
const gate = () => { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; };
const waitFor = async (condition: () => boolean) => { const until = Date.now() + 15000; while (!condition()) { if (Date.now() > until) throw Error('Timed out waiting for inference queue'); await new Promise(done => setTimeout(done, 10)); } };

app.whenReady().then(async () => {
  const scheduler = new LocalInferenceScheduler(), runner = new PaddleRunner(resolve('dist/main/recognition/paddle-worker.cjs'), 90000, 60000, scheduler);
  const models = new OCRModels(join(data, 'recognition/models')), tesseract = new OCRRunner(models, resolve('dist/main/recognition/ocr-worker.cjs'), 60000, scheduler);
  const repair = new ImageAiService(data, scheduler), gates: ReturnType<typeof gate>[] = [];
  let lease: Awaited<ReturnType<typeof acquirePaddleModel>> | undefined;
  try {
    await Promise.all([mkdir(output, { recursive: true }), mkdir(models.directory, { recursive: true }), mkdir(join(data, 'models'), { recursive: true })]);
    await copyFile(resolve('dist/main/image-repair-worker.cjs'), join(directory, 'image-repair-worker.cjs'));
    await copyFile(resolve('work/current/fixtures/recognition-models/eng.traineddata'), join(models.directory, 'eng.traineddata'));
    await copyFile(resolve('work/current/migan-probe/migan_pipeline_v2.onnx'), join(data, 'models/migan-pipeline-v2-6f1f3530a1a2.onnx'));
    const store = new LocalModelStore(join(data, 'models/library'), async () => { throw Error('runtime test must not download'); });
    const suffixes: Record<string, string> = { detection: 'det.onnx', detectionConfig: 'det.yml', recognition: 'rec.onnx', recognitionConfig: 'rec.yml' };
    await store.install(paddleTinyModel, new AbortController().signal, () => {}, Object.fromEntries(Object.entries(suffixes).map(([role, suffix]) => [role, resolve('work/current/capture-reconstruction/pp-ocrv6-tiny-' + suffix)])));
    lease = await acquirePaddleModel(store);
    const textPNG = await sharp(Buffer.from('<svg width="680" height="120"><rect width="680" height="120" fill="white"/><text x="15" y="85" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).png().toBuffer();
    const source = join(directory, 'source.png'), pixels = Buffer.alloc(320 * 240 * 4, 255), mask = Buffer.alloc(320 * 240, 255);
    for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) { const i = y * 320 + x; pixels[i * 4] = x % 256; pixels[i * 4 + 1] = y % 256; pixels[i * 4 + 2] = 90; if (x >= 130 && x < 150 && y >= 100 && y < 120) mask[i] = 0; }
    await sharp(pixels, { raw: { width: 320, height: 240, channels: 4 } }).png().toFile(source);
    const painted = Buffer.alloc(320 * 240 * 4); for (let i = 0; i < mask.length; i++) painted[i * 4 + 3] = mask[i] ? 0 : 255;
    const maskURL = 'data:image/png;base64,' + (await sharp(painted, { raw: { width: 320, height: 240, channels: 4 } }).png().toBuffer()).toString('base64');
    const held = gate(); gates.push(held);
    const blocker = scheduler.run({ owner: Symbol('hold') }, new AbortController().signal, () => held.promise);
    let native: ChildProcess | undefined, exited = false, processing = false;
    const ocr = runner.run(textPNG, { width: 680, height: 120 }, 'eng', lease.model, { device: 'cpu', deviceId: 0 }, () => {
      if (!native) { native = (runner as unknown as { child?: ChildProcess }).child; native?.once('exit', () => { exited = true; }); }
    });
    const image = repair.startRepair(1, source, output, maskURL, 'damage', progress => {
      if (progress.message === '正在本地修复选区') { assert.equal(exited, true, 'retained OCR process must exit before repair is admitted'); processing = true; }
    });
    const cancelled = tesseract.run(textPNG, { width: 680, height: 120 }, 'eng'); const cancellation = assert.rejects(cancelled, /取消/);
    await waitFor(() => scheduler.pending === 3); assert.equal(runner.waiting, true); assert.equal(tesseract.waiting, true);
    await tesseract.cancel(); await cancellation; assert.equal(tesseract.waiting, false); assert.equal(processing, false);
    await writeFile(source, textPNG); // The queued image task must use its frozen copy, while retaining the new original file.
    held.release(); await blocker;
    const [recognized, repaired] = await Promise.all([ocr, image]);
    assert.match(recognized.text, /ONE\s*OCR\s*2026/); assert.equal(repaired.source, source); assert.equal(processing, true);
    const metadata = await sharp(repaired.output).metadata(); assert.equal(metadata.width, 320); assert.equal(metadata.height, 240);
    const repairedPixels = await sharp(repaired.output).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < mask.length; i++) if (mask[i]) assert.ok(repairedPixels.subarray(i * 4, i * 4 + 4).equals(pixels.subarray(i * 4, i * 4 + 4)));
    assert.ok((await readFile(source)).equals(textPNG));

    const second = gate(); gates.push(second);
    const blocking = scheduler.run({ owner: Symbol('hold-input') }, new AbortController().signal, () => second.promise);
    const mutable = Buffer.from(textPNG), dimensions = { width: 680, height: 120 }, fixed = tesseract.run(mutable, dimensions, 'eng');
    mutable.fill(0); dimensions.width = 1; second.release(); await blocking; assert.match((await fixed).text, /ONE\s*OCR\s*2026/);

    const closing = gate(); gates.push(closing);
    const active = scheduler.run({ owner: Symbol('hold-close') }, new AbortController().signal, () => closing.promise);
    const stopped = repair.startRepair(2, source, output, maskURL, 'damage', () => {}), stoppedCheck = assert.rejects(stopped, /取消/);
    await waitFor(() => scheduler.pending === 1); await repair.stopAll(); await stoppedCheck; assert.equal(scheduler.pending, 0);
    closing.release(); await active;
    assert.equal((await readdir(output)).some(name => name.startsWith('.one-image-ai-')), false);
    console.log('Shared inference runtime: real Paddle/Tesseract/MI-GAN, cached process release before repair, queued cancellation/close, frozen buffers/files and temporary cleanup passed.');
  } finally { for (const held of gates) held.release(); await Promise.all([runner.close(), tesseract.cancel(), repair.stopAll()]); lease?.release(); }
}).then(() => app.quit()).catch(error => { console.error(error.stack || error); app.exit(1); });
