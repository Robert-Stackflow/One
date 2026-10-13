import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { paddleDetConfig } from '../../src/main/recognition/paddle-detector';
import { paddleRecConfig } from '../../src/main/recognition/paddle-recognizer';
import { PaddleOCRPipeline } from '../../src/main/recognition/paddle-pipeline';
import { OCRRunner } from '../../src/main/recognition/ocr-runner';
import { OCRModels } from '../../src/main/recognition/ocr-models';
import { resolve } from 'node:path';

export async function paddlePipelineBench(directory: string) {
  const metadata = await Promise.all(['PP-OCRv6_tiny_det_onnx-metadata.json', 'pp-ocrv6-tiny-rec-metadata.json']
    .map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
  const files = ['pp-ocrv6-tiny-det.onnx', 'pp-ocrv6-tiny-rec.onnx'];
  for (let index = 0; index < files.length; index++) {
    const expected = metadata[index].siblings.find((file: { rfilename: string }) => file.rfilename === 'inference.onnx').lfs.sha256;
    assert.equal(createHash('sha256').update(await readFile(join(directory, files[index]))).digest('hex'), expected);
  }
  const models = { det: join(directory, files[0]), rec: join(directory, files[1]),
    detection: paddleDetConfig(await readFile(join(directory, 'pp-ocrv6-tiny-det.yml'), 'utf8')),
    recognition: paddleRecConfig(await readFile(join(directory, 'pp-ocrv6-tiny-rec.yml'), 'utf8')),
    revision: metadata.map(model => model.sha).join('+') };
  const scene = async (foreground = '#111', background = '#fff') => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="320"><rect width="100%" height="100%" fill="${background}"/><g fill="${foreground}" font-family="Microsoft YaHei,Arial" font-size="54"><text x="50" y="90">ONE OCR 2026</text><text x="50" y="185">sample@example.com</text><text x="50" y="280">截图识别测试</text></g></svg>`)).png().toBuffer();
  const expected = ['ONEOCR2026', 'sample@example.com', '截图识别测试'];
  const clean = await scene(), inputs = [{ id: 'three-lines', png: clean, expected },
    { id: 'clockwise-90', png: await sharp(clean).rotate(90, { background: '#fff' }).png().toBuffer(), expected },
    { id: 'dark', png: await scene('#eee', '#181818'), expected },
    { id: 'tight-line', png: await readFile(join(directory, 'paddle-rec-sample-0.png')), expected: ['ONEOCR2026'] }];
  const records = [];
  const baseline = new OCRRunner(new OCRModels(resolve('work/current/fixtures/recognition-models')), resolve('dist/main/recognition/ocr-worker.cjs'));
  for (const input of inputs) {
    const size = await sharp(input.png).metadata(), start = performance.now();
    const result = await baseline.run(input.png, { width: size.width!, height: size.height! }, 'chi_sim+eng');
    const text = result.text.replace(/\s/g, '');
    records.push({ backend: 'tesseract-cpu', id: input.id, runMs: Math.round(performance.now() - start),
      linesMatched: input.expected.map(value => text.includes(value)), text: result.text });
  }
  for (const backend of ['cpu', 'dml'] as const) {
    const start = performance.now(), pipeline = await PaddleOCRPipeline.create(models, backend, 0), loadMs = performance.now() - start;
    try {
      const cancelled = new AbortController(); cancelled.abort();
      await assert.rejects(pipeline.run(clean, 'chi_sim+eng', cancelled.signal), /abort/i);
      for (const input of inputs) {
        const before = performance.now(), result = await pipeline.run(input.png);
        const text = result.text.replace(/\s/g, '');
        for (const expected of input.expected) assert.ok(text.includes(expected), backend + ' ' + input.id + ': ' + result.text);
        assert.ok(result.document && result.words.length >= input.expected.length);
        if (input.id === 'tight-line') assert.equal(text, 'ONEOCR2026', 'overlapping expansion must not duplicate the first digit');
        assert.equal(result.document.source.sha256, createHash('sha256').update(input.png).digest('hex'));
        assert.ok(result.document.blocks.flatMap(block => block.lines).every(line => line.quad.every(point =>
          point.x >= 0 && point.x <= result.width && point.y >= 0 && point.y <= result.height)));
        records.push({ backend, deviceId: backend === 'dml' ? 0 : undefined, id: input.id, loadMs: Math.round(loadMs),
          runMs: Math.round(performance.now() - before), lines: result.words.length, text: result.text, truncated: result.truncated,
          timings: result.timings });
      }
    } finally { await pipeline.close(); }
  }
  await writeFile(join(directory, 'paddle-pipeline-benchmark.json'), JSON.stringify({ kind: 'synthetic-full-pipeline', models: models.revision, records }, null, 2));
  console.log(JSON.stringify({ fullPipeline: true, cases: records.map(({ text, ...record }) => record) }));
}
