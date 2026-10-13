import {
  inputKeyLabel,
  inputWindow,
  inputShortcut,
  type InputStyle,
  type RecordingInput,
} from '../../shared/recording/recording-input';

/** Badge bounds are shared with selection handles and the export compositor. */
export function recordingInputBox(
  ctx: CanvasRenderingContext2D,
  events: readonly RecordingInput[],
  sample: number,
  style: InputStyle,
  width: number,
  height: number,
) {
  if (style.keys === 'off') return;
  const key = inputWindow(events, sample, style.duration)
    .reverse()
    .find((e) => e.kind === 'key' && (style.keys === 'all' || inputShortcut(e)));
  if (!key || key.kind !== 'key') return;
  const unit = Math.max(0.5, Math.min(width / 960, height / 540)),
    font = style.size * unit,
    label = inputKeyLabel(key),
    max = Math.max(1, width - 32 * unit);
  ctx.font = `600 ${font}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  const boxWidth = Math.min(max, ctx.measureText(label).width + 32 * unit),
    boxHeight = Math.min(height, font + 24 * unit),
    x =
      style.position === 'custom'
        ? Math.max(0, Math.min((style.x || 0) * width, width - boxWidth))
        : style.position.endsWith('left')
          ? 16 * unit
          : style.position.endsWith('right')
            ? width - boxWidth - 16 * unit
            : (width - boxWidth) / 2,
    y =
      style.position === 'custom'
        ? Math.max(0, Math.min((style.y || 0) * height, height - boxHeight))
        : style.position.startsWith('top')
          ? 16 * unit
          : height - boxHeight - 20 * unit;
  return { x, y, width: boxWidth, height: boxHeight, font, unit, label, key, max };
}
/** Shared live / seekable replay layer; coordinates are encoded-video pixels. */
export function drawRecordingInput(
  canvas: HTMLCanvasElement,
  events: readonly RecordingInput[],
  sample: number,
  style: InputStyle,
  width: number,
  height: number,
) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!width || !height) return;
  ctx.save();
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const ox = (canvas.width - width * scale) / 2,
    oy = (canvas.height - height * scale) / 2;
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  paintRecordingInput(ctx, events, sample, style, width, height);
  ctx.restore();
}
export function paintRecordingInput(
  ctx: CanvasRenderingContext2D,
  events: readonly RecordingInput[],
  sample: number,
  style: InputStyle,
  width: number,
  height: number,
) {
  if (!width || !height) return;
  const recent = inputWindow(events, sample, Math.max(style.duration, 900));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const unit = Math.max(0.5, Math.min(width / 960, height / 540));
  const age = (e: RecordingInput) => (sample - e.sample) / 48;
  if (style.trail) {
    let previous: Extract<RecordingInput, { kind: 'move' | 'click' | 'wheel' }> | undefined;
    ctx.lineWidth = 3 * unit;
    ctx.lineCap = 'round';
    ctx.strokeStyle = style.color;
    for (const e of recent) {
      if (e.kind === 'leave') {
        previous = undefined;
        continue;
      }
      if (e.kind !== 'move') continue;
      if (age(e) > 600 / style.animation) {
        previous = undefined;
        continue;
      }
      if (previous && e.sample - previous.sample < 4800) {
        ctx.globalAlpha = Math.max(0, 1 - age(e) / (600 / style.animation)) * 0.8;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      }
      previous = e;
    }
  }
  if (style.clicks)
    for (const e of recent) {
      if (e.kind !== 'click' && e.kind !== 'wheel') continue;
      const progress = age(e) / (650 / style.animation);
      if (progress < 0 || progress >= 1) continue;
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = 2.5 * unit;
      const r = (10 + progress * 24) * unit;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha *= 0.18;
      ctx.fill();
      ctx.globalAlpha = 1 - progress;
      ctx.font = `600 ${12 * unit}px "Segoe UI",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (e.kind === 'wheel') ctx.fillText(e.button > 0 ? '↑' : '↓', e.x, e.y);
      else if (e.button !== 1)
        ctx.fillText(e.button === 2 ? 'R' : e.button === 3 ? 'M' : String(e.button), e.x, e.y);
    }
  const box = recordingInputBox(ctx, events, sample, style, width, height);
  if (box) {
    const { label, font, max, width: boxWidth, height: boxHeight, x, y, key } = box;
    ctx.font = `600 ${font}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.globalAlpha = Math.min(1, (style.duration - age(key)) / 180);
    ctx.fillStyle = '#202425';
    ctx.shadowColor = '#00000040';
    ctx.shadowBlur = 12 * unit;
    ctx.shadowOffsetY = 3 * unit;
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 10 * unit);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#ffffff26';
    ctx.lineWidth = unit;
    ctx.stroke();
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + boxWidth / 2, y + boxHeight / 2, max - 20 * unit);
  }
  ctx.restore();
}
