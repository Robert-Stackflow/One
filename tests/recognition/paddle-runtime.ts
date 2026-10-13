import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { paddleRecConfig, PaddleRecognizer } from '../../src/main/recognition/paddle-recognizer';
import { paddlePipelineBench } from './paddle-pipeline-runtime';
import { paddleWorkerBench } from './paddle-worker-runtime';

const directory = process.env.ONE_PADDLE_PROBE_ROOT!;
function cer(expected: string, actual: string) {
  const a = [...expected.normalize('NFKC').replace(/\s+/g, ' ').trim()];
  const b = [...actual.normalize('NFKC').replace(/\s+/g, ' ').trim()];
  let previous = Uint32Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint32Array(b.length + 1); current[0] = i;
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length] / Math.max(1, a.length);
}
async function main() {
  if (process.argv.includes('--worker-only')) { await paddleWorkerBench(directory); return; }
  const config = paddleRecConfig(await readFile(join(directory, 'pp-ocrv6-tiny-rec.yml'), 'utf8'));
  const texts = ['ONE OCR 2026', '截图识别测试 One 2026', 'Hello, world!', '0123456789 3.14', '中文 English 混排', 'The quick brown fox.',
    '用户设置与文件搜索', 'Copy and translate text', 'Copyright 2026 One', '本地文字识别'];
  const styles = [
    { id: 'clean', size: 44, foreground: '#111', background: '#fff' },
    { id: 'small', size: 20, foreground: '#111', background: '#fff' },
    { id: 'dark', size: 36, foreground: '#eee', background: '#181818' },
    { id: 'contrast', size: 36, foreground: '#999', background: '#eee' },
    { id: 'compact', size: 28, foreground: '#111', background: '#fff' },
    { id: 'large', size: 60, foreground: '#111', background: '#fff' },
  ];
  const inputs = [];
  for (const style of styles) for (const [index, text] of texts.entries()) {
    const canvasWidth = text.length * style.size + 32, canvasHeight = style.size + 24;
    const rendered = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}"><rect width="100%" height="100%" fill="${style.background}"/><text x="8" y="${style.size + 2}" font-family="Microsoft YaHei,Arial" font-size="${style.size}" fill="${style.foreground}">${text}</text></svg>`)).png().toBuffer();
    const { data: png, info } = await sharp(rendered).trim({ background: style.background, threshold: 1 })
      .extend({ top: 8, bottom: 8, left: 8, right: 8, background: style.background }).png().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const rgb = await sharp(png).removeAlpha().toColourspace('srgb').raw().toBuffer();
    inputs.push({ id: `${style.id}-${index}`, text, width, height, rgb });
    if (style.id === 'clean' && index < 2) await writeFile(join(directory, `paddle-rec-sample-${index}.png`), png);
  }
  const report = { kind: 'synthetic-recognition-only', normalization: 'NFKC, whitespace collapse, case sensitive',
    model: config.name, samples: inputs.length, runtime: require('onnxruntime-node/package.json').version,
    providers: [] as unknown[] };
  for (const backend of ['cpu', 'dml'] as const) {
    let recognizer: PaddleRecognizer | undefined;
    try {
      const start = performance.now();
      recognizer = await PaddleRecognizer.create(join(directory, 'pp-ocrv6-tiny-rec.onnx'), config, backend, 0);
      const loadMs = performance.now() - start, records = [];
      let peakRSS = process.memoryUsage().rss;
      for (const input of inputs) {
        const before = performance.now(), result = await recognizer.run(input.rgb, input.width, input.height);
        records.push({ id: input.id, expected: input.text, text: result.text, confidence: result.confidence,
          cer: cer(input.text, result.text), ms: Math.round((performance.now() - before) * 100) / 100 });
        peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
      }
      assert.equal(records[0].cer, 0, backend + ' clean English');
      assert.equal(records[1].cer, 0, backend + ' clean Chinese');
      const summary = { backend, deviceId: backend === 'dml' ? 0 : undefined, loadMs: Math.round(loadMs),
        firstMs: records[0].ms, meanMs: Math.round(records.reduce((total, row) => total + row.ms, 0) / records.length * 100) / 100,
        meanCER: records.reduce((total, row) => total + row.cer, 0) / records.length, peakRSSMiB: Math.round(peakRSS / 1024 / 1024), records };
      report.providers.push(summary);
      console.log(JSON.stringify({ ...summary, records: undefined }));
    } finally { await recognizer?.close(); }
  }
  await writeFile(join(directory, 'paddle-rec-benchmark.json'), JSON.stringify(report, null, 2));
  await paddlePipelineBench(directory);
  await paddleWorkerBench(directory);
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
