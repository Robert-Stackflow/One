import './recording-annotation-overlay.css';
import {
  ImageHistory,
  type ImageDocument,
  type Annotation,
  type Point,
} from '../../shared/capture/image-document';
import type { AnnotationPacket, } from '../../shared/recording/recording-annotations';
import { AnnotationEditor } from '../editor/annotation-editor';
import { stepOrderControls } from '../editor/step-order';
import { paintAnnotations } from '../editor/capture-paint';
import { InlineAnnotationText } from '../editor/inline-annotation-text';
import { AnnotationSelection } from '../editor/annotation-selection';
import { annotationBrushCursor } from '../editor/annotation-brush-cursor';
const api = window.one!.recordingAnnotation!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T,
  canvas = q<HTMLCanvasElement>('canvas'),
  input = q<HTMLTextAreaElement>('text');
let packet: AnnotationPacket,
  history: ImageHistory,
  editor: AnnotationEditor,
  scene: ImageDocument,
  text: Annotation | undefined,
  pending: ImageDocument | undefined,
  sending: Promise<void> | undefined,
  timer: number | undefined,
  failure = '',
  pointer = -1,
  frozen = false;
const selection = new AnnotationSelection(q('selected'), q('selection-handles'));
const brushCursor = annotationBrushCursor(document.body);
let hover: Point | undefined;
const textEditor = new InlineAnnotationText(q<HTMLFormElement>('text-form'), input, {
  area: () => scene.selection!,
  position: (p) => ({ x: (p.x * innerWidth) / scene.width, y: (p.y * innerHeight) / scene.height }),
  scale: () => innerWidth / scene.width,
  selected: (mark) => editor.select(mark),
  existing: (id) => history.value.annotations.find((a) => a.id === id),
  commit: (mark, value) => editor.text(mark, value),
  remove: (id) => editor.remove(id),
  changed: (mark) => {
    text = mark;
    draw();
  },
});
const backdrop = document.createElement('canvas');
let frameTimer: ReturnType<typeof setTimeout> | undefined,
  framePending = false,
  frameFailed = false;
