import * as ort from 'onnxruntime-node';
import { parse } from 'yaml';
import { insideTextQuad } from '../../shared/recognition/text-geometry';
import type { TextPoint, TextQuad } from '../../shared/recognition/text-document';

export interface PaddleDetConfig { name: string; threshold: number; boxThreshold: number; unclip: number; maxCandidates: number; mean: number[]; std: number[]; resizeLong?: number }
export interface PaddleTextBox { quad: TextQuad; confidence: number }
export function paddleDetConfig(yaml: string): PaddleDetConfig {
  if (yaml.length > 1024 * 1024) throw Error('OCR 检测配置过大');
  const value = parse(yaml, { maxAliasCount: 100 }), post = value?.PostProcess;
  const ops = value?.PreProcess?.transform_ops, normalization = Array.isArray(ops) && ops.find(op => op?.NormalizeImage)?.NormalizeImage;
  const resize = Array.isArray(ops) && ops.find(op => op && 'DetResizeForTest' in op)?.DetResizeForTest;
  if(resize!=null&&(typeof resize!=='object'||Array.isArray(resize)||Object.keys(resize).some(key=>key!=='resize_long')||
      !Number.isSafeInteger(resize.resize_long)||resize.resize_long<128||resize.resize_long>3968))throw Error('OCR 检测缩放配置不兼容');
  if (post?.name !== 'DBPostProcess' || typeof value?.Global?.model_name !== 'string' ||
      ![post.thresh, post.box_thresh].every(number => typeof number === 'number' && number > 0 && number < 1) ||
      !Number.isFinite(post.unclip_ratio) || post.unclip_ratio < 0 || post.unclip_ratio > 4 ||
      !Number.isSafeInteger(post.max_candidates) || post.max_candidates < 1 || post.max_candidates > 10000 ||
      !Array.isArray(normalization?.mean) || !Array.isArray(normalization?.std) || normalization.mean.length !== 3 || normalization.std.length !== 3 ||
      !normalization.mean.every(Number.isFinite) || !normalization.std.every((number: number) => Number.isFinite(number) && number > 0) ||
      normalization.scale !== '1./255.' || !ops.some((op: { DecodeImage?: { img_mode?: string } }) => op?.DecodeImage?.img_mode === 'BGR')) throw Error('OCR 检测模型配置不兼容');
  return { name: value.Global.model_name, threshold: post.thresh, boxThreshold: post.box_thresh, unclip: post.unclip_ratio,
    maxCandidates: post.max_candidates, mean: [...normalization.mean], std: [...normalization.std],...(resize?{resizeLong:resize.resize_long}:{}) };
}

/** PaddleX type 0 uses a minimum side; type 2 fits a long side and rounds up to stride 128. */
export function paddleDetInput(rgb: Uint8Array, width: number, height: number, config: PaddleDetConfig, minSide = 736, maxSide = 4000) {
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width > 16384 || height > 16384 ||
      width * height > 40_000_000 || rgb.length !== width * height * 3) throw Error('OCR 检测图像无效');
  if (![minSide, maxSide].every(Number.isSafeInteger) || minSide < 32 || maxSide < minSide || maxSide > 4000) throw Error('OCR 检测缩放配置无效');
  if(config.resizeLong!==undefined&&(!Number.isSafeInteger(config.resizeLong)||config.resizeLong<128||config.resizeLong>3968))throw Error('OCR 检测缩放配置无效');
  const ratio = config.resizeLong===undefined?Math.min(Math.max(1, minSide / Math.min(width, height)), maxSide / Math.max(width, height)):config.resizeLong/Math.max(width,height);
  const side=(value:number)=>config.resizeLong===undefined?Math.max(32,Math.round(Math.floor(value*ratio)/32)*32):Math.max(128,Math.ceil(Math.floor(value*ratio)/128)*128);
  const w=side(width),h=side(height);
  if (w * h > 4_000_000) throw Error('OCR 检测图像过大，请分块识别');
  const pixels = w * h, data = new Float32Array(pixels * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / h - 0.5)), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), dy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / w - 0.5)), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), dx = sx - x0;
      for (let channel = 0; channel < 3; channel++) {
        const c = 2 - channel, a = rgb[(y0 * width + x0) * 3 + c] * (1 - dx) + rgb[(y0 * width + x1) * 3 + c] * dx;
        const b = rgb[(y1 * width + x0) * 3 + c] * (1 - dx) + rgb[(y1 * width + x1) * 3 + c] * dx;
        data[channel * pixels + y * w + x] = ((a * (1 - dy) + b * dy) / 255 - config.mean[channel]) / config.std[channel];
      }
    }
  }
  return { data, dims: [1, 3, h, w] };
}
const cross = (a: TextPoint, b: TextPoint, c: TextPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function hull(points: TextPoint[]) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: TextPoint[] = [], upper: TextPoint[] = [];
  for (const point of points) { while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point); }
  for (let i = points.length - 1; i >= 0; i--) { const point = points[i]; while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}
