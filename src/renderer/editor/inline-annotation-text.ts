import './inline-annotation-text.css';
import { maxTextOutlineWidth } from '../../shared/capture/text-outline';
import {
  identity,
  mappedPoint,
  type Annotation,
  type Point,
  type ImageDocument,
} from '../../shared/capture/image-document';
import { annotationFont, watermarkAnchors, watermarkText } from '../../shared/capture/watermark';

interface TextHost {
  position(point: Point): Point;
  scale(): number;
  area(): NonNullable<ImageDocument['selection']>;
  selected(mark?: Annotation): void;
  existing(id: string): Annotation | undefined;
  commit(mark: Annotation, text: string): void;
  remove(id: string): void;
  changed(mark?: Annotation): void;
  input?(mark: Annotation, text: string): void;
  accepted?(): void;
}

/** The same on-canvas input, sizing, confirmation and cancellation in every editor. */
export class InlineAnnotationText {
  target?: Annotation;
  private measure = document.createElement('canvas').getContext('2d')!;
  private readonly placeholder = '输入文字';
  private caret = document.createElement('span');
  private editingBounds?: Annotation['textBounds'];
  private caretLine = { top: 0, height: 0, advance: 0 };
  measured(mark: Annotation) {
    if (!['text', 'watermark'].includes(mark.tool) || mark.watermark?.image) return mark;
    const size = mark.fontSize || Math.max(12, mark.width * 6);
    this.measure.font = annotationFont(size, mark.fontFamily, mark.fontWeight, mark.italic);
    this.measure.textBaseline = 'top';
    const lines = (
      mark.watermark ? watermarkText(mark.text, mark.watermark.capturedAt) : mark.text
    ).split('\n');
    const metrics = lines
      .map((line, index) => ({ m: this.measure.measureText(line), index }))
      .filter(({ m }) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight > 0);
    const ink = metrics.length
      ? {
          x: Math.min(...metrics.map(({ m }) => -m.actualBoundingBoxLeft)),
          y: Math.min(
            ...metrics.map(({ m, index }) => index * size * 1.2 - m.actualBoundingBoxAscent),
          ),
          width: 0,
          height: 0,
        }
      : undefined;
    if (ink) {
      ink.width = Math.max(...metrics.map(({ m }) => m.actualBoundingBoxRight)) - ink.x;
      ink.height =
        Math.max(
          ...metrics.map(({ m, index }) => index * size * 1.2 + m.actualBoundingBoxDescent),
        ) - ink.y;
      if (mark.textOutline) {
        const edge = maxTextOutlineWidth(size) / 2;
        ink.x -= edge;
        ink.y -= edge;
        ink.width += edge * 2;
        ink.height += edge * 2;
      }
    }
    return {
      ...mark,
      textBounds: {
        width: Math.max(1, ...lines.map((line) => this.measure.measureText(line).width)),
        height: lines.length * size * 1.2,
        ...(ink ? { ink } : {}),
      },
    };
  }
  /** Editing and export use the same canvas painter; the textarea owns native
   * input, selection and IME. A separate caret follows the visible glyph height. */
  scene(scene: ImageDocument): ImageDocument {
    if (!this.target) return scene;
    const target =
      !this.target.text && this.target.tool === 'text'
        ? { ...this.target, text: this.placeholder, color: '#767676', textOutline: false }
        : this.target;
    const found = scene.annotations.some((a) => a.id === this.target!.id);
    return {
      ...scene,
      annotations: found
        ? scene.annotations.map((a) => (a.id === this.target!.id ? target : a))
        : [...scene.annotations, target],
    };
  }
  get selection() {
    if (!this.target) return;
    // Line leading belongs to the invisible input, not the visible editing frame.
    return {
      ...this.target,
      textBounds: this.target.watermark ? this.target.textBounds : this.editingBounds,
    };
  }
  constructor(
    readonly form: HTMLFormElement,
    readonly input: HTMLTextAreaElement,
    private host: TextHost,
  ) {
    form.classList.add('inline-annotation-editor');
    input.wrap = 'off';
    // Canvas paints both the hint and the text; the textarea only owns input, selection and IME.
    input.placeholder = '';
    this.caret.className = 'inline-annotation-caret';
    this.caret.setAttribute('aria-hidden', 'true');
    form.append(this.caret);
    for (const event of ['select', 'selectionchange', 'keyup', 'pointerup', 'focus', 'blur', 'compositionend'])
      input.addEventListener(event, () => this.layoutCaret());
    form.onsubmit = (event) => {
      event.preventDefault();
      this.submit();
    };
    input.oninput = () => {
      this.layout();
      if (this.target) host.input?.(this.target, input.value);
      host.changed(this.target);
    };
    form.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.submit();
      }
    });
  }
  open(mark: Annotation) {
    if (mark.watermark?.image) return;
    this.target = structuredClone(mark);
    this.host.selected(mark);
    this.form.hidden = false;
    this.input.value = mark.text;
    this.input.maxLength = mark.tool === 'watermark' && mark.text.length <= 500 ? 500 : 2000;
    this.layout();
    this.host.changed(this.target);
    this.input.focus({ preventScroll: true });
    this.layoutCaret();
  }
  layout() {
    if (!this.target) return;
    const mark = this.target,
      size = mark.fontSize || Math.max(12, mark.width * 6),
      style = mark.tool === 'watermark' ? mark.watermark : undefined,
      matrix = style && style.position !== 'custom' ? identity() : mark.transform || identity(),
      scale = this.host.scale();
    this.measure.font = annotationFont(size, mark.fontFamily, mark.fontWeight, mark.italic);
    mark.text = this.input.value;
    const text = style ? watermarkText(mark.text, style.capturedAt) : mark.text;
    const lines = text.split('\n'),
      width = Math.max(1, ...lines.map((line) => this.measure.measureText(line).width)),
      height = lines.length * size * 1.2;
    mark.textBounds = this.measured(mark).textBounds;
    this.measure.textBaseline = 'top';
    const reference = this.measure.measureText(this.placeholder);
    const inkTop = -reference.actualBoundingBoxAscent;
    const inkHeight = reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent || size;
    const editWidth = Math.max(width, reference.width,
      ...this.input.value.split('\n').map(line => this.measure.measureText(line).width));
    const padding = Math.max(1, Math.min(3, size / 24),
      mark.textOutline ? maxTextOutlineWidth(size) / 2 : 0);
    const content = mark.textOutline
      ? this.measured({ ...mark, textOutline: false }).textBounds?.ink
      : mark.textBounds?.ink;
    // Keep the empty line's geometry while typing, extending only for glyphs
    // (for example italic overhangs or descenders) that actually exceed it.
    const left = Math.min(0, -reference.actualBoundingBoxLeft, content?.x ?? 0);
    const right = Math.max(editWidth, reference.actualBoundingBoxRight,
      content ? content.x + content.width : 0);
    const topInk = Math.min(inkTop, content?.y ?? inkTop);
    const bottomInk = Math.max((lines.length - 1) * size * 1.2 + inkTop + inkHeight,
      content ? content.y + content.height : 0);
    this.editingBounds = {
      width: editWidth, height,
      ink: { x: left - padding, y: topInk - padding,
        width: right - left + padding * 2, height: bottomInk - topInk + padding * 2 },
    };
    this.caretLine = { top: inkTop, height: inkHeight, advance: size * 1.2 };
    const radians = ((style?.angle || 0) * Math.PI) / 180,
      cos = Math.cos(radians),
      sin = Math.sin(radians);
    const anchors = style
      ? watermarkAnchors(this.host.area(), { width, height }, style, mark.start)
      : undefined;
    const area = this.host.area(),
      center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const anchor = anchors?.reduce((best, p) =>
      Math.hypot(p.x - center.x, p.y - center.y) < Math.hypot(best.x - center.x, best.y - center.y)
        ? p
        : best,
    );
    const origin = anchor
      ? {
          x: anchor.x - (cos * width) / 2 + (sin * height) / 2,
          y: anchor.y - (sin * width) / 2 - (cos * height) / 2,
        }
      : mark.start;
    const position = this.host.position(mappedPoint(matrix, origin));
    this.measure.textBaseline = 'alphabetic';
    const metrics = this.measure.measureText('Mg');
    this.measure.textBaseline = 'top';
    const top = this.measure.measureText('Mg');
    const baseline =
      (size * 1.2 - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 +
      metrics.fontBoundingBoxAscent;
    const offset = metrics.fontBoundingBoxAscent - top.fontBoundingBoxAscent - baseline;
    Object.assign(this.input.style, {
      font: this.measure.font,
      lineHeight: '1.2',
      color: 'transparent',
      caretColor: 'transparent',
      transform: `translateY(${offset}px)`,
      width: editWidth + 8 + 'px',
      height: height + 2 + 'px',
    });
    Object.assign(this.form.style, {
      left: position.x + 'px',
      top: position.y + 'px',
      transform: `matrix(${(matrix[0] * cos + matrix[2] * sin) * scale},${(matrix[1] * cos + matrix[3] * sin) * scale},${(matrix[2] * cos - matrix[0] * sin) * scale},${(matrix[3] * cos - matrix[1] * sin) * scale},0,0)`,
    });
    this.layoutCaret();
  }
  private layoutCaret() {
    this.caret.hidden = !this.target || document.activeElement !== this.input ||
      this.input.selectionStart !== this.input.selectionEnd;
    if (this.caret.hidden) return;
    const lines = this.input.value.slice(0, this.input.selectionStart).split('\n');
    Object.assign(this.caret.style, {
      left: this.measure.measureText(lines.at(-1)!).width + 'px',
      top: this.caretLine.top + (lines.length - 1) * this.caretLine.advance + 'px',
      height: this.caretLine.height + 'px',
      background: this.target!.color,
    });
    for (const animation of this.caret.getAnimations()) animation.currentTime = 0;
  }
  submit() {
    if (!this.target) return;
    this.layout();
    const mark = this.target,
      text = this.input.value;
    this.target = undefined;
    this.form.hidden = true;
    this.host.changed();
    if (text.trim()) this.host.commit(mark, text);
    else if (this.host.existing(mark.id)) this.host.remove(mark.id);
    this.host.accepted?.();
  }
  cancel() {
    const id = this.target?.id;
    this.target = undefined;
    this.form.hidden = true;
    this.host.changed();
    this.host.selected(id ? this.host.existing(id) : undefined);
  }
}