function redacted() {
  return scene?.annotations.some((a) => a.tool === 'mosaic' || a.tool === 'blur');
}
async function refreshFrame() {
  frameTimer = undefined;
  if (!redacted() || framePending || frameFailed) return;
  framePending = true;
  try {
    const frame = await api.frame(packet.token);
    if (!redacted()) return;
    if (
      !frame.width ||
      !frame.height ||
      frame.width > 1280 ||
      frame.height > 1280 ||
      frame.pixels.length !== frame.width * frame.height * 4
    )
      throw Error('标注预览帧无效');
    backdrop.width = frame.width;
    backdrop.height = frame.height;
    backdrop
      .getContext('2d')!
      .putImageData(
        new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height),
        0,
        0,
      );
    draw();
  } catch (e) {
    frameFailed = true;
    error(e);
  } finally {
    framePending = false;
    if (redacted() && !frameFailed) frameTimer = setTimeout(() => void refreshFrame(), 100);
  }
}
addEventListener('beforeunload', () => {
  clearTimeout(frameTimer);
  backdrop.width = backdrop.height = 0;
});
function error(value: unknown) {
  failure = (value as Error).message || String(value);
  q('status').textContent = failure;
  q('status').hidden = false;
}
const stepOrder = stepOrderControls(
  document.body,
  () => editor,
  () => frozen || pointer >= 0 || !!editor?.active || !!text,
  () => !!packet?.interactive && !text,
);
function draw() {
  if (!scene) return;
  stepOrder.refresh();
  if (redacted()) {
    if (!framePending && frameTimer === undefined && !frameFailed) void refreshFrame();
  } else {
    clearTimeout(frameTimer);
    frameTimer = undefined;
    frameFailed = false;
    backdrop.width = backdrop.height = 0;
  }
  const width = Math.max(1, Math.round(innerWidth * devicePixelRatio)),
    height = Math.max(1, Math.round(innerHeight * devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, width, height);
  c.save();
  c.scale(width / scene.width, height / scene.height);
  paintAnnotations(c, textEditor.scene(scene), undefined, backdrop.width ? backdrop : undefined);
  c.restore();
  const scale = innerWidth / scene.width;
  selection.refresh(
    scene,
    textEditor.selection || scene.annotations.find((a) => a.id === editor.selectedId),
    packet.tool,
    !packet.interactive || (!text && !editor.retainsSelection(packet.tool)),
    editor.magnifierPart,
    (p) => ({ x: p.x * scale, y: p.y * scale }),
    scale,
  );
  brushCursor.refresh(
    hover,
    packet.style.brushSize ?? 24,
    scale,
    packet.interactive &&
      !text &&
      (packet.tool === 'erasebrush' ||
        (['mosaic', 'blur'].includes(packet.tool) && !!packet.style.brush)),
  );
  if (text) textEditor.layout();
}
function changed(value: ImageDocument, committed: boolean) {
  scene = value;
  pending = structuredClone(value);
  draw();
  if (committed) void flush().catch(error);
  else if (timer === undefined)
    timer = window.setTimeout(() => {
      timer = undefined;
      void flush().catch(error);
    }, 66);
}
async function flush() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (sending) {
    await sending;
    if (pending) return flush();
    return;
  }
  sending = (async () => {
    while (pending) {
      const value = pending;
      pending = undefined;
      try {
        await api.scene(packet.token, value);
        if (!frameFailed) {
          failure = '';
          q('status').hidden = true;
        }
      } catch (e) {
        pending = pending || value;
        throw e;
      }
    }
  })();
  try {
    await sending;
  } finally {
    sending = undefined;
  }
}
function at(e: PointerEvent): Point {
  return {
    x: Math.max(0, Math.min(scene.width, (e.clientX * scene.width) / innerWidth)),
    y: Math.max(0, Math.min(scene.height, (e.clientY * scene.height) / innerHeight)),
  };
}
function submitText(cancel = false) {
  if (cancel) textEditor.cancel();
  else textEditor.submit();
}
document.body.onpointerdown = (e) => {
  if (q('text-form').contains(e.target as Node) || (e.target as Element).closest('#step-order'))
    return;
  if (!packet?.interactive || frozen || e.button !== 0) return;
  submitText();
  e.preventDefault();
  const handled = selection.begin(e, at(e), editor) || editor.down(packet.tool, at(e));
  if (handled && editor.active) {
    pointer = e.pointerId;
    canvas.setPointerCapture(pointer);
    editor.move(at(e), e.shiftKey);
  }
};
document.body.onpointermove = (e) => {
  if (!scene) return;
  hover = { x: e.clientX, y: e.clientY };
  canvas.style.cursor = editor.cursor(packet.tool, at(e));
  if (!editor.active) draw();
  if (pointer === e.pointerId && editor.active) editor.move(at(e), e.shiftKey);
};
function end(e: PointerEvent, cancel = false) {
  if (pointer !== e.pointerId) return;
  if (cancel) editor.cancel();
  else {
    editor.move(at(e), e.shiftKey);
    editor.up(scene);
  }
  pointer = -1;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  draw();
}
document.body.onpointerup = (e) => end(e);
document.body.onpointercancel = (e) => end(e, true);
canvas.onlostpointercapture = () => {
  if (pointer !== -1) {
    pointer = -1;
    editor.up(scene);
  }
};
canvas.onpointerleave = () => {
  hover = undefined;
  brushCursor.hide();
};
canvas.ondblclick = (e) => {
  if (frozen || !packet.interactive || editor.active) return;
  const mark = editor.markAt(at(e as unknown as PointerEvent));
  if (mark?.tool === 'text') textEditor.open(mark);
};
document.onkeydown = (e) => {
  if (stepOrder.keydown(e)) return;
  if (e.target instanceof Element && e.target.closest('#step-order input')) return;
  if (text) {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
      e.preventDefault();
      submitText(e.key === 'Escape');
    }
    return;
  }
  if (e.key === 'Escape') {
    editor.cancel();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    submitText();
    editor.cancel();
    if (e.key.toLowerCase() === 'y' || e.shiftKey) history.redo();
    else history.undo();
    editor.clear();
    changed(history.value, true);
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    editor.remove();
  }
};
function currentStyle(tool = packet.tool) {
  const { brushSize = 24, ...style } = packet.style;
  const brush = ['mosaic', 'blur'].includes(tool) && !!style.brush;
  return { ...style, brush, width: tool === 'erasebrush' || brush ? brushSize : style.width };
}
function receive(next: AnnotationPacket) {
  if (!packet) {
    packet = next;
    history = new ImageHistory(next.width, next.height, true);
    scene = history.value;
    editor = new AnnotationEditor({
      history,
      style: currentStyle,
      tolerance: () => (6 * scene.width) / innerWidth,
      changed,
      selected: selected,
      measure: (mark) => textEditor.measured(mark),
      text: (mark) => textEditor.open(mark),
      error,
    });
  }
  if (next.token !== packet.token) return;
  const command = next.command;
  if (command?.kind === 'tool' && frameFailed) {
    frameFailed = false;
    failure = '';
    q('status').hidden = true;
  }
  if (command?.kind === 'tool' || command?.kind === 'interact' || next.flush) {
    submitText();
    if (editor.active) editor.up(scene);
    pointer = -1;
  }
  packet = { ...next, command: undefined, flush: undefined };
  if (command?.kind === 'tool') editor.clear();
  document.documentElement.dataset.interactive = String(next.interactive);
  document.documentElement.dataset.tool = next.tool;
  if (command?.kind === 'style') {
    const style = currentStyle(
      text?.tool || scene.annotations.find((a) => a.id === editor.selectedId)?.tool || packet.tool,
    );
    if (text) {
      Object.assign(text, style);
      textEditor.layout();
    } else editor.update(style);
  }
  if (command?.kind === 'undo' || command?.kind === 'redo' || command?.kind === 'clear') {
    submitText();
    editor.cancel();
    if (command.kind === 'clear') editor.commit({ ...history.value, annotations: [] });
    else {
      history[command.kind]();
      changed(history.value, true);
    }
    editor.clear();
  }
  if (next.flush) {
    frozen = true;
    void flush()
      .then(
        () => api.flushed(next.token, next.flush!, ''),
        (e) => api.flushed(next.token, next.flush!, (e as Error).message),
      )
      .finally(() => {
        frozen = false;
        draw();
      })
      .catch(error);
  }
  draw();
}
api.onChange(receive);
function selected(mark?: Annotation) {
  if (mark)
    packet.style = {
      ...packet.style,
      color: mark.color,
      ...((['mosaic', 'blur'].includes(mark.tool) && mark.brush) || mark.tool === 'erasebrush'
        ? { brushSize: mark.width }
        : { width: mark.width }),
      strength: mark.strength,
      brush: ['mosaic', 'blur'].includes(mark.tool) ? !!mark.brush : packet.style.brush,
      fontSize: mark.fontSize || packet.style.fontSize,
      fontFamily: mark.fontFamily || packet.style.fontFamily,
      fontWeight: ([400, 600, 700].includes(mark.fontWeight || 0)
        ? mark.fontWeight
        : packet.style.fontWeight) as 400 | 600 | 700,
      italic: !!mark.italic,
      textOutline: !!mark.textOutline,
      filled: !!mark.filled,
      strokeStyle: mark.strokeStyle || 'solid',
    };
  void api.selected(packet.token, mark?.tool, packet.style).catch(error);
  draw();
}
void api.state().then(receive).catch(error);
new ResizeObserver(draw).observe(document.body);
