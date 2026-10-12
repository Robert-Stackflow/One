import type { Rectangle } from './region';
export interface ContentMatch extends Rectangle {
  score: number;
}
/** Local same-size template matching. Anchor rejection avoids convolving every
 * desktop pixel; surviving patches use normalized cross-correlation (as in
 * OpenCV TM_CCOEFF_NORMED) plus RGB error, followed by non-maximum suppression.
 * This matches repeated pixels, not the meaning of text or sensitive content. */
export function matchContent(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  template: Rectangle,
  threshold = 0.98,
  timeLimit = 8000,
): ContentMatch[] {
  if (
    ![width, height, template.x, template.y, template.width, template.height].every(
      Number.isSafeInteger,
    ) ||
    width < 2 ||
    height < 2 ||
    width * height > 40_000_000 ||
    rgba.length !== width * height * 4 ||
    template.x < 0 ||
    template.y < 0 ||
    template.width < 4 ||
    template.height < 4 ||
    template.width * template.height > 1_000_000 ||
    template.x + template.width > width ||
    template.y + template.height > height ||
    threshold < 0.9 ||
    threshold > 1
  )
    throw Error('匹配范围无效，请框选一处完整内容');
  const tw = template.width,
    th = template.height,
    seed = new Uint8Array(tw * th * 3),
    samples: { x: number; y: number; r: number; g: number; b: number; contrast: number }[] = [];
  let mean = 0,
    square = 0;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const at = ((template.y + y) * width + template.x + x) * 4,
        index = (y * tw + x) * 3;
      const r = rgba[at],
        g = rgba[at + 1],
        b = rgba[at + 2],
        value = (r + g + b) / 3;
      seed[index] = r;
      seed[index + 1] = g;
      seed[index + 2] = b;
      mean += value;
      square += value * value;
    }
  const pixels = tw * th;
  mean /= pixels;
  if (square / pixels - mean * mean < 36) throw Error('选区缺少可识别的内容，请包含完整文字或图案');
  // Retain contrast anchors distributed across the template, including details
  // narrower than a regular grid step (for example a one-pixel text stroke).
  const gx = Math.min(8, tw),
    gy = Math.min(6, th);
  for (let row = 0; row < gy; row++)
    for (let col = 0; col < gx; col++) {
      let best = { x: 0, y: 0, r: 0, g: 0, b: 0, contrast: -1 };
      for (let y = Math.floor((row * th) / gy); y < Math.floor(((row + 1) * th) / gy); y++)
        for (let x = Math.floor((col * tw) / gx); x < Math.floor(((col + 1) * tw) / gx); x++) {
          const at = (y * tw + x) * 3,
            r = seed[at],
            g = seed[at + 1],
            b = seed[at + 2];
          const contrast = Math.abs(r - mean) + Math.abs(g - mean) + Math.abs(b - mean);
          if (contrast > best.contrast) best = { x, y, r, g, b, contrast };
        }
      samples.push(best);
    }
  samples.sort((a, b) => b.contrast - a.contrast);
  const anchors = [
    samples[0],
    ...samples
      .filter((p) => Math.hypot(p.x - samples[0].x, p.y - samples[0].y) >= Math.min(tw, th) / 2)
      .slice(0, 2),
  ];
  const found: ContentMatch[] = [],
    deadline = Date.now() + timeLimit;
  for (let y = 0; y <= height - th; y++) {
    if (Date.now() > deadline) throw Error('匹配耗时过长，请缩小截图选区后重试');
    for (let x = 0; x <= width - tw; x++) {
      let skip = false;
      for (const p of anchors) {
        const at = ((y + p.y) * width + x + p.x) * 4;
        if (
          Math.abs(rgba[at] - p.r) + Math.abs(rgba[at + 1] - p.g) + Math.abs(rgba[at + 2] - p.b) >
          54
        ) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      let anchorError = 0;
      for (const p of samples) {
        const at = ((y + p.y) * width + x + p.x) * 4;
        anchorError +=
          Math.abs(rgba[at] - p.r) + Math.abs(rgba[at + 1] - p.g) + Math.abs(rgba[at + 2] - p.b);
      }
      if (anchorError / (samples.length * 3) > 10) continue;
      let sum = 0,
        sum2 = 0,
        dot = 0,
        error = 0;
      for (let yy = 0; yy < th; yy++)
        for (let xx = 0; xx < tw; xx++) {
          const at = ((y + yy) * width + x + xx) * 4,
            index = (yy * tw + xx) * 3;
          const r = rgba[at],
            g = rgba[at + 1],
            b = rgba[at + 2],
            a = (seed[index] + seed[index + 1] + seed[index + 2]) / 3,
            v = (r + g + b) / 3;
          sum += v;
          sum2 += v * v;
          dot += a * v;
          error +=
            Math.abs(r - seed[index]) +
            Math.abs(g - seed[index + 1]) +
            Math.abs(b - seed[index + 2]);
        }
      const variance = sum2 - (sum * sum) / pixels,
        denominator = Math.sqrt((square - mean * mean * pixels) * Math.max(0, variance));
      const score = denominator > 0 ? Math.min(1, (dot - mean * sum) / denominator) : 0;
      if (score < threshold || error / (pixels * 3) > 8) continue;
      const match = { x, y, width: tw, height: th, score };
      const overlap = found.findIndex(
        (p) =>
          Math.max(0, Math.min(p.x + tw, x + tw) - Math.max(p.x, x)) *
            Math.max(0, Math.min(p.y + th, y + th) - Math.max(p.y, y)) >
          pixels / 2,
      );
      if (overlap >= 0) {
        if (found[overlap].score < score) found[overlap] = match;
      } else {
        if (found.length >= 100) throw Error('相同内容过多，请缩小截图选区后重试');
        found.push(match);
      }
    }
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x);
}
