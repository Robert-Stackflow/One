import './inline-annotation-text.css';
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
        const edge = Math.max(1, size / 16);
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
  /** Editing and export use the exact same canvas painter; the textarea provides
   * native input/selection/caret without a second, differently aligned glyph layer. */
  scene(scene: ImageDocument): ImageDocument {
    if (!this.target) return scene;
    const found = scene.annotations.some((a) => a.id === this.target!.id);
    return {
      ...scene,
      annotations: found
        ? scene.annotations.map((a) => (a.id === this.target!.id ? this.target! : a))
        : [...scene.annotations, this.target],
    };
  }
  get selection() {
    if (!this.target) return;
    if (this.target.text.trim()) return this.target;
    return {
      ...this.target,
      textBounds: {
        width: parseFloat(this.input.style.width),
        height: parseFloat(this.input.style.height),
      },
    };
  }
  constructor(
    readonly form: HTMLFormElement,
    readonly input: HTMLTextAreaElement,
    private host: TextHost,
  ) {
    form.classList.add('inline-annotation-editor');
    input.wrap = 'off';
    input.placeholder = '输入文字';
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
      caretColor: mark.color,
      transform: `translateY(${offset}px)`,
      width:
        Math.max(
          size * 4,
          width + 8,
          ...this.input.value.split('\n').map((line) => this.measure.measureText(line).width + 8),
          this.input.value ? 0 : this.measure.measureText(this.input.placeholder).width + 8,
        ) + 'px',
      height: height + 2 + 'px',
    });
    Object.assign(this.form.style, {
      left: position.x + 'px',
      top: position.y + 'px',
      transform: `matrix(${(matrix[0] * cos + matrix[2] * sin) * scale},${(matrix[1] * cos + matrix[3] * sin) * scale},${(matrix[2] * cos - matrix[0] * sin) * scale},${(matrix[3] * cos - matrix[1] * sin) * scale},0,0)`,
    });
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
