export interface CursorStyle {
  visible: boolean;
  size: number;
  clicks: boolean;
  animation: number;
  color: string;
  trail?: 'none' | 'laser' | 'ribbon' | 'dots';
  clickStyle?: 'ring' | 'ripple' | 'spotlight';
}
export const defaultCursorStyle = (): CursorStyle => ({
  visible: true,
  size: 1,
  clicks: false,
  animation: 1,
  color: '#F3B74C',
  trail: 'none',
  clickStyle: 'ring',
});
export function cursorStyle(value: unknown): CursorStyle {
  const v = value as CursorStyle;
  if (
    !v ||
    typeof v.visible !== 'boolean' ||
    typeof v.clicks !== 'boolean' ||
    (v.trail !== undefined && !['none', 'laser', 'ribbon', 'dots'].includes(v.trail)) ||
    (v.clickStyle !== undefined && !['ring', 'ripple', 'spotlight'].includes(v.clickStyle)) ||
    !Number.isFinite(v.size) ||
    v.size < 0.5 ||
    v.size > 4 ||
    !Number.isFinite(v.animation) ||
    v.animation < 0.25 ||
    v.animation > 4 ||
    typeof v.color !== 'string' ||
    !/^#[\da-f]{6}$/i.test(v.color)
  )
    throw Error('光标样式无效');
  return {
    visible: v.visible,
    size: v.size,
    clicks: v.clicks,
    animation: v.animation,
    color: v.color.toUpperCase(),
    trail: v.trail || 'none',
    clickStyle: v.clickStyle || 'ring',
  };
}
export interface CursorShape {
  id: number;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  /** Per pixel: straight-alpha RGBA then an inverse-mask byte; no executable image formats. */
  pixels: string;
  /** Ordered ANI steps, including repeated frames. Durations use the 48 kHz media clock. */
  animation?: { shape: number; samples: number }[];
}
export interface CursorEvent {
  sample: number;
  x: number;
  y: number;
  shape: number;
  scale: number;
  segment: number;
  click: number;
}
export interface RecordingCursor {
  shapes: CursorShape[];
  events: CursorEvent[];
}
export const CURSOR_EVENTS = 220000,
  CURSOR_BYTES = 8 * 1024 * 1024;
