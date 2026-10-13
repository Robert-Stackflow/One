import {
  cursorAt,
  cursorFrameAt,
  type CursorStyle,
  type CursorShape,
  type RecordingCursor,
} from '../../shared/recording/recording-cursor';
export function cursorImages(shapes: CursorShape[]) {
  return new Map(
    shapes.map((shape) => {
      const normal = document.createElement('canvas'),
        inverse = document.createElement('canvas');
      normal.width = inverse.width = shape.width;
      normal.height = inverse.height = shape.height;
      const rgba = new ImageData(shape.width, shape.height),
        mask = new ImageData(shape.width, shape.height),
        raw = atob(shape.pixels);
      for (let i = 0; i < shape.width * shape.height; i++) {
        for (let c = 0; c < 4; c++) rgba.data[i * 4 + c] = raw.charCodeAt(i * 5 + c);
        mask.data[i * 4] = mask.data[i * 4 + 1] = mask.data[i * 4 + 2] = 255;
        mask.data[i * 4 + 3] = raw.charCodeAt(i * 5 + 4);
      }
      normal.getContext('2d')!.putImageData(rgba, 0, 0);
      inverse.getContext('2d')!.putImageData(mask, 0, 0);
      return [shape.id, { normal, inverse, shape }] as const;
    }),
  );
}
export function paintRecordingCursor(
  ctx: CanvasRenderingContext2D,
  data: RecordingCursor,
  sample: number,
  style: CursorStyle,
  images: ReturnType<typeof cursorImages>,
  inverse = false,
) {
  if (!style.visible) return;
  if (!inverse && style.trail && style.trail !== 'none') {
    const duration = 0.65 / style.animation,
      start = sample - duration * 48000;
    let lo = 0,
      hi = data.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (data.events[mid].sample < start) lo = mid + 1;
      else hi = mid;
    }
    let previous: RecordingCursor['events'][number] | undefined;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = style.color;
    for (let i = lo; i < data.events.length && data.events[i].sample <= sample; i++) {
      const point = data.events[i],
        fade = Math.max(0, 1 - (sample - point.sample) / (duration * 48000));
      if (!point.shape) {
        previous = undefined;
        continue;
      }
      ctx.globalAlpha = fade * 0.85;
      if (style.trail === 'dots') {
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(0.5, (1 + 3 * fade) * style.size), 0, Math.PI * 2);
        ctx.fill();
      } else if (
        previous &&
        previous.segment === point.segment &&
        point.sample - previous.sample < 4800
      ) {
        ctx.lineWidth = (style.trail === 'ribbon' ? 2 + 9 * fade : 3) * style.size;
        ctx.shadowColor = style.color;
        ctx.shadowBlur = style.trail === 'laser' ? 10 * style.size : 0;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      previous = point;
    }
    ctx.restore();
  }
  const event = cursorAt(data.events, sample);
  if (event?.shape) {
    const image = images.get(cursorFrameAt(data, sample, style.animation));
    if (image) {
      const scale = event.scale * style.size,
        s = image.shape;
      ctx.save();
      if (inverse) ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(
        inverse ? image.inverse : image.normal,
        event.x - s.hotspotX * scale,
        event.y - s.hotspotY * scale,
        s.width * scale,
        s.height * scale,
      );
      ctx.restore();
    }
  }
  if (inverse || !style.clicks) return;
  const begin = sample - (48000 * 0.6) / style.animation;
  let lo = 0,
    hi = data.events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data.events[mid].sample <= sample) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const click = data.events[i];
    if (click.sample < begin) break;
    if (!click.click || !click.shape) continue;
    const age = (((sample - click.sample) / 48000) * style.animation) / 0.6;
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = 2 * style.size;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    if (style.clickStyle === 'spotlight') {
      ctx.globalAlpha *= 0.28;
      ctx.arc(click.x, click.y, (22 + 10 * age) * style.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.arc(click.x, click.y, (8 + 24 * age) * style.size, 0, Math.PI * 2);
      ctx.stroke();
      if (style.clickStyle === 'ripple') {
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.arc(click.x, click.y, (4 + 16 * age) * style.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.3;
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
