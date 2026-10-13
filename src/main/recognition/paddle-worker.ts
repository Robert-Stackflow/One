import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { paddleDetConfig } from './paddle-detector';
import { paddleRecConfig } from './paddle-recognizer';
import { PaddleOCRPipeline } from './paddle-pipeline';
import type { PaddleArtifact, PaddleJob } from './paddle-job';
import { paddleOrientationConfig } from './paddle-orientation';
let pipeline: PaddleOCRPipeline | undefined, key = '', busy = false, current: PaddleJob | undefined, peakRSS = 0;
const send = (value: unknown) => { if (process.connected) process.send?.(value); };
async function artifact(file: PaddleArtifact) {
  const stat = await lstat(file.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || file.bytes < 1 || file.bytes > 256 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('OCR 模型文件无效，请重新安装模型');
  const bytes = await readFile(file.path);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    bytes.fill(0); throw Error('OCR 模型校验失败，请重新安装模型');
  }
  return bytes;
}
function observeMemory() {
  if (current) peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
  if (current && peakRSS > current.memoryMiB * 1024 * 1024) {
    send({ id: current.id, ok: false, kind: 'resource', error: 'OCR 推理超过内存预算，已保留输入，请调整设备或重试' });
    process.exitCode = 70; process.disconnect?.(); process.exit(70);
  }
}
const memory = setInterval(observeMemory, 200); memory.unref();
process.on('message', async (job: PaddleJob) => {
  if (busy) { send({ id: job.id, ok: false, kind: 'busy', error: 'OCR 推理正在进行' }); return; }
  busy = true; current = job; peakRSS = process.memoryUsage().rss; let kind = 'verify';
  try {
    const identity = JSON.stringify([job.model, job.backend, job.deviceId]);
    if (identity !== key) {
      await pipeline?.close(); pipeline = undefined; key = '';
      send({ id: job.id, phase: 'verifying', progress: 0.02 });
      if (!!job.model.orientation !== !!job.model.orientationConfig) throw Error('OCR 方向模型预设不完整');
      const buffers = await Promise.all([job.model.detection, job.model.recognition, job.model.detectionConfig, job.model.recognitionConfig,
        ...(job.model.orientation ? [job.model.orientation, job.model.orientationConfig!] : [])].map(artifact));
      try {
        kind = 'loading'; send({ id: job.id, phase: 'loading', progress: 0.08 });
        pipeline = await PaddleOCRPipeline.create({ det: buffers[0], rec: buffers[1],
          detection: paddleDetConfig(buffers[2].toString('utf8')), recognition: paddleRecConfig(buffers[3].toString('utf8')), revision: job.model.revision,
          ...(buffers[4] ? { orientation: buffers[4], orientationConfig: paddleOrientationConfig(buffers[5].toString('utf8')) } : {}) }, job.backend, job.deviceId);
        key = identity;
      } finally { for (const buffer of buffers) buffer.fill(0); }
    }
    kind = 'inference'; send({ id: job.id, phase: 'recognizing', progress: 0.15 });
    const result = await pipeline!.run(job.png, job.language);
    observeMemory();
    send({ id: job.id, ok: true, result: { ...result, peakRSSMiB: peakRSS / 1024 ** 2 } });
  } catch (error) {
    send({ id: job.id, ok: false, kind, error: error instanceof Error ? error.message : 'OCR 本地推理失败' });
    await pipeline?.close().catch(() => {}); pipeline = undefined; key = '';
  } finally { job.png.fill(0); current = undefined; busy = false; }
});
process.once('disconnect', () => { void pipeline?.close().finally(() => process.exit()); if (!pipeline) process.exit(); });
