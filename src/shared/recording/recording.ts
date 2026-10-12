import { t as tr } from '../capture/i18n';
import type { Region } from '../capture/region';
import type { AudioCapabilities, AudioDraft } from './native-audio';
import type { VideoReady } from './native-video';
import type { RecordingVideo } from './recording-media';
import type { CursorEvent, CursorShape } from './recording-cursor';
import { inputStyle, type InputStyle, type RecordingInput } from './recording-input';
import type { AnnotationEvent, RecordingAnnotationStyle } from './recording-annotations';
import type { CaptureTool } from '../capture/image-document';
import {
  cameraOptions,
  type CameraOptions,
  type CameraDevice,
  type CameraLayout,
} from './recording-camera';
export const RECORD_CHUNK = 8 * 1024 * 1024,
  RECORD_BYTES = 1024 * 1024 * 1024,
  RECORD_SECONDS = 3600;
export type RecordingContainer = 'mp4' | 'webm' | 'wav';
export interface RecordingOptions {
  container?: RecordingContainer;
  mode: 'video' | 'audio';
  sourceId: string;
  videoSource?: 'camera';
  systemAudio: boolean;
  microphone: boolean;
  microphoneId: string;
  systemAudioId?: string;
  audioBitrate?: 96000 | 128000 | 160000 | 192000;
  videoBitrate?: 2000000 | 6000000 | 12000000 | 20000000;
  videoEncoder?: 'auto' | 'software';
  cursor?: boolean;
  delay?: number;
  input?: InputStyle;
  camera?: CameraOptions;
  fps: 15 | 30 | 60;
  maxWidth: 1920 | 2560;
  regionToken?: string;
}
export interface RecordingSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail: string;
  width?: number;
  height?: number;
}
export type RecordingPhase =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'ready'
  | 'saving';
