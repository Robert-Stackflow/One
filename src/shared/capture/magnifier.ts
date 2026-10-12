import type { Rectangle } from './region';
import {
  annotationBounds,
  localAnnotationBounds,
  mappedPoint,
  inverted,
  identity,
  multiplied,
  moveAnnotation,
  resizeAnnotation,
  resizeSelection,
  type Annotation,
  type ImageDocument,
  type Affine,
  type SelectionHandle,
  type Point,
} from './image-document';

export type MagnifierPart = 'target' | 'source';
export function mappedRectangle(rect: Rectangle, matrix: Affine): Rectangle {
  const corners = [
    rect,
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((p) => mappedPoint(matrix, p));
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
}
/** Legacy files keep the original fixed 2x appearance until their first explicit edit. */
export function fixedMagnifier(mark: Annotation, doc: ImageDocument): Annotation {
  if (mark.tool !== 'magnify' || mark.magnify) return mark;
  const target = localAnnotationBounds(mark);
  const local = {
    x: target.x + target.width / 4,
    y: target.y + target.height / 4,
    width: target.width / 2,
    height: target.height / 2,
  };
  const source = mappedRectangle(
    local,
    multiplied(inverted(doc.transform), mark.transform || identity()),
  );
  return { ...mark, magnify: { source } };
}
export function magnifierBounds(
  mark: Annotation,
  doc: ImageDocument,
  part: MagnifierPart,
): Rectangle {
  return part === 'source' && mark.tool === 'magnify'
    ? mappedRectangle(fixedMagnifier(mark, doc).magnify!.source, doc.transform)
    : annotationBounds(mark);
}
export function magnifierSample(mark: Annotation, doc: ImageDocument): Rectangle {
  return mappedRectangle(
    fixedMagnifier(mark, doc).magnify!.source,
    multiplied(inverted(mark.transform || identity()), doc.transform),
  );
}
export function setMagnifierRegion(
  mark: Annotation,
  doc: ImageDocument,
  part: MagnifierPart,
  rect: Rectangle,
): Annotation {
  if (
    mark.tool !== 'magnify' ||
    ![rect.x, rect.y, rect.width, rect.height].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000,
    ) ||
    rect.width < (part === 'source' ? 0.5 : 1) ||
    rect.height < (part === 'source' ? 0.5 : 1)
  )
    throw Error('放大镜区域无效');
  const fixed = fixedMagnifier(mark, doc);
  if (part === 'source')
    return { ...fixed, magnify: { source: mappedRectangle(rect, inverted(doc.transform)) } };
  const local = mappedRectangle(rect, inverted(mark.transform || identity()));
  return {
    ...fixed,
    start: { x: local.x, y: local.y },
    end: { x: local.x + local.width, y: local.y + local.height },
  };
}
export function moveMagnifier(
  mark: Annotation,
  doc: ImageDocument,
  part: MagnifierPart,
  dx: number,
  dy: number,
): Annotation {
  const fixed = fixedMagnifier(mark, doc);
  if (part === 'target') return moveAnnotation(fixed, dx, dy);
  const rect = magnifierBounds(fixed, doc, 'source');
  return setMagnifierRegion(fixed, doc, 'source', { ...rect, x: rect.x + dx, y: rect.y + dy });
}
export function resizeMagnifier(
  mark: Annotation,
  doc: ImageDocument,
  part: MagnifierPart,
  handle: SelectionHandle,
  point: Point,
): Annotation {
  const fixed = fixedMagnifier(mark, doc);
  if (part === 'target') return resizeAnnotation(fixed, handle, point, doc.width, doc.height);
  return setMagnifierRegion(
    fixed,
    doc,
    'source',
    resizeSelection(magnifierBounds(fixed, doc, 'source'), handle, point, doc.width, doc.height),
  );
}
