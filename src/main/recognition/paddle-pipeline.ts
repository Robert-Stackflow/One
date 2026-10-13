import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { ocrDimensions } from '../../shared/recognition/ocr';
import { textBounds, textDocument, type TextQuad } from '../../shared/recognition/text-document';
import type { OCRLanguage, OCRResult } from '../../shared/recognition/ocr';
import { PaddleDetector, mergePaddleTextBoxes, type PaddleDetConfig } from './paddle-detector';
import { PaddleRecognizer, type PaddleRecConfig } from './paddle-recognizer';
import { PaddleOrientation, type PaddleOrientationConfig } from './paddle-orientation';
export interface PaddleOCRResult extends OCRResult {
  truncated: boolean;
  timings: { decodeMs: number; preprocessMs: number; inferenceMs: number; postprocessMs: number; rectifyMs: number; orientationMs: number; recognizeMs: number; totalMs: number };
}

/** Perspective sampling uses the source quadrilateral; it does not replace it with an axis-aligned crop. */
export function rectifyPaddleText(rgb: Uint8Array, sourceWidth: number, sourceHeight: number, quad: TextQuad) {
  if (quad.length !== 4 || !quad.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.y >= 0 && point.x <= sourceWidth && point.y <= sourceHeight)) throw Error('OCR 文字区域坐标无效');
  const area = quad.reduce((sum, point, index) => sum + point.x * quad[(index + 1) % 4].y - point.y * quad[(index + 1) % 4].x, 0);
  if (Math.abs(area) < 2) throw Error('OCR 文字区域面积无效');
  const [p0, p1, p2, p3] = quad;
  let width = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p2.x - p3.x, p2.y - p3.y));
  let height = Math.max(Math.hypot(p3.x - p0.x, p3.y - p0.y), Math.hypot(p2.x - p1.x, p2.y - p1.y));
  if (width < 2 || height < 2 || rgb.length !== sourceWidth * sourceHeight * 3) throw Error('OCR 文字区域无效');
  const ratio = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)));
  width = Math.max(2, Math.ceil(width * ratio)); height = Math.max(2, Math.ceil(height * ratio));
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < 1e-9) throw Error('OCR 文字区域透视变换无效');
    g = (dx3 * dy2 - dx2 * dy3) / determinant; h = (dx1 * dy3 - dx3 * dy1) / determinant;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y;
  const output = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / Math.max(1, width - 1), v = y / Math.max(1, height - 1), denominator = g * u + h * v + 1;
    const sx = Math.max(0, Math.min(sourceWidth - 1, (a * u + b * v + p0.x) / denominator));
    const sy = Math.max(0, Math.min(sourceHeight - 1, (d * u + e * v + p0.y) / denominator));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(sourceWidth - 1, x0 + 1), y1 = Math.min(sourceHeight - 1, y0 + 1);
    for (let c = 0; c < 3; c++) {
      const top = rgb[(y0 * sourceWidth + x0) * 3 + c] * (1 - sx + x0) + rgb[(y0 * sourceWidth + x1) * 3 + c] * (sx - x0);
      const bottom = rgb[(y1 * sourceWidth + x0) * 3 + c] * (1 - sx + x0) + rgb[(y1 * sourceWidth + x1) * 3 + c] * (sx - x0);
      output[(y * width + x) * 3 + c] = Math.round(top * (1 - sy + y0) + bottom * (sy - y0));
    }
  }
  if (height / width < 1.5) return { data: output, width, height };
  const rotated = new Uint8Array(output.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++)
    rotated[((width - 1 - x) * height + y) * 3 + c] = output[(y * width + x) * 3 + c];
  output.fill(0); return { data: rotated, width: height, height: width };
}

