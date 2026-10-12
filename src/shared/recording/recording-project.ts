import { RECORDING_PROJECT_FORMAT } from '../media-project';
import { recordingOptions, RECORD_SECONDS, type RecordingOptions } from './recording';
import { RECORDING_AUDIO_SOURCES, type RecordingAudioSource } from './recording';
import { recordingCursor, type RecordingCursor } from './recording-cursor';
import { videoReady, type VideoReady } from './native-video';
import { recordingVideo, type RecordingVideo } from './recording-media';
import { playbackSettings, type PlaybackSettings } from './recording-playback';
import { gifEdit } from './recording-gif';
import {
  recordingInput,
  inputStyle,
  INPUT_EVENTS,
  type RecordingInput,
  type InputStyle,
} from './recording-input';
import { cameraStyle, type CameraStyle, type CameraLayout } from './recording-camera';
import {
  annotationScene,
  emptyAnnotationScene,
  type AnnotationEvent,
} from './recording-annotations';

export const PROJECT_METADATA_BYTES = 64 * 1024 * 1024;
export interface RecordingProject {
  format: typeof RECORDING_PROJECT_FORMAT.id;
  version: 1;
  origin?: 'video';
  cursor?: RecordingCursor;
  sources?: RecordingAudioSource[];
  seconds: number;
  options: RecordingOptions;
  playback: PlaybackSettings;
  video?: RecordingVideo;
  camera?: VideoReady;
  cameraSeconds?: number;
  cameraStyle?: CameraStyle;
  inputStyle?: InputStyle;
  recordedInput?: InputStyle;
  inputs: RecordingInput[];
  annotations: AnnotationEvent[];
  layouts: CameraLayout[];
}
/** Canonical, bounded data only. A project never stores external media paths. */
export function recordingProject(value: unknown): RecordingProject {
  const v = value as RecordingProject;
  if (
    !v ||
    v.format !== RECORDING_PROJECT_FORMAT.id ||
    v.version !== RECORDING_PROJECT_FORMAT.version ||
    (v.origin !== undefined && v.origin !== 'video') ||
    !Number.isFinite(v.seconds) ||
    v.seconds <= 0 ||
    v.seconds > RECORD_SECONDS + 1
  )
    throw Error('录制工程信息无效');
  const options = recordingOptions(v.options),
    video = v.video === undefined ? undefined : recordingVideo(v.video),
    camera = v.camera === undefined ? undefined : videoReady(v.camera),
    sampleLimit = Math.ceil((v.seconds + 1) * 48000);
  if (
    v.sources !== undefined &&
    (!Array.isArray(v.sources) ||
      !v.sources.length ||
      v.sources.length > 2 ||
      v.sources.some(
        (source, i) =>
          !RECORDING_AUDIO_SOURCES.includes(source) ||
          (i > 0 && source !== 'microphone') ||
          v.sources!.indexOf(source) !== i ||
          !(source === 'system' ? options.systemAudio : options.microphone),
      ))
  )
    throw Error('录制工程独立声源无效');
  if (
    (options.mode === 'audio' && (video || camera)) ||
    (camera &&
      (!video ||
        !Number.isFinite(v.cameraSeconds) ||
        v.cameraSeconds! <= 0 ||
        v.cameraSeconds! > v.seconds + 2))
  )
    throw Error('录制工程轨道无效');
  if (v.cursor !== undefined && (!video || options.cursor === false))
    throw Error('录制工程光标轨道无效');
  const timeline = <T>(
    values: unknown,
    limit: number,
    parse: (value: any) => T & { sample: number },
  ) => {
    if (!Array.isArray(values) || values.length > limit) throw Error('录制工程时间轴过大');
    let previous = -1;
    return values.map((value) => {
      const parsed = parse(value);
      if (
        !Number.isSafeInteger(parsed.sample) ||
        parsed.sample < previous ||
        parsed.sample < 0 ||
        parsed.sample > sampleLimit
      )
        throw Error('录制工程时间轴无效');
      previous = parsed.sample;
      return parsed;
    });
  };
  const inputs = timeline<RecordingInput>(v.inputs, INPUT_EVENTS, (value) =>
    recordingInput(value, video?.width || 1, video?.height || 1),
  );
  if (inputs.some((event, i) => event.id !== i + 1) || (!video && inputs.length))
    throw Error('录制工程键鼠事件无效');
  const ids = new Set<string>();
  const annotations = timeline<AnnotationEvent>(v.annotations, 15000, (event) => {
    if (
      !video ||
      !event ||
      !Array.isArray(event.remove) ||
      !Array.isArray(event.order) ||
      !Array.isArray(event.upsert) ||
      event.remove.length > 2000 ||
      event.order.length > 2000
    )
      throw Error('录制工程标注无效');
    const upsert = annotationScene(
      { ...emptyAnnotationScene(video.width, video.height), annotations: event.upsert },
      video.width,
      video.height,
    ).annotations;
    for (const id of event.remove) {
      if (typeof id !== 'string' || !ids.delete(id)) throw Error('录制工程标注引用无效');
    }
    for (const mark of upsert) ids.add(mark.id);
    if (
      event.order.length !== ids.size ||
      new Set(event.order).size !== ids.size ||
      event.order.some((id: unknown) => typeof id !== 'string' || !ids.has(id))
    )
      throw Error('录制工程标注顺序无效');
    return { sample: event.sample, remove: [...event.remove], upsert, order: [...event.order] };
  });
  const layouts = timeline<CameraLayout>(v.layouts, 15000, (value) => {
    if (!camera || !value) throw Error('录制工程摄像头布局无效');
    return { sample: value.sample, style: cameraStyle(value.style) };
  });
  const playback = playbackSettings(v.playback);
  if (playback.gif) {
    if (!video) throw Error('声音工程不能包含 GIF 帧');
    playback.gif = gifEdit(playback.gif, v.seconds, video);
  }
  return {
    format: RECORDING_PROJECT_FORMAT.id,
    version: RECORDING_PROJECT_FORMAT.version,
    ...(v.sources ? { sources: [...v.sources] } : {}),
    ...(v.cursor === undefined
      ? {}
      : {
          cursor: recordingCursor(
            v.cursor,
            video!.width,
            video!.height,
            Math.round(v.seconds * 48000),
          ),
        }),
    ...(v.origin ? { origin: v.origin } : {}),
    seconds: v.seconds,
    options,
    playback,
    ...(video ? { video } : {}),
    ...(camera
      ? { camera, cameraSeconds: v.cameraSeconds, cameraStyle: cameraStyle(v.cameraStyle) }
      : {}),
    ...(v.inputStyle === undefined ? {} : { inputStyle: inputStyle(v.inputStyle) }),
    ...(v.recordedInput === undefined ? {} : { recordedInput: inputStyle(v.recordedInput) }),
    inputs,
    annotations,
    layouts,
  };
}
