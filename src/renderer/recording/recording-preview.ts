import type { RecordingPlayerAPI, PlaybackSettings } from '../../shared/recording/recording-playback';
import type { RecordingState } from '../../shared/recording/recording';
import { AnnotationReplay, type AnnotationEvent } from '../../shared/recording/recording-annotations';
import { type CameraStyle, type CameraLayout } from '../../shared/recording/recording-camera';
import { inputEnabled, type InputStyle, type RecordingInput } from '../../shared/recording/recording-input';
import { cameraSettings } from './recording-camera-settings';
import { inputSettings } from './recording-input-settings';
import { recordingCursor, type RecordingCursor } from '../../shared/recording/recording-cursor';
import { RecordingCompositor, type RecordingLayer } from './recording-compositor';
import { recordingOverlayControls } from './recording-overlay-controls';
export function recordingPreview(
  api: RecordingPlayerAPI,
  error: (e: unknown) => void,
  settings: () => PlaybackSettings,
  edit: (patch: Partial<PlaybackSettings>) => void,
) {
  const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let state: RecordingState | undefined,
    cameraOverride: CameraStyle | undefined,
    cameraEvents: CameraLayout[] = [],
    cameraToken = '',
    previewInput: InputStyle | undefined,
    previewEvents: RecordingInput[] = [],
    inputToken = '',
    inputFrame = 0;
  let annotationToken = '',
    annotationReplay = new AnnotationReplay([]);
  let cursorToken = '',
    cursor: RecordingCursor | undefined;
  const compositor = new RecordingCompositor({
    width: 1,
    height: 1,
    seconds: 0,
    annotations: [],
    inputs: [],
    layouts: [],
  });
  const overlays = recordingOverlayControls(
    document.querySelector('.media-stage')!,
    q<HTMLVideoElement>('preview'),
    () => ({ state, layouts: cameraEvents, inputs: previewEvents }),
    settings,
    (patch) => {
      if (patch.camera) {
        cameraOverride = patch.camera;
        cameraPreviewControls(patch.camera);
      }
      if (patch.input) {
        previewInput = patch.input;
        inputPreviewControls(patch.input);
      }
      edit(patch);
    },
    invalidateInputPreview,
  );
  async function loadCursor(next: RecordingState) {
    if (cursorToken === next.token) return;
    cursorToken = next.token;
    cursor = undefined;
    compositor.setCursor();
    if (!next.cursorCount || !next.video) {
      invalidateInputPreview();
      return;
    }
    try {
      const shapes = await api.cursorShapes(next.token),
        events: RecordingCursor['events'] = [];
      while (cursorToken === next.token) {
        const page = await api.cursorEvents(next.token, events.length);
        if (cursorToken !== next.token) return;
        if (!page.length) break;
        events.push(...page);
      }
      if (cursorToken !== next.token) return;
      cursor = recordingCursor(
        { shapes, events },
        next.video.width,
        next.video.height,
        Math.round(next.seconds * 48000),
      );
      compositor.setCursor(cursor);
      invalidateInputPreview();
    } catch (e) {
      if (cursorToken === next.token) error(e);
    }
  }
  q('annotation-show').onchange = () => {
    edit({ annotations: q<HTMLInputElement>('annotation-show').checked });
    invalidateInputPreview();
  };
  async function loadAnnotations(next: RecordingState) {
    if (annotationToken === next.token) return;
    annotationToken = next.token;
    annotationReplay = new AnnotationReplay([]);
    compositor.setAnnotations([]);
    q('annotation-preview-settings').hidden = !next.annotationCount;
    q<HTMLInputElement>('annotation-show').checked = settings().annotations;
    if (!next.annotationCount) return;
    const events: AnnotationEvent[] = [];
    try {
      while (annotationToken === next.token) {
        const page = await api.annotationEvents(next.token, events.length);
        if (annotationToken !== next.token) return;
        events.push(...page);
        if (!page.length) break;
      }
      annotationReplay = new AnnotationReplay(events);
      compositor.setAnnotations(events);
      invalidateInputPreview();
    } catch (e) {
      if (annotationToken === next.token) error(e);
    }
  }
  function cameraPreviewControls(style: CameraStyle) {
    cameraSettings(q('camera-preview-controls'), 'replay-camera', style, (value) => {
      cameraOverride = value;
      edit({ camera: value });
      invalidateInputPreview();
    });
  }
  q('camera-replay-reset').onclick = () => {
    cameraOverride = undefined;
    edit({ camera: undefined });
    if (state?.options?.camera) cameraPreviewControls(state.options.camera.style);
    invalidateInputPreview();
  };
  async function loadCamera(next: RecordingState) {
    if (cameraToken === next.token) return;
    cameraToken = next.token;
    cameraEvents = [];
    cameraOverride = settings().camera;
    q('camera-preview-settings').hidden = !next.cameraUrl;
    const camera = q<HTMLVideoElement>('camera-video');
    if (!next.cameraUrl) {
      camera.pause();
      camera.removeAttribute('src');
      camera.load();
      return;
    }
    camera.src = next.cameraUrl;
    cameraPreviewControls(settings().camera || next.options!.camera!.style);
    try {
      const events = await api.cameraLayouts(next.token);
      if (cameraToken === next.token) {
        cameraEvents = events;
        syncCamera();
        invalidateInputPreview();
      }
    } catch (e) {
      if (cameraToken === next.token) error(e);
    }
  }
  function syncCamera() {
    const master = q<HTMLVideoElement>('preview'),
      camera = q<HTMLVideoElement>('camera-video');
    if (!camera.getAttribute('src')) return;
    camera.playbackRate = master.playbackRate;
    const position = Math.min(master.currentTime, Math.max(0, (state?.cameraSeconds || 0) - 0.001));
    if (
      camera.readyState &&
      Math.abs(camera.currentTime - position) > (master.paused || master.seeking ? 0.001 : 0.12)
    )
      camera.currentTime = position;
    if (master.paused || master.seeking || master.ended) camera.pause();
    else if (camera.paused) void camera.play().catch(() => {});
  }
  for (const event of ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'timeupdate', 'ended'])
    q('preview').addEventListener(event, syncCamera);
  for (const event of ['loadeddata', 'seeked', 'timeupdate'])
    q('camera-video').addEventListener(event, () => {
      if (event !== 'timeupdate') syncCamera();
      invalidateInputPreview();
    });
  q<HTMLVideoElement>('camera-video').onerror = () => {
    if (state?.cameraUrl) error('无法播放摄像头轨道，原始素材仍已保留。');
  };
  async function loadInput(next: RecordingState) {
    if (inputToken === next.token) return;
    inputToken = next.token;
    previewEvents = [];
    previewInput = undefined;
    const recorded = next.recordedInput || next.options?.input;
    q('input-preview-settings').hidden = !inputEnabled(recorded);
    if (!inputEnabled(recorded) || !next.token) return;
    const token = next.token;
    previewInput = { ...(settings().input || recorded!) };
    inputPreviewControls(previewInput);
    try {
      while (inputToken === token) {
        const page = await api.inputEvents(token, previewEvents.length);
        if (inputToken !== token) return;
        previewEvents.push(...page);
        invalidateInputPreview();
        if (page.length < 512) break;
      }
    } catch (e) {
      if (inputToken === token) error(e);
    }
  }
  function inputPreviewControls(style: InputStyle) {
    inputSettings(
      q('input-preview-controls'),
      'replay-input',
      style,
      (value) => {
        previewInput = value;
        edit({ input: value });
        invalidateInputPreview();
      },
      state?.recordedInput || state?.options?.input,
    );
  }
  function drawInputPreview() {
    const video = q<HTMLVideoElement>('preview');
    const width = Math.max(1, Math.round(video.clientWidth * devicePixelRatio)),
      height = Math.max(1, Math.round(video.clientHeight * devicePixelRatio));
    compositor.tracks.width = video.videoWidth || 1;
    compositor.tracks.height = video.videoHeight || 1;
    compositor.tracks.seconds = state?.seconds || 0;
    compositor.tracks.inputs = previewEvents;
    compositor.tracks.input = previewInput;
    compositor.tracks.layouts = cameraEvents;
    compositor.tracks.camera = state?.camera;
    compositor.tracks.cameraSeconds = state?.cameraSeconds;
    compositor.tracks.cameraStyle = state?.options?.camera?.style || state?.cameraStyle;
    const camera = q<HTMLVideoElement>('camera-video');
    for (const [id, layer] of [
      ['annotation-preview', 'annotations'],
      ['camera-preview', 'camera'],
      ['input-preview', 'input'],
      ['time-preview', 'time'],
      ['cursor-preview', 'cursor'],
      ['cursor-inverse', 'inverse'],
    ] as [string, RecordingLayer][]) {
      const canvas = q<HTMLCanvasElement>(id);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, width, height);
      if (!video.videoWidth || q('result').hidden) continue;
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      ctx.save();
      ctx.translate(
        (width - video.videoWidth * scale) / 2,
        (height - video.videoHeight * scale) / 2,
      );
      ctx.scale(scale, scale);
      compositor.paintLayer(
        ctx,
        layer,
        video.currentTime,
        overlays.settings(),
        camera.readyState >= 2
          ? { source: camera, width: camera.videoWidth, height: camera.videoHeight }
          : undefined,
        video,
      );
      ctx.restore();
    }
    overlays.update();
  }
  function animateInputPreview() {
    inputFrame = 0;
    drawInputPreview();
    if (
      (previewInput ||
        state?.camera ||
        annotationReplay.events.length ||
        cursor ||
        settings().time.visible) &&
      !q('result').hidden &&
      !q<HTMLVideoElement>('preview').paused
    )
      inputFrame = requestAnimationFrame(animateInputPreview);
  }
  function invalidateInputPreview() {
    drawInputPreview();
    if (
      (previewInput ||
        state?.camera ||
        annotationReplay.events.length ||
        cursor ||
        settings().time.visible) &&
      !inputFrame &&
      !q<HTMLVideoElement>('preview').paused
    )
      inputFrame = requestAnimationFrame(animateInputPreview);
  }
  for (const event of ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata', 'resize'])
    q('preview').addEventListener(event, invalidateInputPreview);
  new ResizeObserver(invalidateInputPreview).observe(q('preview'));
  return {
    update(next: RecordingState) {
      state = next;
      if (!next.url) return;
      const video = q<HTMLVideoElement>('preview');
      if (video.getAttribute('src') !== next.url) video.src = next.url;
      void loadAnnotations(next);
      void loadInput(next);
      void loadCamera(next);
      void loadCursor(next);
    },
    redraw: invalidateInputPreview,
  };
}
