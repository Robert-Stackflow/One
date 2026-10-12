export interface InputStyle {
  keys: 'off' | 'shortcuts' | 'all';
  clicks: boolean;
  trail: boolean;
  position:
    | 'custom'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'top-left'
    | 'top-center'
    | 'top-right';
  x?: number;
  y?: number;
  size: number;
  color: string;
  duration: number;
  animation: number;
}
export const defaultInputStyle = (): InputStyle => ({
  keys: 'off',
  clicks: false,
  trail: false,
  position: 'bottom-left',
  size: 24,
  color: '#F3B74C',
  duration: 1500,
  animation: 1,
});
export function inputStyle(value: unknown): InputStyle {
  const v = value as InputStyle;
  if (
    !v ||
    !['off', 'shortcuts', 'all'].includes(v.keys) ||
    typeof v.clicks !== 'boolean' ||
    typeof v.trail !== 'boolean' ||
    ![
      'custom',
      'bottom-left',
      'bottom-center',
      'bottom-right',
      'top-left',
      'top-center',
      'top-right',
    ].includes(v.position) ||
    (v.position === 'custom' &&
      ![v.x, v.y].every((n) => Number.isFinite(n) && n! >= 0 && n! <= 1)) ||
    !Number.isFinite(v.size) ||
    v.size < 16 ||
    v.size > 96 ||
    typeof v.color !== 'string' ||
    !/^#[\da-f]{6}$/i.test(v.color) ||
    !Number.isSafeInteger(v.duration) ||
    v.duration < 500 ||
    v.duration > 5000 ||
    !Number.isFinite(v.animation) ||
    v.animation < 0.5 ||
    v.animation > 2
  )
    throw Error('键鼠展示设置无效');
  return {
    keys: v.keys,
    clicks: v.clicks,
    trail: v.trail,
    position: v.position,
    ...(v.position === 'custom' ? { x: v.x, y: v.y } : {}),
    size: v.size,
    color: v.color.toUpperCase(),
    duration: v.duration,
    animation: v.animation,
  };
}
export const inputEnabled = (style?: InputStyle) =>
  !!style && (style.keys !== 'off' || style.clicks || style.trail);

/** Match the native shortcut capture filter when narrowing an all-keys recording. */
export function inputShortcut(event: Extract<RecordingInput, { kind: 'key' }>) {
  if ([16, 17, 18, 91, 92, 160, 161, 162, 163, 164, 165].includes(event.vk)) return false;
  return (
    !!(event.modifiers & 13) ||
    (event.vk >= 112 && event.vk <= 135) ||
    (event.vk >= 33 && event.vk <= 40) ||
    [27, 9, 13, 46].includes(event.vk)
  );
}
export const inputFlags = (style?: InputStyle) =>
  (style?.keys === 'all' ? 2 : style?.keys === 'shortcuts' ? 1 : 0) |
  (style?.clicks ? 4 : 0) |
  (style?.trail ? 8 : 0);
export type RecordingInput = { id: number; sample: number } & (
  | { kind: 'key'; vk: number; modifiers: number }
  | { kind: 'move' | 'click' | 'wheel'; x: number; y: number; button: number }
  | { kind: 'leave' }
);
export const INPUT_EVENTS = 200000;
export function recordingInput(value: unknown, width: number, height: number): RecordingInput {
  const v = value as RecordingInput;
  if (
    !v ||
    !Number.isSafeInteger(v.id) ||
    v.id < 1 ||
    v.id > INPUT_EVENTS ||
    !Number.isSafeInteger(v.sample) ||
    v.sample < 0 ||
    v.sample > 48000 * 3600
  )
    throw Error('键鼠时间轴无效');
  if (v.kind === 'key') {
    if (
      !Number.isSafeInteger(v.vk) ||
      v.vk < 1 ||
      v.vk > 254 ||
      !Number.isSafeInteger(v.modifiers) ||
      v.modifiers < 0 ||
      v.modifiers > 15
    )
      throw Error('按键事件无效');
    return { id: v.id, sample: v.sample, kind: v.kind, vk: v.vk, modifiers: v.modifiers };
  }
  if (v.kind === 'leave') return { id: v.id, sample: v.sample, kind: v.kind };
  if (
    !['move', 'click', 'wheel'].includes(v.kind) ||
    ![v.x, v.y].every(Number.isFinite) ||
    v.x < 0 ||
    v.y < 0 ||
    v.x >= width ||
    v.y >= height ||
    !Number.isSafeInteger(v.button) ||
    (v.kind === 'click'
      ? v.button < 1 || v.button > 5
      : v.kind === 'move'
        ? v.button !== 0
        : v.button < -20 || v.button > 20 || v.button === 0)
  )
    throw Error('鼠标事件无效');
  return {
    id: v.id,
    sample: v.sample,
    kind: v.kind as 'move' | 'click' | 'wheel',
    x: v.x,
    y: v.y,
    button: v.button,
  };
}
export function inputKeyLabel(event: Extract<RecordingInput, { kind: 'key' }>) {
  const names: Record<number, string> = {
    16: 'Shift',
    17: 'Ctrl',
    18: 'Alt',
    160: 'Shift',
    161: 'Shift',
    162: 'Ctrl',
    163: 'Ctrl',
    164: 'Alt',
    165: 'Alt',
    8: 'Backspace',
    9: 'Tab',
    13: 'Enter',
    27: 'Esc',
    32: 'Space',
    33: 'Page Up',
    34: 'Page Down',
    35: 'End',
    36: 'Home',
    37: '←',
    38: '↑',
    39: '→',
    40: '↓',
    45: 'Insert',
    46: 'Delete',
    91: 'Win',
    92: 'Win',
    186: ';',
    187: '=',
    188: ',',
    189: '−',
    190: '.',
    191: '/',
    192: '`',
    219: '[',
    220: '\\',
    221: ']',
    222: "'",
  };
  const key =
    names[event.vk] ||
    (event.vk >= 112 && event.vk <= 135
      ? 'F' + (event.vk - 111)
      : event.vk >= 48 && event.vk <= 90
        ? String.fromCharCode(event.vk)
        : event.vk >= 96 && event.vk <= 105
          ? 'Num ' + (event.vk - 96)
          : 'Key ' + event.vk);
  const modifiers =
    event.modifiers &
    ~(key === 'Ctrl' ? 1 : key === 'Shift' ? 2 : key === 'Alt' ? 4 : key === 'Win' ? 8 : 0);
  return [
    modifiers & 1 ? 'Ctrl' : '',
    modifiers & 2 ? 'Shift' : '',
    modifiers & 4 ? 'Alt' : '',
    modifiers & 8 ? 'Win' : '',
    key,
  ]
    .filter(Boolean)
    .join(' + ');
}
/** Binary-search a bounded time window, including backward seeks. */
export function inputWindow(events: readonly RecordingInput[], sample: number, duration: number) {
  const from = Math.max(0, sample - duration * 48);
  const bound = (value: number, inclusive: boolean) => {
    let l = 0,
      r = events.length;
    while (l < r) {
      const m = (l + r) >>> 1;
      if (events[m].sample < value || (inclusive && events[m].sample === value)) l = m + 1;
      else r = m;
    }
    return l;
  };
  return events.slice(bound(from, false), bound(sample, true));
}
