import {
  selectionMask,
  maskBounds,
  SELECTION_POINTS,
  type CaptureSelectionMode,
} from '../../shared/capture/capture-selection';
import type { ImageDocument, Point } from '../../shared/capture/image-document';
/** A draft is separate from document history. One closed contour is one undo step. */
export class CaptureSelection {
  mode: CaptureSelectionMode = 'rectangle';
  private draft?: { before: ImageDocument; points: Point[]; pointer?: number; overflow?: boolean };
  private hover?: Point;
  constructor(
    private actions: {
      get(): ImageDocument;
      preview(value: ImageDocument): void;
      commit(value: ImageDocument): void;
      changed(): void;
      error(error: unknown): void;
    },
  ) {}
  get active() {
    return !!this.draft;
  }
  get draftBounds() {
    if (!this.draft?.points.length) return null;
    return maskBounds(this.hover ? [...this.draft.points, this.hover] : this.draft.points);
  }
  setMode(mode: CaptureSelectionMode) {
    this.cancel();
    this.mode = mode;
    this.actions.commit({ ...this.actions.get(), selection: null, selectionMask: undefined });
  }
  down(point: Point, event: PointerEvent) {
    if (this.mode === 'rectangle') return false;
    if (!this.draft) {
      this.draft = { before: this.actions.get(), points: [] };
      this.actions.preview({ ...this.draft.before, selection: null, selectionMask: undefined });
    }
    const draft = this.draft;
    if (this.mode === 'free') draft.pointer = event.pointerId;
    this.add(point);
    if (this.mode === 'free') (event.target as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }
  private add(point: Point) {
    const points = this.draft!.points,
      last = points.at(-1);
    if (last && last.x === point.x && last.y === point.y) return;
    if (points.length >= SELECTION_POINTS) {
      if (this.mode === 'free') this.draft!.overflow = true;
      this.actions.error(Error('选区点数过多，请完成选区或重新绘制'));
      return;
    }
    points.push(point);
    this.actions.changed();
  }
  move(point: Point, event: PointerEvent) {
    if (!this.draft) return false;
    this.hover = point;
    if (this.mode === 'free' && this.draft.pointer === event.pointerId) {
      const last = this.draft.points.at(-1)!;
      const doc = this.draft.before,
        distance = Math.max(1, Math.max(doc.width, doc.height) / 2048);
      if (Math.hypot(point.x - last.x, point.y - last.y) >= distance) this.add(point);
    }
    this.actions.changed();
    return true;
  }
  up(point: Point, event: PointerEvent) {
    if (this.mode !== 'free' || this.draft?.pointer !== event.pointerId) return false;
    this.add(point);
    const completed = this.finish();
    if (!completed) this.cancel();
    return completed ? 'completed' : 'cancelled';
  }
  back() {
    if (!this.draft) return;
    this.draft.points.pop();
    if (!this.draft.points.length) this.cancel();
    this.actions.changed();
  }
  finish() {
    if (!this.draft) return false;
    if (this.draft.overflow) {
      this.actions.error(Error('自由选区点数过多，请重新绘制更简洁的轮廓'));
      return false;
    }
    try {
      const doc = this.draft.before,
        mask = selectionMask({ kind: this.mode, points: this.draft.points }, doc.width, doc.height);
      const next = { ...doc, selection: maskBounds(mask.points), selectionMask: mask };
      this.draft = undefined;
      this.hover = undefined;
      this.actions.commit(next);
      return true;
    } catch (error) {
      this.actions.error(error);
      return false;
    }
  }
  cancel() {
    if (!this.draft) return false;
    const before = this.draft.before;
    this.draft = undefined;
    this.hover = undefined;
    this.actions.preview(before);
    return true;
  }
  paint(
    canvas: HTMLCanvasElement,
    doc: ImageDocument,
    view: { x: number; y: number; width: number; height: number },
  ) {
    const points = this.draft ? [...this.draft.points] : doc.selectionMask?.points;
    canvas.hidden = !points?.length;
    if (!points?.length) return;
    if (this.draft && this.hover && this.mode === 'polygon') points.push(this.hover);
    const width = Math.ceil(view.width * devicePixelRatio),
      height = Math.ceil(view.height * devicePixelRatio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    Object.assign(canvas.style, {
      left: view.x + 'px',
      top: view.y + 'px',
      width: view.width + 'px',
      height: view.height + 'px',
    });
    const ctx = canvas.getContext('2d')!;
    ctx.resetTransform();
    ctx.clearRect(0, 0, width, height);
    ctx.scale(width / doc.width, height / doc.height);
    const path = () => {
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    path();
    ctx.fillStyle = '#0007';
    ctx.fill('evenodd');
    ctx.beginPath();
    path();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = (1.5 * doc.width) / view.width;
    if (this.draft) ctx.setLineDash([(5 * doc.width) / view.width, (4 * doc.width) / view.width]);
    else ctx.setLineDash([]);
    ctx.stroke();
  }
}