/** Prototype/full-image pipeline. Worker ownership and shared model management wrap this engine. */
export class PaddleOCRPipeline {
  private constructor(private detector: PaddleDetector, private recognizer: PaddleRecognizer, readonly backend: 'cpu' | 'dml', readonly modelRevision: string, private orientation?: PaddleOrientation) {}
  static async create(models: { det: string | Uint8Array; rec: string | Uint8Array; detection: PaddleDetConfig; recognition: PaddleRecConfig; revision: string; orientation?: Uint8Array; orientationConfig?: PaddleOrientationConfig }, backend: 'cpu' | 'dml', deviceId = 0) {
    if (models.detection.name.replace(/_det$/, '') !== models.recognition.name.replace(/_rec$/, '')) throw Error('OCR 检测与识别模型预设不匹配');
    if (!!models.orientation !== !!models.orientationConfig) throw Error('OCR 方向模型预设不完整');
    const detector = await PaddleDetector.create(models.det, models.detection, backend, deviceId);
    let recognizer: PaddleRecognizer | undefined, orientation: PaddleOrientation | undefined;
    try {
      recognizer = await PaddleRecognizer.create(models.rec, models.recognition, backend, deviceId);
      if (models.orientation) orientation = await PaddleOrientation.create(models.orientation, models.orientationConfig!, backend, deviceId);
      return new PaddleOCRPipeline(detector, recognizer, backend, models.revision, orientation);
    } catch (error) { await Promise.allSettled([detector.close(), recognizer?.close(), orientation?.close()]); throw error; }
  }
  async run(png: Buffer, language: OCRLanguage = 'chi_sim+eng', signal?: AbortSignal): Promise<PaddleOCRResult> {
    const started = performance.now();
    signal?.throwIfAborted();
    const image = sharp(png, { limitInputPixels: 12_000_000 });
    const metadata = await image.metadata();
    const { width, height } = ocrDimensions(metadata.width!, metadata.height!);
    const { data: rgb } = await image.flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const decoded = performance.now();
    try {
      signal?.throwIfAborted();
      const detection = await this.detector.run(rgb, width, height);
      signal?.throwIfAborted();
      // Baseline reading order follows Paddle's top-to-bottom, left-to-right line order.
      const boxes = mergePaddleTextBoxes(detection.boxes, width, height).sort((a, b) => a.quad[0].y - b.quad[0].y || a.quad[0].x - b.quad[0].x);
      for (let i = 1; i < boxes.length; i++) for (let j = i; j > 0; j--)
        if (Math.abs(boxes[j].quad[0].y - boxes[j - 1].quad[0].y) < 10 && boxes[j].quad[0].x < boxes[j - 1].quad[0].x)
          [boxes[j], boxes[j - 1]] = [boxes[j - 1], boxes[j]];
        else break;
      const words: OCRResult['words'] = [], quads: TextQuad[] = [];
      let rectifyMs = 0, orientationMs = 0, recognizeMs = 0;
      for (const box of boxes) {
        signal?.throwIfAborted();
        const beforeCrop = performance.now(), crop = rectifyPaddleText(rgb, width, height, box.quad);
        rectifyMs += performance.now() - beforeCrop;
        try {
          if (this.orientation) {
            const before = performance.now(), direction = await this.orientation.run(crop.data, crop.width, crop.height);
            if (direction.rotation === 180) for (let i = 0, j = crop.data.length - 3; i < j; i += 3, j -= 3)
              for (let channel = 0; channel < 3; channel++) [crop.data[i + channel], crop.data[j + channel]] = [crop.data[j + channel], crop.data[i + channel]];
            orientationMs += performance.now() - before;
          }
          const beforeRecognition = performance.now();
          const recognized = await this.recognizer.run(crop.data, crop.width, crop.height);
          recognizeMs += performance.now() - beforeRecognition;
          signal?.throwIfAborted();
          if (!recognized.text.trim()) continue;
          const bounds = textBounds(box.quad);
          words.push({ ...bounds, text: recognized.text, confidence: recognized.confidence * 100, line: words.length });
          quads.push(box.quad);
        } finally { crop.data.fill(0); }
      }
      const result: OCRResult & { truncated: boolean } = { width, height, language, words, text: words.map(word => word.text).join('\n'),
        confidence: words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0, truncated: detection.truncated };
      result.document = textDocument(result, createHash('sha256').update(png).digest('hex'), {
        id: 'paddle-onnx', version: require('onnxruntime-node/package.json').version,
        model: this.modelRevision, device: this.backend, confidenceScale: 100,
      });
      for (const [index, line] of result.document.blocks.flatMap(block => block.lines).entries()) {
        line.quad = quads[index]; for (const token of line.tokens) token.quad = quads[index];
      }
      return { ...result, timings: { decodeMs: decoded - started, ...detection.timings, rectifyMs, orientationMs, recognizeMs, totalMs: performance.now() - started } };
    } finally { rgb.fill(0); }
  }
  async close() { await Promise.all([this.detector.close(), this.recognizer.close(), this.orientation?.close()]); }
}
