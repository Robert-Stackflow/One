import { playbackTime, type TimeOverlay } from '../../shared/recording/recording-playback';
export function recordingTimeBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seconds: number,
  duration: number,
  style: TimeOverlay,
) {
  const size = Math.min(style.size, Math.max(0.1, height / 4)),
    pad = size * 0.55,
    text = playbackTime(seconds) + ' / ' + playbackTime(duration);
  ctx.font = `500 ${size}px "Segoe UI", sans-serif`;
  const margin = Math.min(16, width * 0.02, height * 0.02),
    circular = style.progress && style.shape === 'circle',
    boxWidth = Math.min(
      Math.max(0.1, width - margin * 2),
      circular
        ? Math.min(height - margin * 2, Math.max(size * 4.6, Math.min(width, height) * style.width))
        : Math.max(ctx.measureText(text).width + pad * 2, style.progress ? width * style.width : 0),
    ),
    boxHeight = circular ? boxWidth : size * 1.4 + pad * 2 + (style.progress ? 6 : 0),
    x =
      style.position === 'custom'
        ? Math.max(0, Math.min((style.x || 0) * width, width - boxWidth))
        : style.position.endsWith('left')
          ? margin
          : style.position.endsWith('right')
            ? width - boxWidth - margin
            : (width - boxWidth) / 2,
    y =
      style.position === 'custom'
        ? Math.max(0, Math.min((style.y || 0) * height, height - boxHeight))
        : style.position.startsWith('top')
          ? margin
          : Math.max(margin, height - boxHeight - margin);
  return { x, y, width: boxWidth, height: boxHeight, size, pad, text, circular };
}
/** Canonical video coordinates shared by preview and export. */
export function drawRecordingTime(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seconds: number,
  duration: number,
  style: TimeOverlay,
) {
  if (!style.visible || !width || !height) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const {
    x,
    y,
    width: boxWidth,
    height: boxHeight,
    size,
    pad,
    text,
    circular,
  } = recordingTimeBox(ctx, width, height, seconds, duration, style);
  ctx.globalAlpha = style.opacity * style.backgroundOpacity;
  ctx.fillStyle = style.background;
  ctx.beginPath();
  if (circular) ctx.arc(x + boxWidth / 2, y + boxHeight / 2, boxWidth / 2, 0, Math.PI * 2);
  else ctx.roundRect(x, y, boxWidth, boxHeight, 8);
  ctx.fill();
  ctx.globalAlpha = style.opacity;
  ctx.fillStyle = style.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (circular) {
    const cx = x + boxWidth / 2,
      cy = y + boxHeight / 2,
      radius = boxWidth / 2 - Math.max(4, size * 0.22),
      progress = Math.min(1, Math.max(0, duration ? seconds / duration : 0));
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
    ctx.fillText(playbackTime(seconds), cx, cy - size * 0.32, boxWidth - size);
    ctx.font = `400 ${size * 0.58}px "Segoe UI", sans-serif`;
    ctx.globalAlpha = style.opacity * 0.65;
    ctx.fillText('/ ' + playbackTime(duration), cx, cy + size * 0.65, boxWidth - size);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(2, size * 0.15);
    ctx.globalAlpha = style.opacity * 0.2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (progress) {
      ctx.globalAlpha = style.opacity;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }
  } else {
    ctx.fillText(text, x + boxWidth / 2, y + pad + size * 0.7, Math.max(1, boxWidth - pad * 2));
  }
  if (style.progress && !circular) {
    ctx.globalAlpha = style.opacity * 0.2;
    ctx.fillRect(x + pad, y + boxHeight - pad - 3, Math.max(1, boxWidth - pad * 2), 3);
    ctx.globalAlpha = style.opacity;
    ctx.fillRect(
      x + pad,
      y + boxHeight - pad - 3,
      Math.max(1, boxWidth - pad * 2) * Math.min(1, Math.max(0, duration ? seconds / duration : 0)),
      3,
    );
  }
  ctx.restore();
}
