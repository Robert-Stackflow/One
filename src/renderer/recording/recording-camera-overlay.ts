import './recording-camera-overlay.css';
import { createElement, FlipHorizontal2, Shapes, EyeOff, MoveDiagonal2 } from 'lucide';
import type { CameraPacket } from '../../shared/recording/recording-camera-overlay';
import { drawCamera } from './recording-camera';
import { cameraBox } from '../../shared/recording/recording-camera';
const api = window.one!.recordingCamera!,
  q = (id: string) => document.getElementById(id)!;
for (const [id, icon] of [
  ['mirror', FlipHorizontal2],
  ['shape', Shapes],
  ['hide', EyeOff],
  ['resize', MoveDiagonal2],
] as const)
  q(id).append(createElement(icon));
let state: CameraPacket | undefined,
  loading = false,
  pending: CameraPacket | undefined;
const image = new Image(),
  canvas = q('picture') as HTMLCanvasElement;
function paint() {
  if (!state || !image.naturalWidth) return;
  const width = Math.round(innerWidth * devicePixelRatio),
    height = Math.round(innerHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.resetTransform();
  ctx.clearRect(0, 0, width, height);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  drawCamera(
    ctx,
    image,
    {
      ...state.style,
      border:
        (state.style.border * (innerWidth - 24)) /
        cameraBox(state.style, state, { width: state.videoWidth, height: state.videoHeight }).width,
    },
    { x: 12, y: 12, width: innerWidth - 24, height: innerHeight - 24 },
    image.naturalWidth,
    image.naturalHeight,
  );
}
function load() {
  if (loading || !pending) return;
  const next = pending;
  pending = undefined;
  loading = true;
  image.src = next.url;
}
image.onload = () => {
  loading = false;
  paint();
  load();
};
image.onerror = () => {
  loading = false;
  if (pending) load();
};
function changed(value: CameraPacket) {
  const previous = state;
  state = value;
  if (JSON.stringify(previous?.style) !== JSON.stringify(value.style)) paint();
  if (value.serial && value.serial !== previous?.serial) {
    pending = value;
    load();
  }
}
function error(value: unknown) {
  q('message').textContent = String((value as Error).message).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
}
let busy = false;
async function style(patch: Partial<CameraPacket['style']>) {
  if (!state || busy) return;
  busy = true;
  try {
    await api.style(state.token, { ...state.style, ...patch });
  } catch (e) {
    error(e);
  } finally {
    busy = false;
  }
}
q('mirror').onclick = () => void style({ mirror: !state?.style.mirror });
q('shape').onclick = () =>
  void style({
    shape:
      state?.style.shape === 'rounded'
        ? 'circle'
        : state?.style.shape === 'circle'
          ? 'rectangle'
          : 'rounded',
  });
q('hide').onclick = () => void style({ visible: false });
type Drag = {
  token: string;
  phase: 'start' | 'move' | 'end';
  resize: boolean;
  point: { x: number; y: number };
};
let active: { pointer: number; token: string; resize: boolean } | undefined,
  pendingDrag: Drag | undefined,
  sending = false;
async function flush() {
  if (sending) return;
  sending = true;
  try {
    while (pendingDrag) {
      if (pendingDrag.phase === 'move') await new Promise((resolve) => setTimeout(resolve, 25));
      if (!pendingDrag) break;
      const next = pendingDrag;
      pendingDrag = undefined;
      await api.drag(next.token, next.phase, next.resize, next.point);
    }
  } catch (e) {
    error(e);
    active = undefined;
    pendingDrag = undefined;
  } finally {
    sending = false;
  }
}
for (const [id, resize] of [
  ['picture', false],
  ['resize', true],
] as const) {
  const element = q(id);
  element.onpointerdown = (event) => {
    if (event.button !== 0 || !state || sending) return;
    event.preventDefault();
    active = { pointer: event.pointerId, token: state.token, resize };
    element.setPointerCapture(event.pointerId);
    pendingDrag = {
      token: state.token,
      phase: 'start',
      resize,
      point: { x: event.screenX, y: event.screenY },
    };
    void flush();
  };
  element.onpointermove = (event) => {
    if (active?.pointer !== event.pointerId) return;
    pendingDrag = {
      token: active.token,
      phase: 'move',
      resize,
      point: { x: event.screenX, y: event.screenY },
    };
    void flush();
  };
  const end = (event: PointerEvent) => {
    if (active?.pointer !== event.pointerId) return;
    pendingDrag = {
      token: active.token,
      phase: 'end',
      resize,
      point: { x: event.screenX, y: event.screenY },
    };
    active = undefined;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    void flush();
  };
  element.onpointerup = end;
  element.onpointercancel = end;
}
new ResizeObserver(paint).observe(document.body);
api.onChange(changed);
void api.state().then(changed).catch(error);
