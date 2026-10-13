import * as ort from 'onnxruntime-node';
import { parse } from 'yaml';
export interface PaddleOrientationConfig { width: number; height: number; mean: number[]; std: number[] }

export function paddleOrientationConfig(yaml: string): PaddleOrientationConfig {
  if (yaml.length > 16384) throw Error('OCR 方向模型配置过大');
  const value = parse(yaml, { maxAliasCount: 100 }), ops = value?.PreProcess?.transform_ops;
  const shape = Array.isArray(ops) && ops.find(op => op?.ResizeImage)?.ResizeImage?.size;
  const norm = Array.isArray(ops) && ops.find(op => op?.NormalizeImage)?.NormalizeImage;
  const post = value?.PostProcess?.Topk;
  if (value?.Global?.model_name !== 'PP-LCNet_x1_0_textline_ori' || !Array.isArray(shape) || shape.length !== 2 || shape[0] !== 160 || shape[1] !== 80 ||
      !Array.isArray(norm?.mean) || !Array.isArray(norm?.std) || norm.mean.length !== 3 || norm.std.length !== 3 ||
      !norm.mean.every((n: number) => Number.isFinite(n) && n >= 0 && n <= 1) || !norm.std.every((n: number) => Number.isFinite(n) && n > 0 && n <= 1) ||
      !Number.isFinite(norm.scale) || Math.abs(norm.scale - 1 / 255) > 1e-12 || norm.channel_num !== 3 || norm.order !== '' ||
      post?.topk !== 1 || JSON.stringify(post.label_list) !== '["0_degree","180_degree"]' ||
      ops.length !== 3 || !ops.every((op: unknown) => op && typeof op === 'object' && Object.keys(op).length === 1) ||
      ops.map((op: Record<string, unknown>) => Object.keys(op)[0]).join(',') !== 'ResizeImage,NormalizeImage,ToCHWImage') throw Error('OCR 方向模型配置不兼容');
  return { width: shape[0], height: shape[1], mean: [...norm.mean], std: [...norm.std] };
}

/** Official classification preprocessing reads RGB, resizes with linear interpolation, then normalizes to CHW. */
export function paddleOrientationInput(rgb: Uint8Array, width: number, height: number, config: PaddleOrientationConfig) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 16384 || height > 16384 ||
      width * height > 40_000_000 || rgb.byteLength !== width * height * 3) throw Error('OCR 方向裁剪图像无效');
  const pixels = config.width * config.height, data = new Float32Array(pixels * 3);
  for (let y = 0; y < config.height; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / config.height - 0.5)), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), dy = sy - y0;
    for (let x = 0; x < config.width; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / config.width - 0.5)), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), dx = sx - x0;
      for (let channel = 0; channel < 3; channel++) {
        const top = rgb[(y0 * width + x0) * 3 + channel] * (1 - dx) + rgb[(y0 * width + x1) * 3 + channel] * dx;
        const bottom = rgb[(y1 * width + x0) * 3 + channel] * (1 - dx) + rgb[(y1 * width + x1) * 3 + channel] * dx;
        data[channel * pixels + y * config.width + x] = (Math.round(top * (1 - dy) + bottom * dy) / 255 - config.mean[channel]) / config.std[channel];
      }
    }
  }
  return { data, dims: [1, 3, config.height, config.width] };
}
export function paddleOrientationResult(data: Float32Array, dims: readonly number[]) {
  if (dims.length !== 2 || dims[0] !== 1 || dims[1] !== 2 || data.length !== 2 ||
      !data.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || Math.abs(data[0] + data[1] - 1) > 0.001) throw Error('OCR 方向模型输出不兼容');
  const index = data[1] > data[0] ? 1 : 0;
  return { rotation: index ? 180 : 0, confidence: data[index] };
}
export class PaddleOrientation {
  private constructor(private session: ort.InferenceSession, private config: PaddleOrientationConfig) {}
  static async create(model: Uint8Array, config: PaddleOrientationConfig, backend: 'cpu' | 'dml', deviceId: number) {
    if (!Number.isSafeInteger(deviceId) || deviceId < 0 || deviceId > 31) throw Error('OCR 方向推理设备无效');
    const session = await ort.InferenceSession.create(model, { executionProviders: backend === 'dml' ? [{ name: 'dml', deviceId }] : ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3 });
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) { await session.release(); throw Error('OCR 方向模型输入输出不兼容'); }
    return new PaddleOrientation(session, config);
  }
  async run(rgb: Uint8Array, width: number, height: number) {
    const input = paddleOrientationInput(rgb, width, height, this.config);
    try {
      const outputs = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', input.data, input.dims) }), output = outputs[this.session.outputNames[0]];
      if (output.type !== 'float32' || !(output.data instanceof Float32Array)) throw Error('OCR 方向模型输出类型不兼容');
      return paddleOrientationResult(output.data, output.dims);
    } finally { input.data.fill(0); }
  }
  close() { return this.session.release(); }
}