export function cursorShape(value: unknown): CursorShape {
  const v = value as CursorShape;
  if (
    !v ||
    !Number.isSafeInteger(v.id) ||
    v.id < 1 ||
    v.id > 64 ||
    ![v.width, v.height].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 256) ||
    ![v.hotspotX, v.hotspotY].every(Number.isSafeInteger) ||
    v.hotspotX < 0 ||
    v.hotspotY < 0 ||
    v.hotspotX >= v.width ||
    v.hotspotY >= v.height ||
    typeof v.pixels !== 'string' ||
    v.pixels.length !== Math.ceil((v.width * v.height * 5) / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.pixels)
  )
    throw Error('光标图形无效');
  if (atob(v.pixels).length !== v.width * v.height * 5) throw Error('光标图形长度无效');
  const animation = v.animation === undefined ? undefined : cursorAnimation(v.animation);
  return {
    id: v.id,
    width: v.width,
    height: v.height,
    hotspotX: v.hotspotX,
    hotspotY: v.hotspotY,
    pixels: v.pixels,
    ...(animation ? { animation } : {}),
  };
}
export function cursorAnimation(value: unknown): NonNullable<CursorShape['animation']> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 256)
    throw Error('光标动画步数无效');
  let duration = 0;
  return value.map((step) => {
    if (
      !step ||
      !Number.isSafeInteger(step.shape) ||
      step.shape < 1 ||
      step.shape > 64 ||
      !Number.isSafeInteger(step.samples) ||
      step.samples < 1 ||
      step.samples > 48000 * 60 ||
      (duration += step.samples) > 48000 * 600
    )
      throw Error('光标动画时长或引用无效');
    return { shape: step.shape, samples: step.samples };
  });
}
export function cursorEvent(value: unknown, width: number, height: number): CursorEvent {
  const v = value as CursorEvent;
  if (
    !v ||
    ![v.sample, v.x, v.y, v.shape, v.segment, v.click].every(Number.isSafeInteger) ||
    v.sample < 0 ||
    v.sample > 48000 * 3601 ||
    v.x < 0 ||
    v.y < 0 ||
    v.x >= width ||
    v.y >= height ||
    v.shape < 0 ||
    v.shape > 64 ||
    v.segment < 0 ||
    v.segment > 100000 ||
    v.click < 0 ||
    v.click > 7 ||
    !Number.isFinite(v.scale) ||
    v.scale < 0.01 ||
    v.scale > 8 ||
    (!v.shape && (v.x !== 0 || v.y !== 0 || v.click !== 0))
  )
    throw Error('光标时间轴无效');
  return {
    sample: v.sample,
    x: v.x,
    y: v.y,
    shape: v.shape,
    scale: v.scale,
    segment: v.segment,
    click: v.click,
  };
}
export function recordingCursor(
  value: unknown,
  width: number,
  height: number,
  samples: number,
): RecordingCursor {
  const v = value as RecordingCursor;
  if (
    !v ||
    !Array.isArray(v.shapes) ||
    v.shapes.length > 64 ||
    !Array.isArray(v.events) ||
    !v.events.length ||
    v.events.length > CURSOR_EVENTS
  )
    throw Error('光标轨道无效');
  const shapes = v.shapes.map(cursorShape),
    ids = new Set(shapes.map((shape) => shape.id));
  if (
    ids.size !== shapes.length ||
    shapes.reduce((sum, s) => sum + s.width * s.height * 5, 0) > CURSOR_BYTES
  )
    throw Error('光标图形容量或编号无效');
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  for (const shape of shapes) {
    if (
      shape.animation &&
      (shape.animation[0].shape !== shape.id ||
        shape.animation.some(
          (step) =>
            !ids.has(step.shape) || (step.shape !== shape.id && byId.get(step.shape)!.animation),
        ))
    )
      throw Error('光标动画引用无效');
  }
  let last = -1,
    segment = 0;
  const events = v.events.map((value) => {
    const event = cursorEvent(value, width, height);
    if (
      event.sample < last ||
      event.sample > samples ||
      event.segment < segment ||
      (event.shape && !ids.has(event.shape))
    )
      throw Error('光标时间轴顺序或引用无效');
    last = event.sample;
    segment = event.segment;
    return event;
  });
  return { shapes, events };
}
/** Binary search supports both backwards seeks and frame-by-frame playback. */
export function cursorAt(events: CursorEvent[], sample: number): CursorEvent | undefined {
  let lo = 0,
    hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].sample <= sample) lo = mid + 1;
    else hi = mid;
  }
  const a = events[lo - 1],
    b = events[lo];
  if (!a) return;
  if (
    !b ||
    !a.shape ||
    a.shape !== b.shape ||
    a.segment !== b.segment ||
    b.sample - a.sample > 4800 ||
    b.sample === a.sample
  )
    return a;
  const t = Math.max(0, Math.min(1, (sample - a.sample) / (b.sample - a.sample)));
  return { ...a, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

const animationOrigins = new WeakMap<CursorEvent[], number[]>();
/** Shape changes, hidden intervals and pause/movement segments restart the independent animation. */
export function cursorFrameAt(data: RecordingCursor, sample: number, speed = 1): number {
  let lo = 0,
    hi = data.events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data.events[mid].sample <= sample) lo = mid + 1;
    else hi = mid;
  }
  const index = lo - 1,
    event = data.events[index];
  if (!event?.shape) return 0;
  const shape = data.shapes.find((shape) => shape.id === event.shape);
  if (!shape?.animation) return event.shape;
  let origins = animationOrigins.get(data.events);
  if (!origins) {
    origins = [];
    for (let i = 0; i < data.events.length; i++) {
      const event = data.events[i],
        previous = data.events[i - 1];
      origins.push(
        previous && event.shape === previous.shape && event.segment === previous.segment
          ? origins[i - 1]
          : event.sample,
      );
    }
    animationOrigins.set(data.events, origins);
  }
  const duration = shape.animation.reduce((sum, step) => sum + step.samples, 0);
  let elapsed = ((sample - origins[index]) * speed) % duration;
  for (const step of shape.animation) {
    if (elapsed < step.samples) return step.shape;
    elapsed -= step.samples;
  }
  return shape.animation[0].shape;
}
