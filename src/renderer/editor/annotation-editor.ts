import {
  type Annotation,
  type ImageDocument,
  type CaptureTool,
  type Point,
  ImageHistory,
  moveAnnotation,
  hitAnnotation,
  validateImageDocument,
  resizeAnnotation,
  mappedPoint,
  inverted,
  identity,
  type SelectionHandle,
} from '../../shared/capture/image-document';
import {
  fixedMagnifier,
  magnifierBounds,
  moveMagnifier,
  setMagnifierRegion,
  resizeMagnifier,
  type MagnifierPart,
} from '../../shared/capture/magnifier';
import type { Rectangle } from '../../shared/capture/region';

interface AnnotationHost {
  history: ImageHistory;
  style(): Pick<Annotation, 'color' | 'width' | 'strength'> &
    Pick<
      Partial<Annotation>,
      | 'filled'
      | 'fontSize'
      | 'brush'
      | 'fontFamily'
      | 'fontWeight'
      | 'italic'
      | 'textOutline'
      | 'watermark'
      | 'strokeStyle'
      | 'text'
    >;
  tolerance(): number;
  measure?(mark: Annotation): Annotation;
  changed(scene: ImageDocument, committed: boolean): void;
  selected(mark?: Annotation): void;
  text(mark: Annotation): void;
  error(error: unknown): void;
}
/** One shared annotation interaction layer. A gesture records one vector snapshot, no image copies. */
export class AnnotationEditor {
  selectedId = '';
  magnifierPart: MagnifierPart = 'target';
  private gesture?: {
    before: ImageDocument;
    start: Point;
    mark: Annotation;
    move: boolean;
    handle?: SelectionHandle;
  };
  constructor(private readonly host: AnnotationHost) {}
  get active() {
    return !!this.gesture;
  }
  private steps() {
    return this.host.history.stepSequence;
  }
  get stepOrder() {
    if (!this.selectedId) return;
    const steps = this.steps(),
      index = steps.findIndex((a) => a.id === this.selectedId);
    return index < 0 ? undefined : { position: index + 1, count: steps.length };
  }
  /** Change explanation order without changing paint order, geometry or object identity. */
  orderStep(position: number) {
    if (this.active) return;
    const steps = this.steps(),
      index = steps.findIndex((a) => a.id === this.selectedId);
    if (index < 0 || !Number.isSafeInteger(position) || position < 1 || position > steps.length)
      return;
    const [mark] = steps.splice(index, 1);
    steps.splice(position - 1, 0, mark);
    const numbers = new Map(steps.map((a, i) => [a.id, i + 1]));
    const doc = this.host.history.value;
    doc.annotations = doc.annotations.map((a) =>
      numbers.has(a.id) ? { ...a, number: numbers.get(a.id)! } : a,
    );
    this.commit(doc);
    this.select(this.host.history.value.annotations.find((a) => a.id === mark.id));
  }
  markAt(point: Point) {
    return this.host.history.value.annotations
      .slice()
      .reverse()
      .find((a) => hitAnnotation(a, point, this.host.tolerance()));
  }
  /** Drawing tools can edit their objects without a trip through the move tool.
   * Brush tools keep painting over existing strokes; their frame still moves them. */
  draggable(tool: CaptureTool, at: Point) {
    const mark = this.markAt(at);
    if (!mark || tool === 'select' || tool === 'erase') return;
    if (tool === 'move') return mark;
    const stroke =
      ['brush', 'highlight', 'erasebrush'].includes(tool) ||
      (['mosaic', 'blur'].includes(tool) && this.host.style().brush);
    if (!stroke && mark.tool === tool) return mark;
  }
  retainsSelection(tool: CaptureTool) {
    const mark = this.host.history.value.annotations.find((a) => a.id === this.selectedId);
    return (
      tool === 'move' ||
      !!(
        mark &&
        mark.tool === tool &&
        !['brush', 'highlight', 'erasebrush'].includes(tool) &&
        !(['mosaic', 'blur'].includes(tool) && mark.brush)
      )
    );
  }
  cursor(tool: CaptureTool, at?: Point) {
    if (this.gesture?.move)
      return this.gesture.handle ? this.gesture.handle + '-resize' : 'grabbing';
    if (at && this.draggable(tool, at)) return 'move';
    return tool === 'watermark'
      ? 'move'
      : tool === 'move'
        ? 'default'
        : tool === 'erase'
          ? 'cell'
          : 'crosshair';
  }
  moveSelected(at: Point) {
    if (this.active) return false;
    const before = this.host.history.value,
      mark = before.annotations.find((a) => a.id === this.selectedId);
    if (!mark || (mark.tool === 'watermark' && mark.watermark?.position !== 'custom')) return false;
    this.gesture = { before, start: at, mark: fixedMagnifier(mark, before), move: true };
    return true;
  }
  clear() {
    this.selectedId = '';
    this.magnifierPart = 'target';
    this.host.selected();
  }
  watermark() {
    const doc = this.host.history.value,
      area = doc.selection;
    if (!area) return;
    const existing = doc.annotations.find((mark) => mark.tool === 'watermark');
    if (existing) return this.select(existing);
    const at = {
      x: area.x + Math.min(16, area.width / 2),
      y: area.y + Math.min(16, area.height / 2),
    };
    const style = this.host.style();
    const mark: Annotation = {
      id: crypto.randomUUID(),
      tool: 'watermark',
      start: at,
      end: at,
      points: [],
      ...style,
      text: style.text || '',
      number: 1,
    };
    this.commit({ ...doc, annotations: [...doc.annotations, mark] });
    this.select(this.host.history.value.annotations.find((item) => item.id === mark.id));
  }
  placeWatermark(at: Point) {
    const doc = this.host.history.value,
      mark = doc.annotations.find((item) => item.tool === 'watermark');
    if (!mark) return;
    const local = mappedPoint(inverted(mark.transform || identity()), at);
    const updated = {
      ...mark,
      start: local,
      end: local,
      watermark: {
        ...this.host.style().watermark!,
        ...mark.watermark,
        position: 'custom' as const,
      },
    };
    this.commit({
      ...doc,
      annotations: doc.annotations.map((item) => (item.id === mark.id ? updated : item)),
    });
    this.select(this.host.history.value.annotations.find((item) => item.id === mark.id));
  }
  commit(scene: ImageDocument) {
    try {
      if (this.host.measure)
        scene = { ...scene, annotations: scene.annotations.map((a) => this.host.measure!(a)) };
      this.host.history.commit(scene);
      this.host.changed(this.host.history.value, true);
    } catch (error) {
      this.host.changed(this.host.history.value, false);
      this.host.error(error);
    }
  }
  down(tool: CaptureTool, at: Point) {
    if (this.gesture || tool === 'select') return false;
    const before = this.host.history.value,
      r = before.selection;
    if (!r || at.x < r.x || at.y < r.y || at.x > r.x + r.width || at.y > r.y + r.height)
      return false;
    const found = this.markAt(at);
    const selected = before.annotations.find(
      (a) => a.id === this.selectedId && a.tool === 'magnify',
    );
    if (selected && this.magnifierPart === 'source' && tool === 'move') {
      const source = magnifierBounds(selected, before, 'source');
      if (
        at.x >= source.x &&
        at.y >= source.y &&
        at.x <= source.x + source.width &&
        at.y <= source.y + source.height
      ) {
        this.gesture = { before, start: at, mark: fixedMagnifier(selected, before), move: true };
        return true;
      }
    }
    if (tool === 'erase') {
      if (found) this.remove(found.id);
      return true;
    }
    const draggable = this.draggable(tool, at);
    if (tool === 'move' || draggable) {
      this.magnifierPart = 'target';
      this.select(draggable);
      if (draggable) this.moveSelected(at);
      return true;
    }
    if (tool === 'watermark') {
      const mark = before.annotations.find((a) => a.tool === 'watermark');
      if (mark) {
        const local = mappedPoint(inverted(mark.transform || identity()), at);
        const placed = {
          ...mark,
          start: local,
          end: local,
          watermark: {
            ...this.host.style().watermark!,
            ...mark.watermark,
            position: 'custom' as const,
          },
        };
        this.select(mark);
        this.gesture = { before, start: at, mark: placed, move: true };
        this.move(at);
        return true;
      }
    }
    const style = this.host.style();
    const stroke =
      ['brush', 'highlight', 'erasebrush'].includes(tool) ||
      (['mosaic', 'blur'].includes(tool) && style.brush);
    const mark: Annotation = {
      id: crypto.randomUUID(),
      tool,
      start: at,
      end: at,
      points: stroke ? [at] : [],
      ...style,
      text: tool === 'watermark' ? style.text || '' : '',
      number: tool === 'step' ? this.steps().length + 1 : 1,
    };
    if (tool === 'watermark' && mark.watermark?.image) {
      this.commit({ ...before, annotations: [...before.annotations, mark] });
      this.select(this.host.history.value.annotations.find((a) => a.id === mark.id));
    } else if (tool === 'text' || tool === 'watermark') this.host.text(mark);
    else if (tool === 'step') {
      const numbers = new Map(this.steps().map((a, i) => [a.id, i + 1]));
      this.commit({
        ...before,
        annotations: [
          ...before.annotations.map((a) =>
            numbers.has(a.id) ? { ...a, number: numbers.get(a.id)! } : a,
          ),
          mark,
        ],
      });
      this.select(mark);
    } else this.gesture = { before, start: at, mark, move: false };
    return true;
  }
  resize(handle: SelectionHandle, at: Point) {
    if (this.active) return false;
    const before = this.host.history.value,
      mark = before.annotations.find((item) => item.id === this.selectedId);
    if (!mark) return false;
    this.gesture = { before, start: at, mark: fixedMagnifier(mark, before), move: true, handle };
    return true;
  }
  move(at: Point, shift = false) {
    const g = this.gesture;
    if (!g) return;
    const next = { ...g.before, annotations: [...g.before.annotations] };
    if (g.handle)
      next.annotations = next.annotations.map((mark) =>
        mark.id !== g.mark.id
          ? mark
          : mark.tool === 'magnify'
            ? resizeMagnifier(g.mark, g.before, this.magnifierPart, g.handle!, at)
            : resizeAnnotation(g.mark, g.handle!, at, next.width, next.height),
      );
    else if (g.move)
      next.annotations = next.annotations.map((a) =>
        a.id === g.mark.id
          ? a.tool === 'magnify'
            ? moveMagnifier(
                g.mark,
                g.before,
                this.magnifierPart,
                at.x - g.start.x,
                at.y - g.start.y,
              )
            : moveAnnotation(g.mark, at.x - g.start.x, at.y - g.start.y)
          : a,
      );
    else {
      if (shift && ['line', 'arrow'].includes(g.mark.tool)) {
        const angle =
          (Math.round(Math.atan2(at.y - g.start.y, at.x - g.start.x) / (Math.PI / 4)) * Math.PI) /
          4;
        const length = Math.hypot(at.x - g.start.x, at.y - g.start.y);
        at = {
          x: Math.round(g.start.x + Math.cos(angle) * length),
          y: Math.round(g.start.y + Math.sin(angle) * length),
        };
      }
      g.mark.end = at;
      if (
        g.mark.points.length &&
        g.mark.points.length < 2048 &&
        Math.hypot(at.x - g.mark.points.at(-1)!.x, at.y - g.mark.points.at(-1)!.y) >= 1
      )
        g.mark.points.push(at);
      next.annotations.push(structuredClone(fixedMagnifier(g.mark, g.before)));
    }
    this.host.changed(next, false);
  }
  up(scene: ImageDocument) {
    const g = this.gesture;
    this.gesture = undefined;
    if (!g) return;
    if (
      !g.move &&
      Math.hypot(g.mark.end.x - g.mark.start.x, g.mark.end.y - g.mark.start.y) < 2 &&
      !g.mark.points.length
    )
      this.host.changed(g.before, false);
    else {
      if (!g.move && g.mark.points.length && !scene.annotations.some((a) => a.id === g.mark.id))
        scene = { ...g.before, annotations: [...g.before.annotations, structuredClone(g.mark)] };
      this.commit(scene);
      this.select(this.host.history.value.annotations.find((a) => a.id === g.mark.id));
    }
  }
  cancel() {
    if (!this.gesture) return;
    this.gesture = undefined;
    this.host.changed(this.host.history.value, false);
  }
  remove(id = this.selectedId) {
    if (this.active) return;
    const doc = this.host.history.value;
    const removed = doc.annotations.find((a) => a.id === id);
    if (!removed) return;
    doc.annotations = doc.annotations.filter((a) => a.id !== id);
    if (removed.tool === 'step') {
      const numbers = new Map(
        this.steps()
          .filter((a) => a.id !== id)
          .map((a, i) => [a.id, i + 1]),
      );
      doc.annotations = doc.annotations.map((a) =>
        numbers.has(a.id) ? { ...a, number: numbers.get(a.id)! } : a,
      );
    }
    this.clear();
    this.commit(doc);
  }
  magnifierRegion(rect: Rectangle) {
    if (this.active) return;
    const doc = this.host.history.value;
    const mark = doc.annotations.find((a) => a.id === this.selectedId && a.tool === 'magnify');
    if (!mark) return;
    try {
      const next = setMagnifierRegion(mark, doc, this.magnifierPart, rect);
      doc.annotations = doc.annotations.map((a) => (a.id === mark.id ? next : a));
      this.commit(doc);
      this.select(this.host.history.value.annotations.find((a) => a.id === mark.id));
    } catch (error) {
      this.host.error(error);
    }
  }
  nudge(dx: number, dy: number) {
    if (this.active) return;
    try {
      const doc = this.host.history.value;
      doc.annotations = doc.annotations.map((a) =>
        a.id === this.selectedId
          ? a.tool === 'magnify'
            ? moveMagnifier(a, doc, this.magnifierPart, dx, dy)
            : moveAnnotation(a, dx, dy)
          : a,
      );
      this.commit(doc);
      this.select(this.host.history.value.annotations.find((a) => a.id === this.selectedId));
    } catch (error) {
      this.host.error(error);
    }
  }
  update(
    style: Partial<
      Pick<
        Annotation,
        | 'color'
        | 'width'
        | 'strokeStyle'
        | 'strength'
        | 'fontSize'
        | 'filled'
        | 'fontFamily'
        | 'fontWeight'
        | 'italic'
        | 'textOutline'
        | 'watermark'
        | 'text'
      >
    >,
    preview = false,
  ) {
    if (!this.selectedId) return;
    const doc = this.host.history.value;
    doc.annotations = doc.annotations.map((a) =>
      a.id === this.selectedId
        ? this.host.measure?.({ ...a, ...style }) || {
            ...a,
            ...style,
            ...(['fontSize', 'fontFamily', 'fontWeight', 'italic', 'textOutline', 'text'].some(
              (key) => key in style,
            )
              ? { textBounds: undefined }
              : {}),
          }
        : a,
    );
    if (preview) {
      try {
        validateImageDocument(doc, doc.original);
        this.host.changed(doc, false);
      } catch (error) {
        this.host.error(error);
      }
      return;
    }
    this.commit(doc);
    this.select(this.host.history.value.annotations.find((a) => a.id === this.selectedId));
  }
  text(mark: Annotation, text: string) {
    const doc = this.host.history.value,
      index = doc.annotations.findIndex((a) => a.id === mark.id);
    const next = { ...mark, text };
    if (index < 0) doc.annotations.push(next);
    else doc.annotations[index] = next;
    this.commit(doc);
    this.select(this.host.history.value.annotations.find((a) => a.id === next.id));
  }
  select(mark?: Annotation) {
    if (this.selectedId !== mark?.id || mark?.tool !== 'magnify') this.magnifierPart = 'target';
    this.selectedId = mark?.id || '';
    this.host.selected(mark);
  }
}