function rectangle(points: TextPoint[]) {
  const polygon = hull(points); let best: { ux: number; uy: number; lowU: number; highU: number; lowV: number; highV: number } | undefined, area = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
    let lowU = Infinity, highU = -Infinity, lowV = Infinity, highV = -Infinity;
    for (const point of polygon) {
      const u = point.x * ux + point.y * uy, v = -point.x * uy + point.y * ux;
      lowU = Math.min(lowU, u); highU = Math.max(highU, u); lowV = Math.min(lowV, v); highV = Math.max(highV, v);
    }
    if ((highU - lowU) * (highV - lowV) < area) { area = (highU - lowU) * (highV - lowV); best = { ux, uy, lowU, highU, lowV, highV }; }
  }
  return best;
}
function corners(rect: NonNullable<ReturnType<typeof rectangle>>, padding = 0): TextQuad {
  const { ux, uy } = rect;
  const points = [[rect.lowU - padding, rect.lowV - padding], [rect.highU + padding, rect.lowV - padding],
    [rect.highU + padding, rect.highV + padding], [rect.lowU - padding, rect.highV + padding]]
    .map(([u, v]) => ({ x: u * ux - v * uy, y: u * uy + v * ux })).sort((a, b) => a.x - b.x || a.y - b.y);
  const left = points.slice(0, 2).sort((a, b) => a.y - b.y), right = points.slice(2).sort((a, b) => a.y - b.y);
  return [left[0], right[0], right[1], left[1]];
}
/** DB connected components → minimum-area rectangles → box mean score → rectangular unclip.
 * Outer component hulls are used; interior holes do not become duplicate text candidates.
 */
export function paddleDetBoxes(probabilities: Float32Array, dims: readonly number[], width: number, height: number, config: PaddleDetConfig) {
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 1 || ![dims[2], dims[3]].every(Number.isSafeInteger) ||
      dims[2] < 1 || dims[3] < 1 || dims[2] * dims[3] > 4_000_000 || probabilities.length !== dims[2] * dims[3]) throw Error('OCR 检测输出无效');
  const h = dims[2], w = dims[3], binary = new Uint8Array(w * h), queue = new Int32Array(w * h), boxes: PaddleTextBox[] = [];
  for (let i = 0; i < probabilities.length; i++) {
    const value = probabilities[i]; if (!Number.isFinite(value) || value < 0 || value > 1.00001) throw Error('OCR 检测概率无效');
    binary[i] = value > config.threshold ? 1 : 0;
  }
  let candidates = 0;
  for (let seed = 0; seed < binary.length && candidates < config.maxCandidates; seed++) {
    if (!binary[seed]) continue;
    candidates++; let head = 0, tail = 1; queue[0] = seed; binary[seed] = 0;
    const points: TextPoint[] = [];
    while (head < tail) {
      const index = queue[head++], x = index % w, y = Math.floor(index / w);
      if (!x || !y || x === w - 1 || y === h - 1 || probabilities[index - 1] <= config.threshold || probabilities[index + 1] <= config.threshold ||
          probabilities[index - w] <= config.threshold || probabilities[index + w] <= config.threshold) points.push({ x, y });
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx; if (binary[next]) { binary[next] = 0; queue[tail++] = next; }
      }
    }
    if (points.length < 4) continue;
    const rect = rectangle(points); if (!rect) continue;
    const rw = rect.highU - rect.lowU, rh = rect.highV - rect.lowV;
    if (Math.min(rw, rh) < 3) continue;
    const quad = corners(rect), xs = quad.map(point => point.x), ys = quad.map(point => point.y);
    let score = 0, count = 0;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x++)
        if (insideTextQuad({ x, y }, quad)) { score += probabilities[y * w + x]; count++; }
    score /= Math.max(1, count); if (score < config.boxThreshold) continue;
    const padding = rw * rh * config.unclip / (2 * (rw + rh));
    if (Math.min(rw, rh) + padding * 2 < 5) continue;
    boxes.push({ quad: corners(rect, padding).map(point => ({ x: Math.max(0, Math.min(width, Math.round(point.x * width / w))),
      y: Math.max(0, Math.min(height, Math.round(point.y * height / h))) })) as TextQuad, confidence: score });
  }
  return { boxes, truncated: candidates >= config.maxCandidates };
}
/** DB expansion can make neighbouring pieces of one line overlap. Recognize their geometric union once,
 * rather than concatenating two readings of the same edge character. Separate rows/columns remain separate.
 */
