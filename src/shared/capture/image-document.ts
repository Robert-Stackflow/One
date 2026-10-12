import type { Rectangle } from './region';
import {
  selectionMask,
  maskBounds,
  cropSelectionMask,
  type SelectionMask,
} from './capture-selection';
import { watermarkStyle, WATERMARK_DOCUMENT_BYTES, type WatermarkStyle } from './watermark';
import { strokeStyles, strokeRadius, type StrokeStyle } from './stroke-style';

import { imageDimensions } from './image-limits';
import { defaultEffects, outputEffects, outputLayout, type OutputEffects } from './image-output';

/** All geometry is in source pixels. CSS/DIP coordinates never enter the document. */
export interface Point {
  x: number;
  y: number;
}
export const annotationTools = [
  'rectangle',
  'roundrect',
  'ellipse',
  'triangle',
  'diamond',
  'solid',
  'line',
  'arrow',
  'brush',
  'highlight',
  'text',
  'mosaic',
  'blur',
  'erasebrush',
  'step',
  'magnify',
  'spotlight',
  'watermark',
] as const;
export type AnnotationTool = (typeof annotationTools)[number];
export type CaptureTool = 'select' | 'move' | 'erase' | AnnotationTool;

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  start: Point;
  end: Point;
  points: Point[];
  color: string;
  width: number;
  strokeStyle?: StrokeStyle;
  text: string;
  strength: number;
  number: number;
  filled?: boolean;
  fontSize?: number;
  brush?: boolean;
  textBounds?: { width: number; height: number; ink?: Rectangle };
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  textOutline?: boolean;
  watermark?: WatermarkStyle;
  /** Sampling rectangle in original image coordinates; target geometry stays editable independently. */
  magnify?: { source: Rectangle };
  transform?: Affine;
}
export type Affine = [number, number, number, number, number, number];
export const identity = (): Affine => [1, 0, 0, 1, 0, 0];
export function mappedPoint(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function multiplied(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ].map((n) => n || 0) as Affine;
}
export function inverted(m: Affine): Affine {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) !== 1) throw Error('图片变换无效');
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
function validTransform(value: Affine) {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    !value.every(Number.isSafeInteger) ||
    value.some((n) => Math.abs(n) > 1_000_000) ||
    value.slice(0, 4).some((n) => ![-1, 0, 1].includes(n)) ||
    value[0] ** 2 + value[1] ** 2 !== 1 ||
    value[2] ** 2 + value[3] ** 2 !== 1 ||
    value[0] * value[2] + value[1] * value[3] !== 0
  )
    throw Error('图片变换无效');
}
export interface ImageDocument {
  width: number;
  height: number;
  selection: Rectangle | null;
  selectionMask?: SelectionMask;
  annotations: Annotation[];
  original: { width: number; height: number };
  transform: Affine;
  effects: OutputEffects;
}
export const limit = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function selectionFrom(
  a: Point,
  b: Point,
  width: number,
  height: number,
  ratio = 0,
): Rectangle {
  const start = { x: limit(Math.round(a.x), 0, width), y: limit(Math.round(a.y), 0, height) };
  let dx = limit(Math.round(b.x), 0, width) - start.x,
    dy = limit(Math.round(b.y), 0, height) - start.y;
  if (ratio > 0) {
    const availableX = dx < 0 ? start.x : width - start.x;
    const availableY = dy < 0 ? start.y : height - start.y;
    const span = Math.min(
      Math.max(Math.abs(dx), Math.abs(dy) * ratio),
      availableX,
      availableY * ratio,
    );
    dx = (dx < 0 ? -1 : 1) * span;
    dy = ((dy < 0 ? -1 : 1) * span) / ratio;
  }
  return {
    x: Math.round(Math.min(start.x, start.x + dx)),
    y: Math.round(Math.min(start.y, start.y + dy)),
    width: Math.round(Math.abs(dx)),
    height: Math.round(Math.abs(dy)),
  };
}
export function validSelection(value: unknown, width: number, height: number): Rectangle {
  const r = value as Rectangle;
  if (
    !r ||
    ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 2 ||
    r.height < 2 ||
    r.x + r.width > width ||
    r.y + r.height > height
  )
    throw Error('选区无效，请重新选择');
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
export function wholeImage(doc: Pick<ImageDocument, 'width' | 'height'>): Rectangle {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}
export function transformImage(
  doc: ImageDocument,
  kind: 'rotate' | 'flipX' | 'flipY' | 'crop',
  crop?: Rectangle,
): ImageDocument {
  const next = structuredClone(doc);
  let matrix: Affine;
  if (kind === 'rotate') {
    matrix = [0, 1, -1, 0, doc.height, 0];
    next.width = doc.height;
    next.height = doc.width;
  } else if (kind === 'flipX') matrix = [-1, 0, 0, 1, doc.width, 0];
  else if (kind === 'flipY') matrix = [1, 0, 0, -1, 0, doc.height];
  else {
    const r = validSelection(crop, doc.width, doc.height);
    matrix = [1, 0, 0, 1, -r.x, -r.y];
    next.width = r.width;
    next.height = r.height;
  }
  next.transform = multiplied(matrix, doc.transform);
  next.annotations = doc.annotations.map((a) => ({
    ...a,
    transform: multiplied(matrix, a.transform || identity()),
  }));
  next.selection = wholeImage(next);
  if (doc.selectionMask) {
    const mask = kind === 'crop' ? cropSelectionMask(doc.selectionMask, crop!) : doc.selectionMask;
    next.selectionMask = selectionMask(
      { ...mask, points: mask.points.map((p) => mappedPoint(matrix, p)) },
      next.width,
      next.height,
    );
    next.selection = maskBounds(next.selectionMask.points);
  }
  return next;
}
export function shiftSelection(
  r: Rectangle,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Rectangle {
  return {
    ...r,
    x: limit(Math.round(r.x + dx), 0, width - r.width),
    y: limit(Math.round(r.y + dy), 0, height - r.height),
  };
}
export type SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export function resizeSelection(
  r: Rectangle,
  handle: SelectionHandle,
  point: Point,
  width: number,
  height: number,
  ratio = 0,
): Rectangle {
  if (ratio > 0) return resizeLockedSelection(r, handle, point, width, height, ratio);
  const left = handle.includes('w') ? limit(Math.round(point.x), 0, r.x + r.width - 2) : r.x;
  const top = handle.includes('n') ? limit(Math.round(point.y), 0, r.y + r.height - 2) : r.y;
  const right = handle.includes('e') ? limit(Math.round(point.x), left + 2, width) : r.x + r.width;
  const bottom = handle.includes('s')
    ? limit(Math.round(point.y), top + 2, height)
    : r.y + r.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function resizeLockedSelection(
  r: Rectangle,
  handle: SelectionHandle,
  point: Point,
  width: number,
  height: number,
  ratio: number,
): Rectangle {
  const west = handle.includes('w'),
    east = handle.includes('e'),
    north = handle.includes('n'),
    south = handle.includes('s');
  const horizontal = west || east,
    vertical = north || south;
  const anchorX = west ? r.x + r.width : east ? r.x : r.x + r.width / 2;
  const anchorY = north ? r.y + r.height : south ? r.y : r.y + r.height / 2;
  const availableX = horizontal
    ? west
      ? anchorX
      : width - anchorX
    : 2 * Math.min(anchorX, width - anchorX);
  const availableY = vertical
    ? north
      ? anchorY
      : height - anchorY
    : 2 * Math.min(anchorY, height - anchorY);
  const desiredX = Math.max(2, west ? anchorX - point.x : point.x - anchorX);
  const desiredY = Math.max(2, north ? anchorY - point.y : point.y - anchorY);
  const wanted =
    horizontal && vertical
      ? Math.abs(desiredX - r.width) >= Math.abs(desiredY - r.height) * ratio
        ? desiredX
        : desiredY * ratio
      : horizontal
        ? desiredX
        : desiredY * ratio;
  const maximum = Math.min(availableX, availableY * ratio);
  if (maximum < Math.max(2, 2 * ratio)) return { ...r };
  const nextWidth = Math.round(limit(wanted, Math.max(2, 2 * ratio), maximum));
  const nextHeight = Math.max(2, Math.round(nextWidth / ratio));
  return {
    x: limit(
      Math.round(horizontal ? (west ? anchorX - nextWidth : anchorX) : anchorX - nextWidth / 2),
      0,
      width - nextWidth,
    ),
    y: limit(
      Math.round(vertical ? (north ? anchorY - nextHeight : anchorY) : anchorY - nextHeight / 2),
      0,
      height - nextHeight,
    ),
    width: nextWidth,
    height: nextHeight,
  };
}
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.transform) return { ...a, transform: multiplied([1, 0, 0, 1, dx, dy], a.transform) };
  const point = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { ...a, start: point(a.start), end: point(a.end), points: a.points.map(point) };
}
export function annotationBounds(a: Annotation): Rectangle {
  const r = localAnnotationBounds(a);
  if (!a.transform) return r;
  const points = [
    r,
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map((p) => mappedPoint(a.transform!, p));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function localAnnotationBounds(a: Annotation): Rectangle {
  const points = a.points.length ? a.points : [a.start, a.end];
  let x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  let width = Math.max(...points.map((p) => p.x)) - x,
    height = Math.max(...points.map((p) => p.y)) - y;
  if (a.tool === 'watermark' && a.watermark?.image) {
    const image = a.watermark.image,
      radians = (a.watermark.angle * Math.PI) / 180;
    const w = image.width * image.scale,
      h = image.height * image.scale;
    width = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians));
    height = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
    x = a.start.x + (w - width) / 2;
    y = a.start.y + (h - height) / 2;
  } else if (a.tool === 'text' || a.tool === 'watermark') {
    const size = a.fontSize || Math.max(12, a.width * 6),
      lines = a.text.split('\n');
    width = a.textBounds?.width || Math.max(width, ...lines.map((line) => line.length * size));
    height = a.textBounds?.height || Math.max(height, lines.length * size * 1.2);
    const center = { x: a.start.x + width / 2, y: a.start.y + height / 2 };
    if (a.textBounds?.ink) {
      x = a.start.x + a.textBounds.ink.x;
      y = a.start.y + a.textBounds.ink.y;
      width = a.textBounds.ink.width;
      height = a.textBounds.ink.height;
    }
    if (a.tool === 'watermark' && a.watermark?.angle) {
      const radians = (a.watermark.angle * Math.PI) / 180,
        cos = Math.cos(radians),
        sin = Math.sin(radians);
      const points = [
        { x, y },
        { x: x + width, y },
        { x, y: y + height },
        { x: x + width, y: y + height },
      ].map((p) => ({
        x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
        y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
      }));
      x = Math.min(...points.map((p) => p.x));
      y = Math.min(...points.map((p) => p.y));
      width = Math.max(...points.map((p) => p.x)) - x;
      height = Math.max(...points.map((p) => p.y)) - y;
    }
  }
  if (a.tool === 'step') {
    const radius = Math.max(10, a.width * 5);
    x -= radius;
    y -= radius;
    width = height = radius * 2;
  }
  if (
    a.tool === 'brush' ||
    a.tool === 'highlight' ||
    a.tool === 'erasebrush' ||
    ((a.tool === 'mosaic' || a.tool === 'blur') && a.brush) ||
    (['line', 'arrow'].includes(a.tool) && ['double', 'wavy'].includes(a.strokeStyle || ''))
  ) {
    const paintedWidth = a.width * (a.tool === 'highlight' ? 5 : 1);
    const radius = ['brush', 'line', 'arrow', 'highlight'].includes(a.tool)
      ? strokeRadius(a.strokeStyle, paintedWidth)
      : paintedWidth / 2;
    x -= radius;
    y -= radius;
    width += radius * 2;
    height += radius * 2;
  }
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}
export function resizeAnnotation(
  a: Annotation,
  handle: SelectionHandle,
  point: Point,
  width: number,
  height: number,
): Annotation {
  const before = annotationBounds(a),
    text = ['text', 'watermark'].includes(a.tool);
  const after = resizeSelection(
    before,
    handle,
    point,
    width,
    height,
    text ? before.width / before.height : 0,
  );
  const sx = after.width / before.width,
    sy = after.height / before.height;
  const matrix = a.transform || identity(),
    inverse = inverted(matrix);
  const move = (p: Point) => {
    const world = mappedPoint(matrix, p);
    return mappedPoint(inverse, {
      x: after.x + (world.x - before.x) * sx,
      y: after.y + (world.y - before.y) * sy,
    });
  };
  return {
    ...a,
    start: move(a.start),
    end: move(a.end),
    points: a.points.map(move),
    ...(a.watermark?.image
      ? {
          watermark: {
            ...a.watermark,
            image: { ...a.watermark.image, scale: limit(a.watermark.image.scale * sx, 0.1, 8) },
          },
        }
      : text
        ? {
            fontSize: limit((a.fontSize || Math.max(12, a.width * 6)) * sx, 8, 240),
            textBounds: a.textBounds
              ? {
                  width: a.textBounds.width * sx,
                  height: a.textBounds.height * sx,
                  ...(a.textBounds.ink
                    ? {
                        ink: {
                          x: a.textBounds.ink.x * sx,
                          y: a.textBounds.ink.y * sx,
                          width: a.textBounds.ink.width * sx,
                          height: a.textBounds.ink.height * sx,
                        },
                      }
                    : {}),
                }
              : undefined,
          }
        : {}),
  };
}
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = limit(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
export function hitAnnotation(a: Annotation, p: Point, tolerance = 5) {
  if (a.tool === 'watermark' && a.watermark && a.watermark.position !== 'custom') return false;
  if (a.transform) p = mappedPoint(inverted(a.transform), p);
  if (
    ['line', 'arrow', 'brush', 'highlight', 'erasebrush'].includes(a.tool) ||
    ((a.tool === 'mosaic' || a.tool === 'blur') && a.brush)
  ) {
    const points = a.points.length ? a.points : [a.start, a.end];
    const width = a.width * (a.tool === 'highlight' ? 5 : 1);
    const radius = ['brush', 'line', 'arrow', 'highlight'].includes(a.tool)
      ? strokeRadius(a.strokeStyle, width)
      : width / 2;
    if (points.length === 1)
      return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= tolerance + radius;
    return points.slice(1).some((end, i) => distance(p, points[i], end) <= tolerance + radius);
  }
  const r = localAnnotationBounds(a);
  return (
    p.x >= r.x - tolerance &&
    p.y >= r.y - tolerance &&
    p.x <= r.x + r.width + tolerance &&
    p.y <= r.y + r.height + tolerance
  );
}
/** Gesture previews stay outside history; one completed gesture is one undo entry. */
export interface ImageHistoryState {
  past: ImageDocument[];
  future: ImageDocument[];
}
export function imageHistoryState(
  value: unknown,
  original: { width: number; height: number },
): ImageHistoryState {
  const v = value as ImageHistoryState;
  if (
    !v ||
    !Array.isArray(v.past) ||
    !Array.isArray(v.future) ||
    v.past.length + v.future.length > 10000
  )
    throw Error('图片操作历史无效');
  return {
    past: v.past.map((document) => validateImageDocument(document, original)),
    future: v.future.map((document) => validateImageDocument(document, original)),
  };
}
export class ImageHistory {
  private past: ImageDocument[] = [];
  private future: ImageDocument[] = [];
  private current: ImageDocument;
  constructor(width: number, height: number, selected = false, effects = defaultEffects()) {
    imageDimensions(width, height);
    this.current = {
      width,
      height,
      selection: selected ? { x: 0, y: 0, width, height } : null,
      annotations: [],
      original: { width, height },
      transform: identity(),
      effects: outputEffects(effects),
    };
  }
  get value(): ImageDocument {
    return structuredClone(this.current);
  }
  /** Lightweight sequence metadata for live property panels; never expose stored vectors. */
  get stepSequence() {
    return this.current.annotations
      .filter((a) => a.tool === 'step')
      .map(({ id, number }) => ({ id, number }))
      .sort((a, b) => a.number - b.number);
  }
  get snapshot(): ImageHistoryState {
    return structuredClone({ past: this.past, future: this.future });
  }
  /** A new document without a saved history starts at its current editable state. */
  restore(document: ImageDocument, saved?: ImageHistoryState) {
    const history = saved
      ? imageHistoryState(saved, this.current.original)
      : { past: [], future: [] };
    this.current = validateImageDocument(document, this.current.original);
    this.past = structuredClone(history.past);
    this.future = structuredClone(history.future);
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
  commit(document: ImageDocument) {
    validateImageDocument(document, this.current.original);
    if (
      document.annotations.length > 300 ||
      document.annotations.reduce((n, a) => n + a.points.length, 0) > 50000
    )
      throw Error('标注过多，请先输出当前截图');
    if (JSON.stringify(document) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    this.current = structuredClone(document);
    this.future = [];
  }
  undo() {
    if (this.past.length) {
      this.future.push(this.current);
      this.current = this.past.pop()!;
    }
  }
  redo() {
    if (this.future.length) {
      this.past.push(this.current);
      this.current = this.future.pop()!;
    }
  }
}
export function validateImageDocument(
  value: unknown,
  original: { width: number; height: number },
): ImageDocument {
  const doc = value as ImageDocument;
  if (
    !doc ||
    !doc.original ||
    doc.original.width !== original.width ||
    doc.original.height !== original.height
  )
    throw Error('图片原图已改变');
  imageDimensions(doc.width, doc.height);
  outputEffects(doc.effects);
  validTransform(doc.transform);
  const corners = [
    { x: 0, y: 0 },
    { x: original.width, y: 0 },
    { x: 0, y: original.height },
    { x: original.width, y: original.height },
  ].map((p) => mappedPoint(doc.transform, p));
  if (
    Math.min(...corners.map((p) => p.x)) > 0 ||
    Math.min(...corners.map((p) => p.y)) > 0 ||
    Math.max(...corners.map((p) => p.x)) < doc.width ||
    Math.max(...corners.map((p) => p.y)) < doc.height
  )
    throw Error('图片变换超出原图');
  if (
    doc.selection &&
    !(
      doc.selection.x === 0 &&
      doc.selection.y === 0 &&
      doc.selection.width === doc.width &&
      doc.selection.height === doc.height
    )
  )
    validSelection(doc.selection, doc.width, doc.height);
  if (doc.selection) outputLayout(doc.selection.width, doc.selection.height, doc.effects);
  if (doc.selectionMask) {
    const mask = selectionMask(doc.selectionMask, doc.width, doc.height),
      bounds = maskBounds(mask.points);
    if (
      !doc.selection ||
      ['x', 'y', 'width', 'height'].some(
        (key) => bounds[key as keyof Rectangle] !== doc.selection![key as keyof Rectangle],
      )
    )
      throw Error('选区轮廓与范围不符');
  }
  if (!Array.isArray(doc.annotations) || doc.annotations.length > 300) throw Error('标注过多');
  const ids = new Set<string>();
  let count = 0,
    watermarkBytes = 0;
  for (const a of doc.annotations) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !a.id ||
      a.id.length > 64 ||
      ids.has(a.id) ||
      !annotationTools.includes(a.tool) ||
      typeof a.color !== 'string' ||
      !/^#[\da-f]{6}$/i.test(a.color) ||
      !Array.isArray(a.points) ||
      (count += a.points.length) > 50000 ||
      ![a.start, a.end, ...a.points].every(
        (p) => p && [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000),
      ) ||
      !Number.isFinite(a.width) ||
      a.width < 1 ||
      a.width > 80 ||
      !Number.isFinite(a.strength) ||
      a.strength < 1 ||
      a.strength > 64 ||
      typeof a.text !== 'string' ||
      a.text.length > 2000 ||
      !Number.isSafeInteger(a.number) ||
      a.number < 1 ||
      a.number > 10000 ||
      (a.filled !== undefined && typeof a.filled !== 'boolean') ||
      (a.brush !== undefined && typeof a.brush !== 'boolean') ||
      (a.strokeStyle !== undefined &&
        !strokeStyles.some((style) => style.value === a.strokeStyle)) ||
      (a.fontFamily !== undefined &&
        (typeof a.fontFamily !== 'string' ||
          !a.fontFamily.trim() ||
          a.fontFamily.length > 256 ||
          /[\x00-\x1f\x7f]/.test(a.fontFamily))) ||
      (a.fontWeight !== undefined && ![400, 600, 700].includes(a.fontWeight)) ||
      (a.italic !== undefined && typeof a.italic !== 'boolean') ||
      (a.textOutline !== undefined && typeof a.textOutline !== 'boolean') ||
      (a.textBounds !== undefined &&
        (!a.textBounds ||
          ![a.textBounds.width, a.textBounds.height].every(
            (n) => Number.isFinite(n) && n > 0 && n <= 1000000,
          ) ||
          (a.textBounds.ink !== undefined &&
            (!a.textBounds.ink ||
              ![
                a.textBounds.ink.x,
                a.textBounds.ink.y,
                a.textBounds.ink.width,
                a.textBounds.ink.height,
              ].every((n) => Number.isFinite(n) && Math.abs(n) <= 1000000) ||
              a.textBounds.ink.width <= 0 ||
              a.textBounds.ink.height <= 0)))) ||
      (a.fontSize !== undefined &&
        (!Number.isFinite(a.fontSize) || a.fontSize < 8 || a.fontSize > 240))
    )
      throw Error('标注无效');
    if (a.transform) validTransform(a.transform);
    if (a.magnify !== undefined) {
      const source = a.magnify?.source;
      if (
        a.tool !== 'magnify' ||
        !source ||
        ![source.x, source.y, source.width, source.height].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000,
        ) ||
        source.width < 0.5 ||
        source.height < 0.5
      )
        throw Error('放大镜取样区无效');
    }
    if (a.watermark) {
      if (a.tool !== 'watermark') throw Error('水印标注无效');
      watermarkStyle(a.watermark);
      if (
        a.watermark.image &&
        (watermarkBytes += a.watermark.image.width * a.watermark.image.height * 4) >
          WATERMARK_DOCUMENT_BYTES
      )
        throw Error('图片水印总量过大，请减少标注');
    }
    ids.add(a.id);
  }
  return structuredClone(doc);
}
