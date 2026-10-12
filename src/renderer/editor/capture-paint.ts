import { watermarkBitmap } from './watermark-bitmap';
import {
  localAnnotationBounds,
  identity,
  inverted,
  multiplied,
  mappedPoint,
  type Annotation,
  type ImageDocument,
} from '../../shared/capture/image-document';
import { outputLayout } from '../../shared/capture/image-output';
import { annotationFont, watermarkText, watermarkAnchors } from '../../shared/capture/watermark';
import { paintStroke } from './stroke-paint';
import { magnifierSample } from '../../shared/capture/magnifier';

export function paintCapture(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  scene: ImageDocument,
) {
  context.clearRect(0, 0, scene.width, scene.height);
  context.save();
  context.transform(...scene.transform);
  context.drawImage(source, 0, 0);
  context.restore();
  paintAnnotations(context, scene, source);
}
/** Shared vector renderer for screenshots, live recording and timeline playback. */
export function paintAnnotations(
  context: CanvasRenderingContext2D,
  scene: ImageDocument,
  source?: CanvasImageSource,
  backdrop?: CanvasImageSource,
) {
  const selection = scene.selection;
  if (!selection) return;
  context.save();
  context.beginPath();
  context.rect(selection.x, selection.y, selection.width, selection.height);
  context.clip();
  if (scene.selectionMask) {
    context.beginPath();
    scene.selectionMask.points.forEach((p, i) =>
      i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y),
    );
    context.closePath();
    context.clip('evenodd');
  }
  for (const annotation of scene.annotations)
    paintAnnotation(context, source, annotation, scene, backdrop);
  context.restore();
}
function strokeArea(a: Annotation) {
  const path = new Path2D(),
    points = a.points.length ? a.points : [a.start],
    radius = a.width / 2;
  for (const p of points) {
    path.moveTo(p.x + radius, p.y);
    path.arc(p.x, p.y, radius, 0, Math.PI * 2);
    path.closePath();
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const nx = (-(b.y - a.y) * radius) / length,
      ny = ((b.x - a.x) * radius) / length;
    path.moveTo(a.x - nx, a.y - ny);
    path.lineTo(b.x - nx, b.y - ny);
    path.lineTo(b.x + nx, b.y + ny);
    path.lineTo(a.x + nx, a.y + ny);
    path.closePath();
  }
  return path;
}
function paintAnnotation(
  c: CanvasRenderingContext2D,
  source: CanvasImageSource | undefined,
  a: Annotation,
  doc: ImageDocument,
  backdrop?: CanvasImageSource,
) {
  const r = localAnnotationBounds(a);
  c.save();
  if (a.transform) c.transform(...a.transform);
  c.strokeStyle = c.fillStyle = a.color;
  c.lineWidth = a.width;
  c.lineCap = c.lineJoin = 'round';
  c.beginPath();
  if (['rectangle', 'roundrect', 'triangle', 'diamond', 'solid'].includes(a.tool)) {
    if (a.tool === 'roundrect')
      c.roundRect(r.x, r.y, r.width, r.height, Math.min(r.width, r.height) / 8);
    else if (a.tool === 'triangle') {
      c.moveTo(r.x + r.width / 2, r.y);
      c.lineTo(r.x + r.width, r.y + r.height);
      c.lineTo(r.x, r.y + r.height);
      c.closePath();
    } else if (a.tool === 'diamond') {
      c.moveTo(r.x + r.width / 2, r.y);
      c.lineTo(r.x + r.width, r.y + r.height / 2);
      c.lineTo(r.x + r.width / 2, r.y + r.height);
      c.lineTo(r.x, r.y + r.height / 2);
      c.closePath();
    } else c.rect(r.x, r.y, r.width, r.height);
    if (a.filled || a.tool === 'solid') c.fill();
    if (a.tool !== 'solid') c.stroke();
  } else if (a.tool === 'ellipse') {
    c.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
    if (a.filled) c.fill();
    c.stroke();
  } else if (['line', 'arrow', 'brush', 'highlight'].includes(a.tool)) {
    const points = a.points.length ? a.points : [a.start, a.end];
    if (a.tool === 'highlight') {
      c.globalAlpha = 0.28;
      c.lineWidth = a.width * 5;
      c.lineCap = 'butt';
    }
    if (points.length === 1) {
      if (a.tool === 'highlight')
        c.fillRect(
          points[0].x - c.lineWidth / 2,
          points[0].y - c.lineWidth / 2,
          c.lineWidth,
          c.lineWidth,
        );
      else {
        c.arc(points[0].x, points[0].y, c.lineWidth / 2, 0, Math.PI * 2);
        c.fill();
      }
    } else paintStroke(c, points, c.lineWidth, a.strokeStyle);
    if (a.tool === 'arrow') {
      const angle = Math.atan2(a.end.y - a.start.y, a.end.x - a.start.x),
        size = Math.max(10, a.width * 4);
      c.beginPath();
      c.setLineDash([]);
      c.moveTo(a.end.x, a.end.y);
      c.lineTo(a.end.x - Math.cos(angle - 0.5) * size, a.end.y - Math.sin(angle - 0.5) * size);
      c.moveTo(a.end.x, a.end.y);
      c.lineTo(a.end.x - Math.cos(angle + 0.5) * size, a.end.y - Math.sin(angle + 0.5) * size);
      c.stroke();
    }
  } else if (a.tool === 'text' || a.tool === 'watermark') {
    const size = a.fontSize || Math.max(12, a.width * 6);
    c.font = annotationFont(size, a.fontFamily, a.fontWeight, a.italic);
    c.textBaseline = 'top';
    const text = (line: string, x: number, y: number) => {
      if (a.textOutline) {
        c.save();
        c.setLineDash([]);
        c.strokeStyle = '#ffffff';
        c.lineWidth = Math.max(2, size / 8);
        c.lineJoin = 'round';
        c.strokeText(line, x, y);
        c.restore();
      }
      c.fillText(line, x, y);
    };
    if (a.tool === 'watermark' && a.watermark) {
      const style = a.watermark,
        content = watermarkText(a.text, style.capturedAt),
        lines = content.split('\n');
      const bitmap = style.image ? watermarkBitmap(style.image) : undefined;
      const bounds = style.image
        ? {
            width: style.image.width * style.image.scale,
            height: style.image.height * style.image.scale,
          }
        : {
            width: Math.max(1, ...lines.map((line) => c.measureText(line).width)),
            height: lines.length * size * 1.2,
          };
      c.globalAlpha = style.opacity;
      // Fixed/tiled watermarks follow the output selection, even after rotation/crop.
      if (style.position !== 'custom') c.transform(...inverted(a.transform || identity()));
      for (const point of watermarkAnchors(doc.selection!, bounds, style, a.start)) {
        c.save();
        c.translate(point.x, point.y);
        c.rotate((style.angle * Math.PI) / 180);
        if (bitmap)
          c.drawImage(bitmap, -bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height);
        else
          lines.forEach((line, i) =>
            text(line, -bounds.width / 2, -bounds.height / 2 + i * size * 1.2),
          );
        c.restore();
      }
    } else
      a.text.split('\n').forEach((line, i) => text(line, a.start.x, a.start.y + i * size * 1.2));
  } else if (a.tool === 'step') {
    const radius = Math.max(10, a.width * 5);
    c.arc(a.start.x, a.start.y, radius, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = '600 ' + radius * 1.2 + 'px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(a.number), a.start.x, a.start.y);
  } else if (a.tool === 'erasebrush') {
    c.save();
    c.clip(strokeArea(a));
    c.clearRect(r.x, r.y, r.width, r.height);
    c.transform(...multiplied(inverted(a.transform || identity()), doc.transform));
    if (source) c.drawImage(source, 0, 0);
    c.restore();
  } else if (a.tool === 'mosaic' || a.tool === 'blur') {
    const inverse = inverted(a.transform || identity()),
      selection = doc.selection!,
      corners = [
        { x: selection.x, y: selection.y },
        { x: selection.x + selection.width, y: selection.y },
        { x: selection.x, y: selection.y + selection.height },
        { x: selection.x + selection.width, y: selection.y + selection.height },
      ].map((p) => mappedPoint(inverse, p));
    const x = Math.max(Math.floor(r.x), Math.min(...corners.map((p) => p.x))),
      y = Math.max(Math.floor(r.y), Math.min(...corners.map((p) => p.y))),
      width = Math.min(Math.ceil(r.x + r.width), Math.max(...corners.map((p) => p.x))) - x,
      height = Math.min(Math.ceil(r.y + r.height), Math.max(...corners.map((p) => p.y))) - y;
    if (width > 0 && height > 0) {
      const scratch = document.createElement('canvas'),
        blur = a.tool === 'blur',
        padding = blur ? a.strength * 3 : 0,
        sampleWidth = width + padding * 2,
        sampleHeight = height + padding * 2;
      const factor = Math.max(
        blur ? 1 : Math.max(2, a.strength),
        sampleWidth / 2048,
        sampleHeight / 2048,
      );
      scratch.width = Math.max(1, Math.ceil(sampleWidth / factor));
      scratch.height = Math.max(1, Math.ceil(sampleHeight / factor));
      const sample = scratch.getContext('2d')!;
      sample.scale(scratch.width / sampleWidth, scratch.height / sampleHeight);
      sample.translate(-x + padding, -y + padding);
      if (backdrop) {
        // Video layers are transparent. Sample this frame beneath the marks,
        // in document coordinates, before compositing preceding annotations.
        sample.save();
        sample.transform(...inverse);
        sample.drawImage(backdrop, 0, 0, doc.width, doc.height);
        sample.restore();
      }
      const matrix = c.getTransform().inverse();
      sample.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      // Sample the composed image so redaction also covers earlier annotations.
      sample.drawImage(c.canvas, 0, 0);
      c.save();
      c.beginPath();
      if (a.brush) c.clip(strokeArea(a));
      else {
        c.rect(x, y, width, height);
        c.clip();
      }
      c.clearRect(x, y, width, height);
      c.imageSmoothingEnabled = blur;
      if (blur) c.filter = 'blur(' + a.strength + 'px)';
      c.drawImage(scratch, x - padding, y - padding, sampleWidth, sampleHeight);
      c.restore();
      scratch.width = scratch.height = 0;
    }
  } else if (a.tool === 'magnify') {
    const cx = r.x + r.width / 2,
      cy = r.y + r.height / 2,
      sample = magnifierSample(a, doc);
    c.ellipse(cx, cy, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
    c.save();
    c.clip();
    c.translate(cx, cy);
    c.scale(r.width / sample.width, r.height / sample.height);
    c.translate(-sample.x - sample.width / 2, -sample.y - sample.height / 2);
    c.transform(...multiplied(inverted(a.transform || identity()), doc.transform));
    c.drawImage(source!, 0, 0);
    c.restore();
    c.stroke();
  } else if (a.tool === 'spotlight') {
    const s = doc.selection!;
    c.save();
    c.transform(...inverted(a.transform || identity()));
    c.rect(s.x, s.y, s.width, s.height);
    c.restore();
    c.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
    c.fillStyle = '#000000';
    c.globalAlpha = 0.55;
    c.globalCompositeOperation = 'source-atop';
    c.fill('evenodd');
  }
  c.restore();
}
export function captureOutput(
  source: CanvasImageSource,
  scene: ImageDocument,
  scale = 1,
): HTMLCanvasElement {
  if (!scene.selection) throw Error('请先选择截图区域');
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw Error('输出缩放无效');
  const r = scene.selection,
    layout = outputLayout(r.width, r.height, scene.effects),
    canvas = document.createElement('canvas');
  canvas.width = Math.ceil(r.width * scale);
  canvas.height = Math.ceil(r.height * scale);
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);
  context.save();
  context.beginPath();
  context.roundRect(0, 0, r.width, r.height, layout.radius);
  context.clip();
  if (scene.selectionMask) {
    context.beginPath();
    scene.selectionMask.points.forEach((p, i) =>
      i ? context.lineTo(p.x - r.x, p.y - r.y) : context.moveTo(p.x - r.x, p.y - r.y),
    );
    context.closePath();
    context.clip('evenodd');
  }
  context.save();
  context.translate(-r.x, -r.y);
  paintCapture(context, source, scene);
  context.restore();
  if (layout.borderWidth) {
    const b = layout.borderWidth;
    context.strokeStyle = scene.effects.border.color;
    context.lineWidth = scene.selectionMask ? b * 2 : b;
    context.beginPath();
    if (scene.selectionMask) {
      scene.selectionMask.points.forEach((p, i) =>
        i ? context.lineTo(p.x - r.x, p.y - r.y) : context.moveTo(p.x - r.x, p.y - r.y),
      );
      context.closePath();
    } else
      context.roundRect(
        b / 2,
        b / 2,
        r.width - b,
        r.height - b,
        Math.max(0, layout.radius - b / 2),
      );
    context.stroke();
  }
  context.restore();
  const s = scene.effects.shadow;
  if (!s.enabled || !s.opacity) return canvas;
  const result = document.createElement('canvas');
  result.width = Math.ceil(layout.width * scale);
  result.height = Math.ceil(layout.height * scale);
  const output = result.getContext('2d')!;
  output.shadowColor =
    s.color +
    Math.round(s.opacity * 255)
      .toString(16)
      .padStart(2, '0');
  output.shadowBlur = s.blur * scale;
  output.shadowOffsetX = s.x * scale;
  output.shadowOffsetY = s.y * scale;
  output.drawImage(canvas, layout.x * scale, layout.y * scale);
  canvas.width = canvas.height = 0;
  return result;
}
