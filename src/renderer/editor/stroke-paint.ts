import type { Point } from '../../shared/capture/image-document';
import { strokeDash, type StrokeStyle } from '../../shared/capture/stroke-style';

export function paintStroke(
  context: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  style: StrokeStyle = 'solid',
) {
  const path = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  context.setLineDash(strokeDash(style, width));
  const draw = (vertices: Point[]) => {
    context.beginPath();
    context.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) context.lineTo(vertices[i].x, vertices[i].y);
    context.stroke();
  };
  if (path.length < 2) {
    context.beginPath();
    context.arc(path[0].x, path[0].y, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (style !== 'double' && style !== 'wavy') {
    draw(path);
    return;
  }
  const segments = path.slice(1).map((end, i) => {
    const dx = end.x - path[i].x,
      dy = end.y - path[i].y,
      length = Math.hypot(dx, dy);
    return { length, nx: -dy / length, ny: dx / length };
  });
  const normals = path.map((_p, i) => {
    const a = segments[Math.max(0, i - 1)],
      b = segments[Math.min(segments.length - 1, i)];
    const x = a.nx + b.nx,
      y = a.ny + b.ny,
      length = Math.hypot(x, y);
    return length < 0.01 ? { x: b.nx, y: b.ny } : { x: x / length, y: y / length };
  });
  if (style === 'double') {
    for (const side of [-1, 1])
      draw(
        path.map((p, i) => ({
          x: p.x + normals[i].x * width * side,
          y: p.y + normals[i].y * width * side,
        })),
      );
    return;
  }
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const wavelength = Math.max(12, width * 6),
    step = Math.max(1, Math.min(3, width / 2), total / 65536);
  const vertices: Point[] = [];
  let segment = 0,
    before = 0;
  // Sample by cumulative distance so the wave never restarts at pointer events.
  for (let distance = 0; ; distance = Math.min(total, distance + step)) {
    while (segment < segments.length - 1 && distance > before + segments[segment].length)
      before += segments[segment++].length;
    const t = (distance - before) / segments[segment].length,
      a = path[segment],
      b = path[segment + 1];
    const nx = normals[segment].x * (1 - t) + normals[segment + 1].x * t,
      ny = normals[segment].y * (1 - t) + normals[segment + 1].y * t,
      length = Math.hypot(nx, ny) || 1;
    const amplitude =
      Math.sin((distance * Math.PI * 2) / wavelength) *
      width *
      1.5 *
      Math.min(1, distance / (wavelength / 4), (total - distance) / (wavelength / 4));
    vertices.push({
      x: a.x + (b.x - a.x) * t + (nx / length) * amplitude,
      y: a.y + (b.y - a.y) * t + (ny / length) * amplitude,
    });
    if (distance === total) break;
  }
  draw(vertices);
}
