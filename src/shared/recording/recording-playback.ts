import { cameraStyle, type CameraStyle } from './recording-camera';
import { inputStyle, type InputStyle } from './recording-input';
import { cursorStyle, defaultCursorStyle, type CursorStyle } from './recording-cursor';
import type { RecorderAPI, RecordingState } from './recording';
import { gifEdit, type GifEdit } from './recording-gif';

export interface TimeOverlay {
  visible: boolean;
  position: InputStyle['position'] | 'custom';
  x?: number;
  y?: number;
  size: number;
  color: string;
  background: string;
  opacity: number;
  backgroundOpacity: number;
  width: number;
  progress: boolean;
  shape?: 'rectangle' | 'circle';
}
export interface PlaybackSettings {
  gif?: GifEdit;
  speed: number;
  left: number;
  right: number;
  system: number;
  microphone: number;
  cursor?: CursorStyle;
  annotations: boolean;
  camera?: CameraStyle;
  input?: InputStyle;
  time: TimeOverlay;
}
export const defaultPlayback = (): PlaybackSettings => ({
  speed: 1,
  left: 1,
  right: 1,
  system: 1,
  microphone: 1,
  cursor: defaultCursorStyle(),
  annotations: true,
  time: {
    visible: false,
    position: 'bottom-center',
    size: 24,
    color: '#FFFFFF',
    background: '#101010',
    opacity: 1,
    backgroundOpacity: 0.7,
    width: 0.18,
    progress: true,
    shape: 'rectangle',
  },
});
export function playbackSettings(value: unknown): PlaybackSettings {
  const v = value as PlaybackSettings,
    t = v?.time,
    system = v?.system,
    microphone = v?.microphone;
  if (
    !v ||
    ![v.speed, v.left, v.right].every(Number.isFinite) ||
    v.speed < 0.25 ||
    v.speed > 4 ||
    v.left < 0 ||
    v.left > 2 ||
    v.right < 0 ||
    v.right > 2 ||
    ![system, microphone].every((gain) => Number.isFinite(gain) && gain >= 0 && gain <= 2) ||
    typeof v.annotations !== 'boolean' ||
    !t ||
    typeof t.visible !== 'boolean' ||
    typeof t.progress !== 'boolean' ||
    (t.shape !== undefined && !['rectangle', 'circle'].includes(t.shape)) ||
    ![
      'custom',
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ].includes(t.position) ||
    (t.position === 'custom' &&
      ![t.x, t.y].every((n) => Number.isFinite(n) && n! >= 0 && n! <= 1)) ||
    ![t.size, t.opacity, t.backgroundOpacity, t.width].every(Number.isFinite) ||
    t.size < 12 ||
    t.size > 64 ||
    t.opacity < 0 ||
    t.opacity > 1 ||
    t.backgroundOpacity < 0 ||
    t.backgroundOpacity > 1 ||
    t.width < 0.08 ||
    t.width > 0.9 ||
    ![t.color, t.background].every((c) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c))
  )
    throw Error('播放设置无效');
  return {
    ...(v.gif === undefined ? {} : { gif: gifEdit(v.gif) }),
    speed: v.speed,
    left: v.left,
    right: v.right,
    system,
    microphone,
    ...(v.cursor === undefined ? {} : { cursor: cursorStyle(v.cursor) }),
    annotations: v.annotations,
    ...(v.camera ? { camera: cameraStyle(v.camera) } : {}),
    ...(v.input ? { input: inputStyle(v.input) } : {}),
    time: {
      visible: t.visible,
      progress: t.progress,
      shape: t.shape || 'rectangle',
      position: t.position,
      ...(t.position === 'custom' ? { x: t.x, y: t.y } : {}),
      size: t.size,
      opacity: t.opacity,
      backgroundOpacity: t.backgroundOpacity,
      width: t.width,
      color: t.color.toUpperCase(),
      background: t.background.toUpperCase(),
    },
  };
}
export type RecordingPlayerAPI = Pick<
  RecorderAPI,
  | 'inputEvents'
  | 'annotationEvents'
  | 'cameraLayouts'
  | 'cursorEvents'
  | 'cursorShapes'
  | 'onChange'
> & {
  state(): Promise<PlaybackState>;
  edit(token: string, value: PlaybackSettings): Promise<void>;
  save(token: string, camera?: boolean): Promise<string | null>;
  saveProject(token: string): Promise<string | null>;
  export(
    token: string,
    options: import('./recording-export').RecordingExportOptions,
  ): Promise<string | null>;
  cancelExport(token: string, id: string): Promise<void>;
  previewGif(
    token: string,
    options: import('./recording-export').RecordingExportOptions,
    complete?: boolean,
  ): Promise<import('./recording-export').GifPreview | null>;
};
export type PlaybackState = RecordingState & { playback: PlaybackSettings };
export function playbackTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return (
    (seconds >= 3600 ? Math.floor(seconds / 3600) + ':' : '') +
    [Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, '0')).join(':')
  );
}
