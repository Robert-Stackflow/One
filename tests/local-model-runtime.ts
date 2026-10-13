import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { LocalModelStore } from '../src/main/local-model-store';
import { paddleTinyModel, miganModel } from '../src/main/local-model-catalog';
import { acquirePaddleModel } from '../src/main/recognition/paddle-models';
import { PaddleRunner } from '../src/main/recognition/paddle-runner';
import { acquireAiModel, aiModelPath, repairModel, validAiModel } from '../src/main/image-ai-model';

const directory = process.env.ONE_MODEL_TEST_ROOT!, data = await mkdtemp(join(directory, 'profile-'));
const root = resolve('work/current/capture-reconstruction');
const store = new LocalModelStore(join(data, 'models', 'library'), async () => { throw Error('runtime cache verification must work offline'); });
const prefix: Record<string, string> = { detection: 'det.onnx', detectionConfig: 'det.yml', recognition: 'rec.onnx', recognitionConfig: 'rec.yml' };
await store.install(paddleTinyModel, new AbortController().signal, () => {}, Object.fromEntries(Object.entries(prefix).map(([role, suffix]) => [role, join(root, 'pp-ocrv6-tiny-' + suffix)])));
const lease = await acquirePaddleModel(store);
const runner = new PaddleRunner(resolve('dist/main/recognition/paddle-worker.cjs'));
try {
  const png = await sharp(Buffer.from('<svg width="680" height="100"><rect width="680" height="100" fill="white"/><text x="15" y="72" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).png().toBuffer();
  const result = await runner.run(png, { width: 680, height: 100 }, 'eng', lease.model, { device: 'cpu', deviceId: 0 });
  assert.equal(result.text.replace(/\s/g, ''), 'ONEOCR2026'); assert.equal(result.actualBackend, 'cpu');
  await assert.rejects(store.remove(paddleTinyModel), /使用/);
} finally { await runner.close(); lease.release(); }
await store.remove(paddleTinyModel);

// Use the real previously prepared MI-GAN weight, without downloading or changing the user's profile.
const original = resolve('work/current/migan-probe/migan_pipeline_v2.onnx');
assert.equal((await stat(original)).size, repairModel.bytes);
await mkdir(join(data, 'models'), { recursive: true });
const legacy = aiModelPath(data, repairModel); await copyFile(original, legacy);
assert.equal(await validAiModel(data, repairModel), true);
const repair = await acquireAiModel(data, new AbortController().signal, () => {}, repairModel, 25000, async () => { throw Error('migration must not download'); });
assert.notEqual(repair.path, legacy); assert.equal((await store.state(miganModel)).ready, true);
assert.equal((await stat(legacy)).size, repairModel.bytes);
try {
  await assert.rejects(store.remove(miganModel), /使用/);
  const result = await promisify(execFile)(process.execPath, ['tests/image-repair-inference.cjs'], {
    env: { ...process.env, ONE_REPAIR_MODEL: repair.path }, windowsHide: true, maxBuffer: 64 * 1024,
  });
  assert.match(result.stdout, /CPU result.*cancellation passed/);
} finally { repair.release(); }
await unlink(legacy);
assert.equal(await validAiModel(data, repairModel), true);
const cached = await acquireAiModel(data, new AbortController().signal, () => {}, repairModel, 25000, async () => { throw Error('offline shared cache must not download'); });
cached.release();
await store.remove(miganModel);
assert.equal(await validAiModel(data, repairModel), false);
console.log('shared model cache: actual Paddle/MI-GAN CPU inference, leases, offline legacy migration and independent shared cache passed');
