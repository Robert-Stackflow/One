import {
  ImageHistory,
  validateImageDocument,
  type Annotation,
  type CaptureTool,
  type ImageDocument,
} from '../capture/image-document';
import { strokeStyles, type StrokeStyle } from '../capture/stroke-style';

export const recordingTools: CaptureTool[] = [
  'move',
  'rectangle',
  'roundrect',
  'ellipse',
  'triangle',
  'diamond',
  'solid',
  'mosaic',
  'blur',
  'arrow',
  'line',
  'brush',
  'highlight',
  'text',
  'step',
  'erasebrush',
  'erase',
];
export interface RecordingAnnotationStyle {
  color: string;
  width: number;
  strength: number;
  brush?: boolean;
  brushSize?: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: 400 | 600 | 700;
  italic?: boolean;
  textOutline?: boolean;
  filled: boolean;
  strokeStyle: StrokeStyle;
}
export const defaultAnnotationStyle = (): RecordingAnnotationStyle => ({
  color: '#e34e4e',
  width: 3,
  strength: 12,
  brush: true,
  brushSize: 24,
  fontSize: 24,
  fontFamily: 'Segoe UI',
  fontWeight: 400,
  filled: false,
  strokeStyle: 'solid',
});
export type AnnotationCommand =
  | { kind: 'tool'; tool: CaptureTool }
  | { kind: 'style'; style: RecordingAnnotationStyle }
  | { kind: 'undo' | 'redo' | 'clear' | 'interact' };
export function annotationCommand(value: unknown): AnnotationCommand {
  const v = value as AnnotationCommand;
  if (!v || !['tool', 'style', 'undo', 'redo', 'clear', 'interact'].includes(v.kind))
    throw Error('标注操作无效');
  if (v.kind === 'tool' && !recordingTools.includes(v.tool)) throw Error('标注工具无效');
  if (v.kind === 'style') {
    const s = v.style;
    if (
      !s ||
      !/^#[0-9a-f]{6}$/i.test(s.color) ||
      !Number.isFinite(s.width) ||
      s.width < 1 ||
      s.width > 80 ||
      !Number.isFinite(s.strength) ||
      s.strength < 1 ||
      s.strength > 64 ||
      !Number.isFinite(s.fontSize) ||
      s.fontSize < 8 ||
      s.fontSize > 240 ||
      typeof s.fontFamily !== 'string' ||
      s.fontFamily.length > 256 ||
      /[\x00-\x1f]/.test(s.fontFamily) ||
      ![400, 600, 700].includes(s.fontWeight) ||
      (s.italic !== undefined && typeof s.italic !== 'boolean') ||
      (s.textOutline !== undefined && typeof s.textOutline !== 'boolean') ||
      typeof s.filled !== 'boolean' ||
      (s.brush !== undefined && typeof s.brush !== 'boolean') ||
      (s.brushSize !== undefined &&
        (!Number.isFinite(s.brushSize) || s.brushSize < 6 || s.brushSize > 80)) ||
      !strokeStyles.some((sv) => sv.value === s.strokeStyle)
    )
      throw Error('标注样式无效');
    return {
      kind: 'style',
      style: {
        color: s.color,
        width: s.width,
        strength: s.strength,
        brush: !!s.brush,
        brushSize: s.brushSize ?? 24,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        italic: !!s.italic,
        textOutline: !!s.textOutline,
        filled: s.filled,
        strokeStyle: s.strokeStyle,
      },
    };
  }
  return v.kind === 'tool' ? { kind: 'tool', tool: v.tool } : { kind: v.kind };
}
/** Deltas preserve object order while avoiding copies of unchanged strokes. 48 kHz media clock. */
export interface AnnotationEvent {
  sample: number;
  remove: string[];
  upsert: Annotation[];
  order: string[];
}
export function annotationScene(value: unknown, width: number, height: number) {
  const scene = validateImageDocument(value, { width, height });
  if (
    scene.width !== width ||
    scene.height !== height ||
    JSON.stringify(scene.transform) !== '[1,0,0,1,0,0]' ||
    JSON.stringify(scene.selection) !== JSON.stringify({ x: 0, y: 0, width, height }) ||
    scene.annotations.some((a) => !recordingTools.includes(a.tool))
  )
    throw Error('录制标注画布无效');
  return scene;
}
export function annotationDelta(
  before: Annotation[],
  after: Annotation[],
  sample: number,
): AnnotationEvent | undefined {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const old = new Map(before.map((a) => [a.id, JSON.stringify(a)])),
    ids = new Set(after.map((a) => a.id));
  return {
    sample,
    remove: before.filter((a) => !ids.has(a.id)).map((a) => a.id),
    upsert: after.filter((a) => old.get(a.id) !== JSON.stringify(a)),
    order: after.map((a) => a.id),
  };
}
export class AnnotationReplay {
  private index = 0;
  private position = -1;
  private marks = new Map<string, Annotation>();
  private order: string[] = [];
  constructor(readonly events: AnnotationEvent[]) {}
  at(sample: number): Annotation[] {
    if (sample < this.position) {
      this.index = 0;
      this.marks.clear();
      this.order = [];
    }
    while (this.index < this.events.length && this.events[this.index].sample <= sample) {
      const event = this.events[this.index++];
      for (const id of event.remove) this.marks.delete(id);
      for (const mark of event.upsert) this.marks.set(mark.id, mark);
      this.order = event.order;
    }
    this.position = sample;
    return this.order.map((id) => this.marks.get(id)!).filter(Boolean);
  }
}
export function emptyAnnotationScene(width: number, height: number): ImageDocument {
  return new ImageHistory(width, height, true).value;
}
export interface AnnotationPacket {
  token: string;
  width: number;
  height: number;
  interactive: boolean;
  tool: CaptureTool;
  style: RecordingAnnotationStyle;
  command?: AnnotationCommand;
  flush?: string;
}
export interface RecordingAnnotationFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}
export interface RecordingAnnotationAPI {
  state(): Promise<AnnotationPacket>;
  scene(token: string, scene: ImageDocument): Promise<void>;
  frame(token: string): Promise<RecordingAnnotationFrame>;
  selected(
    token: string,
    tool: CaptureTool | undefined,
    style: RecordingAnnotationStyle,
  ): Promise<void>;
  flushed(token: string, id: string, error: string): Promise<void>;
  onChange(callback: (packet: AnnotationPacket) => void): () => void;
}
