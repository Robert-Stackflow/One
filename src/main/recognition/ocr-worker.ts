import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { ocrDimensions, ocrLanguage, ocrText, type OCRWord } from '../../shared/recognition/ocr';
async function run() {
  const size = ocrDimensions(workerData.width, workerData.height),
    language = ocrLanguage(workerData.language),
    packs = workerData.packs as { code: string; data: Uint8Array }[];
  let worker: Worker | undefined;
  try {
    worker = await createWorker(packs, OEM.LSTM_ONLY, {
      gzip: false,
      cacheMethod: 'none',
      workerPath: join(__dirname, 'ocr-engine.cjs'),
      logger: (message) => {
        if (typeof message.progress === 'number')
          parentPort!.postMessage({
            progress: Math.max(0, Math.min(1, message.progress)),
            phase: message.status === 'recognizing text' ? 'recognizing' : 'loading',
          });
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    });
    const result = await worker.recognize(
      Buffer.from(workerData.png),
      {},
      { text: true, blocks: true },
    );
    const words: OCRWord[] = [];
    let line = 0;
    for (const block of result.data.blocks || [])
      for (const paragraph of block.paragraphs)
        for (const row of paragraph.lines) {
          for (const word of row.words) {
            if (words.length >= 50000) throw Error('识别结果过多，请先裁剪图片');
            const box = word.bbox;
            words.push({
              text: word.text,
              confidence: Math.max(0, Math.min(100, word.confidence)),
              x: box.x0,
              y: box.y0,
              width: box.x1 - box.x0,
              height: box.y1 - box.y0,
              line,
            });
          }
          line++;
        }
    parentPort!.postMessage({
      ok: true,
      result: {
        ...size,
        language,
        text: ocrText(result.data.text),
        confidence: Math.max(0, Math.min(100, result.data.confidence)),
        words,
      },
    });
  } finally {
    await worker?.terminate();
    for (const pack of packs) pack.data.fill(0);
    workerData.png.fill(0);
  }
}
run().catch(() => {
  parentPort!.postMessage({ ok: false, error: '文字识别失败，请裁剪图片后重试' });
});
