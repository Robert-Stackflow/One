import { playbackSettings, type PlaybackSettings } from './recording-playback';
import { recordingProject, type RecordingProject } from './recording-project';
import { gifSequence, type GifFrame, type GifOutput } from './recording-gif';
export type RecordingExportFormat = 'gif' | 'webp' | 'mp4';
export type RecordingExportQuality = 'light' | 'standard' | 'original';
export interface RecordingExportOptions {
  format: RecordingExportFormat;
  quality: RecordingExportQuality;
  range?: { start: number; end: number };
}
export interface RecordingExportPlan extends RecordingExportOptions {
  timeline?: GifFrame[];
  repeat?: number;
  gifOutput?: GifOutput;
  width: number;
  height: number;
  fps: number;
  frames: number;
  seconds: number;
  speed: number;
  start: number;
  colors: number;
  webpQuality: number;
  crf: number;
  audioBitrate: number;
}
export interface RecordingExportState {
  busy: boolean;
  id: string;
  phase: 'preparing' | 'rendering' | 'encoding' | 'saved' | 'previewed' | 'cancelled' | 'failed';
  progress: number;
  frames: number;
  total: number;
  message: string;
  path?: string;
  bytes?: number;
}
export interface RecordingExportPayload {
  id: string;
  project: RecordingProject;
  plan: RecordingExportPlan;
  video: string;
  camera?: string;
}
export interface GifPreview {
  bytes: Uint8Array;
  width: number;
  height: number;
  colors: number;
  sampleFrames: number;
  totalFrames: number;
  seconds: number;
  estimatedBytes: number;
  complete: boolean;
  optimized: boolean;
}
export function gifPreviewPlan(plan: RecordingExportPlan, complete = false): RecordingExportPlan {
  if (plan.format !== 'gif' || !plan.timeline) throw Error('请先创建 GIF 帧编辑');
  if (complete) return { ...plan, repeat: 0 };
  const count = Math.min(
    plan.frames,
    12,
    Math.max(1, Math.floor(48_000_000 / (plan.width * plan.height))),
  );
  const timeline = Array.from(
    { length: count },
    (_, index) =>
      plan.timeline![
        count === 1
          ? Math.floor((plan.frames - 1) / 2)
          : Math.round((index * (plan.frames - 1)) / (count - 1))
      ],
  );
  return {
    ...plan,
    timeline,
    frames: count,
    seconds: timeline.reduce((sum, frame) => sum + frame.delay / 100, 0),
    repeat: 0,
  };
}
export function gifEstimatedBytes(bytes: number, sample: number, total: number, repeat: number) {
  // Preview loops forever (19-byte application extension). Other frames retain the same encoding.
  return Math.max(1, Math.round(((bytes - 33) * total) / sample + 14 + (repeat >= 0 ? 19 : 0)));
}
export interface RecordingExportRendererAPI {
  payload(): Promise<RecordingExportPayload>;
  frame(id: string, index: number, rgba: Uint8Array): Promise<void>;
  finish(id: string): Promise<void>;
  fail(id: string, message: string): Promise<void>;
}
export function recordingExportOptions(value: unknown): RecordingExportOptions {
  const v = value as RecordingExportOptions;
  if (
    !v ||
    !['gif', 'webp', 'mp4'].includes(v.format) ||
    !['light', 'standard', 'original'].includes(v.quality)
  )
    throw Error('导出格式或质量无效');
  if (
    v.range !== undefined &&
    (!v.range ||
      !Number.isFinite(v.range.start) ||
      !Number.isFinite(v.range.end) ||
      v.range.start < 0 ||
      v.range.end <= v.range.start ||
      v.range.end > 3601)
  )
    throw Error('请选择有效的导出起止时间');
  return {
    format: v.format,
    quality: v.quality,
    ...(v.range ? { range: { start: v.range.start, end: v.range.end } } : {}),
  };
}
export function recordingExportPlan(
  projectValue: unknown,
  optionsValue: unknown,
): RecordingExportPlan {
  const project = recordingProject(projectValue),
    options = recordingExportOptions(optionsValue),
    video = project.video;
  if (!video || project.options.mode !== 'video') throw Error('请先完成视频录制');
  const start = options.range?.start ?? 0,
    end = options.range?.end ?? project.seconds;
  if (end > project.seconds + 1e-8 || start >= project.seconds) throw Error('导出范围超出视频时长');
  const output = options.format === 'gif' ? project.playback.gif?.output : undefined;
  const region = output?.crop || video;
  const cap = options.quality === 'light' ? 960 : options.quality === 'standard' ? 1920 : Infinity,
    scale = output?.width
      ? Math.min(1, output.width / region.width)
      : Math.min(1, cap / region.width, cap / region.height),
    even = options.format === 'mp4' ? 2 : 1,
    width = Math.max(2, Math.floor((region.width * scale) / even) * even),
    height = Math.max(2, Math.floor((region.height * scale) / even) * even),
    fps = Math.min(
      video.fps,
      options.quality === 'light' ? 15 : options.quality === 'standard' ? 30 : Infinity,
    ),
    speed = playbackSettings(project.playback).speed,
    seconds = (end - start) / speed;
  const timeline =
    options.format === 'gif' && project.playback.gif
      ? gifSequence(project.playback.gif, speed)
      : undefined;
  return {
    ...options,
    ...(timeline ? { timeline, repeat: project.playback.gif!.repeat } : {}),
    ...(output ? { gifOutput: output } : {}),
    width,
    height,
    fps,
    speed,
    start,
    seconds: timeline ? timeline.reduce((total, frame) => total + frame.delay / 100, 0) : seconds,
    frames: timeline?.length || Math.ceil(seconds * fps - 1e-8),
    colors:
      output?.colors ||
      (options.quality === 'light' ? 64 : options.quality === 'standard' ? 128 : 256),
    webpQuality: options.quality === 'light' ? 60 : options.quality === 'standard' ? 80 : 100,
    crf: options.quality === 'light' ? 30 : options.quality === 'standard' ? 23 : 18,
    audioBitrate:
      options.quality === 'light' ? 96000 : options.quality === 'standard' ? 160000 : 192000,
  };
}
export function exportAudioFilters(
  settings: PlaybackSettings,
  sources: { kind: 'mixed' | 'system' | 'microphone'; input: number }[],
  seconds?: number,
  start = 0,
) {
  if (!sources.length) return { filter: '', label: undefined };
  const s = playbackSettings(settings),
    filters = sources.map(
      (source, i) =>
        `[${source.input}:a:0]aresample=48000,aformat=channel_layouts=stereo,volume=${source.kind === 'mixed' ? 1 : s[source.kind]}[source${i}]`,
    );
  const labels = sources.map((_, i) => `[source${i}]`).join('');
  const tempo: string[] = [];
  let speed = s.speed;
  while (speed > 2) {
    tempo.push('atempo=2');
    speed /= 2;
  }
  while (speed < 0.5) {
    tempo.push('atempo=0.5');
    speed /= 0.5;
  }
  tempo.push(`atempo=${speed}`);
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 14404))
    throw Error('合成声音时长无效');
  if (!Number.isFinite(start) || start < 0 || start > 3601) throw Error('合成声音起点无效');
  filters.push(
    `${labels}amix=inputs=${sources.length}:duration=longest:normalize=0,pan=stereo|c0=${s.left}*c0|c1=${s.right}*c1,${start ? 'atrim=start=' + start + ',asetpts=PTS-STARTPTS,' : ''}${tempo.join(',')},apad${seconds === undefined ? '' : ',atrim=duration=' + seconds}[audio]`,
  );
  return { filter: filters.join(';'), label: '[audio]' };
}
