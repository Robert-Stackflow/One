import type { Rectangle } from './region';
import type { Point } from './image-document';
export interface CaptureCandidate {
  kind: 'window' | 'element' | 'screen';
  rect: Rectangle;
}
export interface CandidateUpdate {
  point: Point;
  candidates: CaptureCandidate[];
  partial: boolean;
}
export const candidateContains = (candidate: CaptureCandidate, point: Point) =>
  point.x >= candidate.rect.x &&
  point.y >= candidate.rect.y &&
  point.x < candidate.rect.x + candidate.rect.width &&
  point.y < candidate.rect.y + candidate.rect.height;

/** A fast HWND response must not erase a deeper result from the same window. */
export function stableCandidates(
  previous: CaptureCandidate[],
  update: CandidateUpdate,
): CaptureCandidate[] {
  const incoming = update.candidates.filter((c) => candidateContains(c, update.point));
  const window = incoming.find((c) => c.kind === 'window');
  const sameWindow =
    window &&
    previous.some(
      (c) => c.kind === 'window' && JSON.stringify(c.rect) === JSON.stringify(window.rect),
    );
  const retained =
    update.partial && sameWindow
      ? previous.filter((c) => c.kind === 'element' && candidateContains(c, update.point))
      : [];
  const result = [...retained];
  for (const candidate of incoming) {
    const close = previous.find(
      (c) =>
        c.kind === candidate.kind &&
        candidateContains(c, update.point) &&
        ['x', 'y', 'width', 'height'].every(
          (k) => Math.abs(c.rect[k as keyof Rectangle] - candidate.rect[k as keyof Rectangle]) <= 1,
        ),
    );
    const next = close || candidate;
    if (!result.some((c) => JSON.stringify(c.rect) === JSON.stringify(next.rect)))
      result.push(next);
  }
  return result.sort(
    (a, b) =>
      Number(a.kind === 'screen') - Number(b.kind === 'screen') ||
      a.rect.width * a.rect.height - b.rect.width * b.rect.height,
  );
}
export function capturePoint(value: unknown, width: number, height: number): Point {
  const p = value as Point;
  if (
    !p ||
    ![p.x, p.y].every(Number.isSafeInteger) ||
    p.x < 0 ||
    p.y < 0 ||
    p.x >= width ||
    p.y >= height
  )
    throw Error('截图定位无效');
  return { x: p.x, y: p.y };
}
/** Physical desktop pixels -> original image pixels, including negative monitor origins. */
export function captureCandidates(
  value: unknown,
  physical: Rectangle,
  width: number,
  height: number,
  point: Point,
): CaptureCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length > 24 ||
    ![physical.x, physical.y, physical.width, physical.height, width, height].every(
      Number.isFinite,
    ) ||
    physical.width <= 0 ||
    physical.height <= 0 ||
    width < 2 ||
    height < 2
  )
    throw Error('截图候选范围无效');
  const result: CaptureCandidate[] = [];
  for (const candidate of value) {
    const r = candidate?.rect;
    if (
      !['window', 'element'].includes(candidate?.kind) ||
      !r ||
      ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
      r.width < 2 ||
      r.height < 2 ||
      Math.abs(r.x) > 100000 ||
      Math.abs(r.y) > 100000 ||
      r.width > 100000 ||
      r.height > 100000
    )
      throw Error('截图候选范围无效');
    const left = Math.max(0, Math.floor(((r.x - physical.x) * width) / physical.width)),
      top = Math.max(0, Math.floor(((r.y - physical.y) * height) / physical.height));
    const right = Math.min(
        width,
        Math.ceil(((r.x + r.width - physical.x) * width) / physical.width),
      ),
      bottom = Math.min(
        height,
        Math.ceil(((r.y + r.height - physical.y) * height) / physical.height),
      );
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    if (
      rect.width < 2 ||
      rect.height < 2 ||
      point.x < left ||
      point.y < top ||
      point.x >= right ||
      point.y >= bottom
    )
      continue;
    if (result.some((c) => JSON.stringify(c.rect) === JSON.stringify(rect))) continue;
    result.push({ kind: candidate.kind, rect });
  }
  result.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  result.push({ kind: 'screen', rect: { x: 0, y: 0, width, height } });
  return result;
}
export function desktopCapturePoint(
  point: Point,
  physical: Rectangle,
  width: number,
  height: number,
): Point {
  return {
    x: physical.x + Math.min(physical.width - 1, Math.round((point.x * physical.width) / width)),
    y: physical.y + Math.min(physical.height - 1, Math.round((point.y * physical.height) / height)),
  };
}
/** Image pixels -> content-window DIP, matching the centered, aspect-fit canvas. */
export function previewCapturePoint(
  value: unknown,
  viewport: Rectangle,
  width: number,
  height: number,
): Point {
  const point = capturePoint(value, width, height);
  if (
    ![viewport.x, viewport.y, viewport.width, viewport.height, width, height].every(
      Number.isSafeInteger,
    ) ||
    viewport.width < 1 ||
    viewport.height < 1 ||
    width < 1 ||
    height < 1
  )
    throw Error('截图视图尺寸无效');
  const scale = Math.min(viewport.width / width, viewport.height / height);
  return {
    x: Math.max(
      viewport.x,
      Math.min(
        viewport.x + viewport.width - 1,
        Math.round(viewport.x + (viewport.width - width * scale) / 2 + point.x * scale),
      ),
    ),
    y: Math.max(
      viewport.y,
      Math.min(
        viewport.y + viewport.height - 1,
        Math.round(viewport.y + (viewport.height - height * scale) / 2 + point.y * scale),
      ),
    ),
  };
}