export interface RecordingState {
  export?: import('./recording-export').RecordingExportState;
  projectSaved?: string;
  projectDirty?: boolean;
  projectBusy?: boolean;
  importing?: boolean;
  importedVideo?: boolean;
  annotationCount?: number;
  annotating?: boolean;
  annotationTool?: CaptureTool;
  annotationSelection?: CaptureTool;
  annotationStyle?: RecordingAnnotationStyle;
  camera?: VideoReady;
  cameraSeconds?: number;
  cameraUrl?: string;
  cameraLiveUrl?: string;
  cameraSaved?: string;
  cameraStyle?: import('./recording-camera').CameraStyle;
  inputStyle?: InputStyle;
  recordedInput?: InputStyle;
  inputCount?: number;
  phase: RecordingPhase;
  token: string;
  seconds: number;
  countdown?: number;
  bytes: number;
  dark: boolean;
  message: string;
  url?: string;
  mime?: string;
  saved?: string;
  options?: RecordingOptions;
  region?: Region;
  regionMovable?: boolean;
  movingRegion?: boolean;
  regionCrop?: import('../capture/region').Rectangle;
  backend?: 'wasapi' | 'wgc' | 'camera';
  video?: RecordingVideo;
  levels?: { system: number; microphone: number; mixed: number; clipped: boolean };
  gains?: { system: number; microphone: number };
  audioSources?: Partial<Record<RecordingAudioSource, string>>;
  cursorCount?: number;
  retryAudio?: boolean;
  audioDrafts?: AudioDraft[];
}
export const RECORDING_AUDIO_SOURCES = ['system', 'microphone'] as const;
export type RecordingAudioSource = (typeof RECORDING_AUDIO_SOURCES)[number];
export interface AudioTestState {
  channel: RecordingAudioSource;
  status: 'idle' | 'starting' | 'active' | 'error';
  level: number;
  message?: string;
}
export interface RecorderAPI {
  /** Visibility of the One settings page; active capture remains owned by the client. */
  pageActive(value: boolean): Promise<void>;
  audioTest(channel: RecordingAudioSource, enabled: boolean, device: string): Promise<void>;
  onAudioTest(callback: (state: AudioTestState) => void): () => void;
  cursorEvents(token: string, after: number): Promise<CursorEvent[]>;
  cursorShapes(token: string): Promise<CursorShape[]>;
  openProject(): Promise<void>;
  prepareNext(): Promise<void>;
  openMaterials(): Promise<void>;
  startAvailability(value: boolean): Promise<void>;
  onStart(callback: () => void): () => void;
  importVideo(): Promise<void>;
  cancelImport(): Promise<void>;
  openPlayer(): Promise<void>;
  annotationEvents(token: string, after: number): Promise<AnnotationEvent[]>;
  cameras(): Promise<CameraDevice[]>;
  cameraLayouts(token: string): Promise<CameraLayout[]>;
  inputEvents(token: string, after: number): Promise<RecordingInput[]>;
  state(): Promise<RecordingState>;
  cameraSetup(device: string | null): Promise<string | null>;
  chooseRegion(
    sourceId: string,
    hideMain?: boolean,
  ): Promise<{ token: string; width: number; height: number } | null>;
  beginMicrophoneList(): Promise<string>;
  endMicrophoneList(token: string): Promise<void>;
  sources(type?: 'screen' | 'window'): Promise<RecordingSource[]>;
  audioDevices(): Promise<AudioCapabilities>;
  nativeStart(options: RecordingOptions): Promise<void>;
  nativePause(token: string, paused: boolean): Promise<void>;
  nativeGain(token: string, system: number, microphone: number): Promise<void>;
  nativeStop(token: string): Promise<void>;
  recoverAudio(id: string): Promise<void>;
  discardAudioDraft(id: string): Promise<void>;
  arm(options: RecordingOptions): Promise<string>;
  started(token: string, mime: string): Promise<void>;
  chunk(token: string, sequence: number, data: Uint8Array): Promise<void>;
  heartbeat(token: string, seconds: number): Promise<void>;
  paused(token: string, paused: boolean): Promise<void>;
  finish(token: string, seconds: number, reason: string, mime: string): Promise<void>;
  cancel(): Promise<void>;
  fail(token: string, message: string): Promise<void>;
  save(): Promise<string | null>;
  saveCamera(): Promise<string | null>;
  copySaved(): Promise<void>;
  onChange(callback: () => void): () => void;
  onStop(callback: () => void): () => void;
}
export function recordingOptions(value: unknown): RecordingOptions {
  const v = value as RecordingOptions;
  if (
    !v ||
    (v.container !== undefined &&
      (!['mp4', 'webm', 'wav'].includes(v.container) ||
        (v.container === 'wav' && v.mode !== 'audio'))) ||
    !['video', 'audio'].includes(v.mode) ||
    typeof v.sourceId !== 'string' ||
    v.sourceId.length > 120 ||
    (v.mode === 'video' &&
      v.videoSource !== 'camera' &&
      !/^(screen|window):\d+:\d+$/.test(v.sourceId)) ||
    (v.videoSource !== undefined &&
      (v.videoSource !== 'camera' ||
        v.mode !== 'video' ||
        !v.camera ||
        v.sourceId !== '' ||
        v.regionToken !== undefined ||
        v.input !== undefined ||
        v.cursor !== false ||
        v.container === 'webm')) ||
    typeof v.systemAudio !== 'boolean' ||
    typeof v.microphone !== 'boolean' ||
    (v.mode === 'audio' && !v.systemAudio && !v.microphone) ||
    typeof v.microphoneId !== 'string' ||
    v.microphoneId.length > 1000 ||
    (v.mode === 'audio' && v.container === 'webm') ||
    (v.systemAudioId !== undefined &&
      (typeof v.systemAudioId !== 'string' ||
        v.systemAudioId.length > 1000 ||
        /[\x00-\x1f]/.test(v.systemAudioId))) ||
    (v.audioBitrate !== undefined && ![96000, 128000, 160000, 192000].includes(v.audioBitrate)) ||
    (v.videoBitrate !== undefined &&
      (v.mode !== 'video' || ![2000000, 6000000, 12000000, 20000000].includes(v.videoBitrate))) ||
    (v.videoEncoder !== undefined &&
      (v.mode !== 'video' || !['auto', 'software'].includes(v.videoEncoder))) ||
    (v.cursor !== undefined && (v.mode !== 'video' || typeof v.cursor !== 'boolean')) ||
    (v.input !== undefined && (v.mode !== 'video' || v.container === 'webm')) ||
    (v.camera !== undefined && (v.mode !== 'video' || v.container === 'webm')) ||
    (v.delay !== undefined &&
      (!Number.isSafeInteger(v.delay) || v.delay < 0 || v.delay > 60 || v.container === 'webm')) ||
    /[\x00-\x1f]/.test(v.microphoneId) ||
    ![15, 30, 60].includes(v.fps) ||
    ![1920, 2560].includes(v.maxWidth) ||
    (v.regionToken !== undefined &&
      (typeof v.regionToken !== 'string' ||
        v.regionToken.length > 80 ||
        v.mode !== 'video' ||
        !v.sourceId.startsWith('screen:')))
  )
    throw new Error(tr('录制选项无效，请选择来源和声音'));
  return {
    ...(v.container ? { container: v.container } : {}),
    mode: v.mode,
    ...(v.videoSource ? { videoSource: v.videoSource } : {}),
    sourceId: v.mode === 'video' ? v.sourceId : '',
    systemAudio: v.systemAudio,
    microphone: v.microphone,
    microphoneId: v.microphoneId,
    ...(v.systemAudioId ? { systemAudioId: v.systemAudioId } : {}),
    ...(v.audioBitrate ? { audioBitrate: v.audioBitrate } : {}),
    ...(v.videoBitrate ? { videoBitrate: v.videoBitrate } : {}),
    ...(v.videoEncoder ? { videoEncoder: v.videoEncoder } : {}),
    ...(v.cursor !== undefined ? { cursor: v.cursor } : {}),
    ...(v.delay ? { delay: v.delay } : {}),
    ...(v.input ? { input: inputStyle(v.input) } : {}),
    ...(v.camera !== undefined ? { camera: cameraOptions(v.camera) } : {}),
    fps: v.fps,
    maxWidth: v.maxWidth,
    ...(v.regionToken ? { regionToken: v.regionToken } : {}),
  };
}
export function recordingMime(
  mode: 'video' | 'audio',
  audio: boolean,
  container: RecordingContainer = 'mp4',
) {
  if (container === 'wav') return 'audio/wav';
  if (container === 'webm')
    return mode === 'audio'
      ? 'audio/webm;codecs=opus'
      : 'video/webm;codecs=vp9' + (audio ? ',opus' : '');
  return mode === 'audio'
    ? 'audio/mp4;codecs=mp4a.40.2'
    : 'video/mp4;codecs=avc1.42001E' + (audio ? ',mp4a.40.2' : '');
}
export function validRecordingMime(mime: unknown, options: RecordingOptions): mime is string {
  if (options.container === 'wav') return options.mode === 'audio' && mime === 'audio/wav';
  if (options.container === 'webm')
    return (
      typeof mime === 'string' &&
      (options.mode === 'audio'
        ? /^audio\/webm;codecs=opus$/i
        : /^video\/webm;codecs=vp[89](?:,opus)?$/i
      ).test(mime) &&
      (options.mode === 'audio' ||
        (options.systemAudio || options.microphone) === mime.toLowerCase().includes('opus'))
    );
  return (
    typeof mime === 'string' &&
    (options.mode === 'audio'
      ? /^audio\/mp4;codecs=mp4a\.40\.2$/i
      : /^video\/mp4;codecs=avc1\.[0-9a-f]{6}(?:,mp4a\.40\.2)?$/i
    ).test(mime) &&
    (options.mode === 'audio' ||
      (options.systemAudio || options.microphone) === mime.toLowerCase().includes('mp4a.40.2'))
  );
}
export function recordingRange(
  header: string | null,
  size: number,
): { start: number; end: number; partial: boolean } {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(tr('录制内容为空'));
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error(tr('无效媒体范围'));
  let start = Number(match[1]),
    end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) {
    if (end < 1) throw new Error(tr('无效媒体范围'));
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new Error(tr('无效媒体范围'));
  return { start, end: Math.min(size - 1, end), partial: true };
}

export function recordingExtension(options: RecordingOptions) {
  return options.container === 'wav'
    ? 'wav'
    : options.container === 'webm'
      ? 'webm'
      : options.mode === 'audio'
        ? 'm4a'
        : 'mp4';
}
export function recordingContentType(options: RecordingOptions) {
  return options.container === 'wav'
    ? 'audio/wav'
    : (options.mode === 'audio' ? 'audio/' : 'video/') +
        (options.container === 'webm' ? 'webm' : 'mp4');
}
