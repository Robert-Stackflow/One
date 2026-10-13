import type { CameraStyle } from '../../shared/recording/recording-camera';
export function drawCamera(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  style: CameraStyle,
  box: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
) {
  if (!style.visible || !sourceWidth || !sourceHeight) return;
  const { x, y, width, height } = box,
    radius =
      style.shape === 'circle'
        ? Math.min(width, height) / 2
        : style.shape === 'rounded'
          ? Math.min(width, height) * 0.1
          : 0;
  context.save();
  context.globalAlpha = style.opacity;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  if (style.shadow) {
    context.shadowColor = '#00000055';
    context.shadowBlur = Math.max(4, width * 0.04);
    context.shadowOffsetY = width * 0.015;
    context.fillStyle = '#000';
    context.fill();
    context.shadowColor = 'transparent';
  }
  context.save();
  context.clip();
  if (style.mirror) {
    context.translate(x * 2 + width, 0);
    context.scale(-1, 1);
  }
  const ratio = Math.max(width / sourceWidth, height / sourceHeight),
    sw = width / ratio,
    sh = height / ratio;
  context.drawImage(
    source,
    (sourceWidth - sw) / 2,
    (sourceHeight - sh) / 2,
    sw,
    sh,
    x,
    y,
    width,
    height,
  );
  context.restore();
  if (style.border) {
    context.strokeStyle = style.color;
    context.lineWidth = style.border;
    context.stroke();
  }
  context.restore();
}