export function mergePaddleTextBoxes(input: PaddleTextBox[], width: number, height: number) {
  const boxes = [...input].sort((a, b) => a.quad[0].y - b.quad[0].y || a.quad[0].x - b.quad[0].x);
  const output: PaddleTextBox[] = [];
  const axes = (box: PaddleTextBox) => {
    const [a, b, , d] = box.quad, horizontal = Math.hypot(b.x - a.x, b.y - a.y), vertical = Math.hypot(d.x - a.x, d.y - a.y);
    const end = horizontal >= vertical ? b : d, length = Math.max(horizontal, vertical);
    return { ux: (end.x - a.x) / length, uy: (end.y - a.y) / length };
  };
  const project = (box: PaddleTextBox, ux: number, uy: number) => {
    const u = box.quad.map(point => point.x * ux + point.y * uy), v = box.quad.map(point => -point.x * uy + point.y * ux);
    return { minU: Math.min(...u), maxU: Math.max(...u), minV: Math.min(...v), maxV: Math.max(...v) };
  };
  for (const box of boxes) {
    let current = box;
    for (let index = output.length - 1; index >= 0; index--) {
      const other = output[index], a = axes(current), b = axes(other);
      if (!Number.isFinite(a.ux) || !Number.isFinite(b.ux) || Math.abs(a.ux * b.ux + a.uy * b.uy) < 0.99) continue;
      const p = project(current, a.ux, a.uy), q = project(other, a.ux, a.uy);
      const overlapU = Math.min(p.maxU, q.maxU) - Math.max(p.minU, q.minU);
      const overlapV = Math.min(p.maxV, q.maxV) - Math.max(p.minV, q.minV);
      if (overlapU <= 0 || overlapV < Math.max(p.maxV - p.minV, q.maxV - q.minV) * 0.7) continue;
      const rect = rectangle([...current.quad, ...other.quad]); if (!rect) continue;
      current = { confidence: Math.min(current.confidence, other.confidence), quad: corners(rect).map(point => ({
        x: Math.max(0, Math.min(width, Math.round(point.x))), y: Math.max(0, Math.min(height, Math.round(point.y))),
      })) as TextQuad };
      output.splice(index, 1);
    }
    output.push(current);
  }
  return output;
}
/** Group the same physical row by perpendicular overlap, rather than a fixed top-edge pixel tolerance. */
export function paddleTextRows(input:readonly PaddleTextBox[]):PaddleTextBox[][] {
  const candidates=input.map(box=>{
    const a=box.quad[0],b=box.quad[1],d=box.quad[3],length=Math.hypot(b.x-a.x,b.y-a.y),height=Math.hypot(d.x-a.x,d.y-a.y);
    return {box,length,height,ux:(b.x-a.x)/length,uy:(b.y-a.y)/length};
  });
  const reference=[...candidates].filter(value=>value.length>=value.height&&Math.abs(value.ux)>.7).sort((a,b)=>b.length-a.length)[0];
  if(!reference)return [...input].sort((a,b)=>a.quad[0].y-b.quad[0].y||a.quad[0].x-b.quad[0].x).map(box=>[box]);
  const {ux,uy}=reference;
  const projected=candidates.map(value=>{
    const us=value.box.quad.map(point=>point.x*ux+point.y*uy),vs=value.box.quad.map(point=>-point.x*uy+point.y*ux);
    return {...value,u:Math.min(...us),v:(Math.min(...vs)+Math.max(...vs))/2,min:Math.min(...vs),max:Math.max(...vs),height:Math.max(...vs)-Math.min(...vs)};
  }).sort((a,b)=>a.min-b.min||a.u-b.u);
  const rows:typeof projected[]=[];
  for(const box of projected){
    const row=rows.find(row=>{
      const anchor=row[0],overlap=Math.min(anchor.max,box.max)-Math.max(anchor.min,box.min);
      return Math.abs(anchor.ux*box.ux+anchor.uy*box.uy)>.99&&Math.abs(anchor.v-box.v)<Math.min(anchor.height,box.height)*.5&&overlap>Math.min(anchor.height,box.height)*.5;
    });
    if(row)row.push(box);else rows.push([box]);
  }
  return rows.map(row=>row.sort((a,b)=>a.u-b.u).map(value=>value.box));
}
export class PaddleDetector {
  private constructor(private session: ort.InferenceSession, readonly config: PaddleDetConfig) {}
  static async create(model: string | Uint8Array, config: PaddleDetConfig, backend: 'cpu' | 'dml' = 'cpu', deviceId = 0) {
    if (!Number.isSafeInteger(deviceId) || deviceId < 0 || deviceId > 31) throw Error('OCR 推理设备无效');
    const options: ort.InferenceSession.SessionOptions = { executionProviders: backend === 'dml' ? [{ name: 'dml', deviceId }] : ['cpu'],
      intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3 };
    const session = typeof model === 'string' ? await ort.InferenceSession.create(model, options) : await ort.InferenceSession.create(model, options);
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) { await session.release(); throw Error('OCR 检测模型输入输出不兼容'); }
    return new PaddleDetector(session, config);
  }
  async run(rgb: Uint8Array, width: number, height: number) {
    const started = performance.now();
    const input = paddleDetInput(rgb, width, height, this.config);
    const prepared = performance.now();
    try {
      const result = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', input.data, input.dims) });
      const output = result[this.session.outputNames[0]];
      if (output.type !== 'float32' || !(output.data instanceof Float32Array)) throw Error('OCR 检测模型输出类型不兼容');
      const inferred = performance.now(), boxes = paddleDetBoxes(output.data, output.dims, width, height, this.config);
      return { ...boxes, timings: { preprocessMs: prepared - started, inferenceMs: inferred - prepared, postprocessMs: performance.now() - inferred } };
    } finally { input.data.fill(0); }
  }
  close() { return this.session.release(); }
}
