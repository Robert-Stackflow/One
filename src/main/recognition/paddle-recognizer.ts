import * as ort from 'onnxruntime-node';
import { parse } from 'yaml';

export interface PaddleRecConfig {
  name: string;
  shape: [number, number, number];
  characters: string[];
}
export interface CTCGlyph { text: string; start: number; end: number; confidence: number }
export interface PaddleRecResult {
  text: string;
  confidence: number;
  glyphs: CTCGlyph[];
  timeSteps: number;
  /** CTC emission intervals are alignment hints, not measured character boxes. */
  alignment: 'ctc-approximate';
}

/** PaddleX OCRReisizeNormImg + CTCLabelDecode semantics, implemented without a Python runtime.
 * Reference: https://github.com/PaddlePaddle/PaddleX/blob/develop/paddlex/inference/models/text_recognition/processors.py
 */
export function paddleRecConfig(yaml: string): PaddleRecConfig {
  if (yaml.length > 1024 * 1024) throw Error('OCR 模型配置过大');
  const value = parse(yaml, { maxAliasCount: 100 });
  const ops = value?.PreProcess?.transform_ops, dictionary = value?.PostProcess?.character_dict;
  const shape = Array.isArray(ops) && ops.find(op => op?.RecResizeImg)?.RecResizeImg?.image_shape;
  if (value?.PostProcess?.name !== 'CTCLabelDecode' || !Array.isArray(shape) || shape.length !== 3 ||
      shape[0] !== 3 || !Number.isSafeInteger(shape[1]) || shape[1] < 16 || shape[1] > 128 ||
      !Number.isSafeInteger(shape[2]) || shape[2] < 32 || shape[2] > 3200 || !Array.isArray(dictionary) ||
      !dictionary.length || dictionary.length > 30000 || dictionary.some(char => typeof char !== 'string' || !char.length || char.length > 32) ||
      typeof value?.Global?.model_name !== 'string' || value.Global.model_name.length > 100 ||
      !Array.isArray(ops) || !ops.some(op => op?.DecodeImage?.img_mode === 'BGR'))
    throw Error('OCR 识别模型配置不兼容');
  const characters = ['', ...dictionary];
  if (value.PostProcess.use_space_char !== false) characters.push(' ');
  return { name: value.Global.model_name, shape: [...shape] as PaddleRecConfig['shape'], characters };
}

/** Interpolate in RGB input space, write normalized BGR/CHW and keep zero padding as upstream does. */
export function paddleRecInput(rgb: Uint8Array, width: number, height: number, shape: PaddleRecConfig['shape']) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 16384 || height > 16384 ||
      width * height > 40_000_000 || rgb.byteLength !== width * height * 3) throw Error('OCR 裁剪图像无效');
  const targetHeight = shape[1], targetWidth = Math.min(3200, Math.max(shape[2], Math.floor(targetHeight * width / height)));
  const resizedWidth = Math.min(targetWidth, Math.ceil(targetHeight * width / height));
  const pixels = targetWidth * targetHeight, data = new Float32Array(pixels * 3);
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / targetHeight - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), dy = sy - y0;
    for (let x = 0; x < resizedWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / resizedWidth - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), dx = sx - x0;
      for (let channel = 0; channel < 3; channel++) {
        const source = 2 - channel;
        const top = rgb[(y0 * width + x0) * 3 + source] * (1 - dx) + rgb[(y0 * width + x1) * 3 + source] * dx;
        const bottom = rgb[(y1 * width + x0) * 3 + source] * (1 - dx) + rgb[(y1 * width + x1) * 3 + source] * dx;
        data[channel * pixels + y * targetWidth + x] = ((top * (1 - dy) + bottom * dy) / 255 - 0.5) / 0.5;
      }
    }
  }
  return { data, dims: [1, 3, targetHeight, targetWidth], resizedWidth };
}

export function decodePaddleCTC(probabilities: Float32Array, dims: readonly number[], characters: readonly string[]): PaddleRecResult {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== characters.length ||
      !Number.isSafeInteger(dims[1]) || dims[1] < 1 || dims[1] > 10000 ||
      probabilities.length !== dims[1] * dims[2]) throw Error('OCR 识别输出尺寸或字典不匹配');
  const glyphs: CTCGlyph[] = [];
  let previous = -1, confidence = 0;
  for (let time = 0; time < dims[1]; time++) {
    let index = 0, maximum = -Infinity;
    for (let char = 0; char < dims[2]; char++) {
      const value = probabilities[time * dims[2] + char];
      if (!Number.isFinite(value) || value < 0 || value > 1.00001) throw Error('OCR 识别输出概率无效');
      if (value > maximum) { maximum = value; index = char; }
    }
    if (index && index !== previous) {
      glyphs.push({ text: characters[index], start: time, end: time + 1, confidence: maximum });
      confidence += maximum;
    } else if (index && glyphs.length) glyphs[glyphs.length - 1].end = time + 1;
    previous = index;
  }
  return { text: glyphs.map(glyph => glyph.text).join(''), confidence: glyphs.length ? confidence / glyphs.length : 0,
    glyphs, timeSteps: dims[1], alignment: 'ctc-approximate' };
}

/** Owned by an inference worker; callers release the session when the model/device changes. */
export class PaddleRecognizer {
  private constructor(private session: ort.InferenceSession, readonly config: PaddleRecConfig, readonly backend: 'cpu' | 'dml', readonly deviceId?: number) {}
  static async create(model: string, config: PaddleRecConfig, backend: 'cpu' | 'dml' = 'cpu', deviceId = 0) {
    if (!Number.isSafeInteger(deviceId) || deviceId < 0 || deviceId > 31) throw Error('OCR 推理设备无效');
    const session = await ort.InferenceSession.create(model, {
      executionProviders: backend === 'dml' ? [{ name: 'dml', deviceId }] : ['cpu'],
      intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3,
    });
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) {
      await session.release(); throw Error('OCR 识别模型输入输出不兼容');
    }
    return new PaddleRecognizer(session, config, backend, backend === 'dml' ? deviceId : undefined);
  }
  async run(rgb: Uint8Array, width: number, height: number) {
    const input = paddleRecInput(rgb, width, height, this.config.shape);
    try {
      const outputs = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', input.data, input.dims) });
      const output = outputs[this.session.outputNames[0]];
      if (output.type !== 'float32' || !(output.data instanceof Float32Array)) throw Error('OCR 识别模型输出类型不兼容');
      return decodePaddleCTC(output.data, output.dims, this.config.characters);
    } finally { input.data.fill(0); }
  }
  close() { return this.session.release(); }
}
