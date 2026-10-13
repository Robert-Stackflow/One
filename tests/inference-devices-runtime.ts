import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { readInferenceDevices, resolveInferenceDevice } from '../src/main/inference-devices';
import { PaddleRunner } from '../src/main/recognition/paddle-runner';
import { paddleTinyModel } from '../src/main/local-model-catalog';
import type { PaddleArtifact, PaddleModelFiles } from '../src/main/recognition/paddle-job';
const root = resolve('work/current/capture-reconstruction');
const devices = await readInferenceDevices(undefined, resolve(process.env.ONE_INFERENCE_MONITOR || 'dist/native/One.Monitor.exe'));
assert.equal(devices.error, undefined); assert.ok(devices.gpus.length > 0);
const artifact = (role: string, suffix: string): PaddleArtifact => {
  const value = paddleTinyModel.artifacts.find(file => file.role === role)!;
  return { path: join(root, 'pp-ocrv6-tiny-' + suffix), bytes: value.bytes, sha256: value.sha256 };
};
const model: PaddleModelFiles = { id: paddleTinyModel.id, revision: paddleTinyModel.revision,
  detection: artifact('detection', 'det.onnx'), recognition: artifact('recognition', 'rec.onnx'),
  detectionConfig: artifact('detectionConfig', 'det.yml'), recognitionConfig: artifact('recognitionConfig', 'rec.yml') };
const png = await sharp(Buffer.from('<svg width="680" height="100"><rect width="680" height="100" fill="white"/><text x="15" y="72" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).png().toBuffer();
const results = [];
for (const gpu of devices.gpus.filter(gpu => gpu.d3d12)) {
  const selected = resolveInferenceDevice({ mode: 'gpu', gpu: gpu.id }, devices, 68000);
  assert.equal(selected.gpu!.deviceId, gpu.deviceId);
  const runner = new PaddleRunner(resolve('dist/main/recognition/paddle-worker.cjs'));
  const start = performance.now();
  try {
    const result = await runner.run(png, { width: 680, height: 100 }, 'eng', model, { device: 'gpu', deviceId: selected.gpu!.deviceId });
    assert.equal(result.text.replace(/\s/g, ''), 'ONEOCR2026'); assert.equal(result.actualBackend, 'dml'); assert.equal(result.deviceId, gpu.deviceId);
    results.push({ ...gpu, success: true, coldMs: Math.round(performance.now() - start) });
  } catch (error) { results.push({ ...gpu, success: false, error: (error as Error).message.slice(0, 500) }); }
  finally { await runner.close(); }
}
await writeFile(join(root, 'inference-devices-benchmark.json'), JSON.stringify({ created: new Date().toISOString(), model: model.id, runtime: 'onnxruntime-node@1.30.0', results }, null, 2));
console.log(JSON.stringify({ adapters: devices.gpus.length, tested: results.length, passed: results.filter(r => r.success).length,
  failed: results.filter(r => !r.success).map(r => ({ deviceId: r.deviceId, error: r.error })) }));
assert.ok(results.every(result => result.success), 'inspect inference-devices-benchmark.json for incompatible adapters');
