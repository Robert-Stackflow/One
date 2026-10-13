import {
  AnnotationReplay,
  emptyAnnotationScene,
  type AnnotationEvent,
} from '../../shared/recording/recording-annotations';
import {
  cameraAt,
  cameraBox,
  type CameraLayout,
  type CameraStyle,
} from '../../shared/recording/recording-camera';
import type { VideoReady } from '../../shared/recording/native-video';
import type { RecordingInput, InputStyle } from '../../shared/recording/recording-input';
import type { RecordingProject } from '../../shared/recording/recording-project';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import { defaultCursorStyle, type RecordingCursor } from '../../shared/recording/recording-cursor';
import { paintAnnotations } from '../editor/capture-paint';
import { drawCamera } from './recording-camera';
import { paintRecordingInput } from './recording-input';
import { cursorImages, paintRecordingCursor } from './recording-cursor';
import { drawRecordingTime } from './recording-time';
import type { GifOutput } from '../../shared/recording/recording-gif';

export const RECORDING_LAYERS = [
  'annotations',
  'camera',
  'input',
  'time',
  'cursor',
  'inverse',
] as const;
export type RecordingLayer = (typeof RECORDING_LAYERS)[number];
export interface RecordingVisualTracks {
  width: number;
  height: number;
  seconds: number;
  cursor?: RecordingCursor;
  annotations: AnnotationEvent[];
  inputs: RecordingInput[];
  input?: InputStyle;
  layouts: CameraLayout[];
  camera?: VideoReady;
  cameraSeconds?: number;
  cameraStyle?: CameraStyle;
}
/** The preview and every export render the same layers in the same encoded-pixel coordinate system. */
export class RecordingCompositor {
  private replay: AnnotationReplay;
  private cursorData?: RecordingCursor;
  private images = cursorImages([]);
  private layerCanvas = document.createElement('canvas');
  constructor(readonly tracks: RecordingVisualTracks) {
    this.replay = new AnnotationReplay(tracks.annotations);
    this.setCursor(tracks.cursor);
  }
  static project(project: RecordingProject) {
    if (!project.video) throw Error('当前工程没有可合成的视频');
    return new RecordingCompositor({
      width: project.video.width,
      height: project.video.height,
      seconds: project.seconds,
      cursor: project.cursor,
      annotations: project.annotations,
      inputs: project.inputs,
      input: project.recordedInput || project.options.input,
      layouts: project.layouts,
      camera: project.camera,
      cameraSeconds: project.cameraSeconds,
      cameraStyle: project.options.camera?.style || project.cameraStyle,
    });
  }
  setCursor(data?: RecordingCursor) {
    this.cursorData = data;
    this.images = cursorImages(data?.shapes || []);
  }
  setAnnotations(events: AnnotationEvent[]) {
    this.tracks.annotations = events;
    this.replay = new AnnotationReplay(events);
  }
  paintLayer(
    ctx: CanvasRenderingContext2D,
    layer: RecordingLayer,
    seconds: number,
    settings: PlaybackSettings,
    camera?: { source: CanvasImageSource; width: number; height: number },
    source?: CanvasImageSource,
  ) {
    const t = this.tracks,
      sample = Math.round(seconds * 48000);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, t.width, t.height);
    ctx.clip();
    if (layer === 'annotations' && settings.annotations) {
      const scene = emptyAnnotationScene(t.width, t.height);
      scene.annotations = this.replay.at(sample);
      paintAnnotations(ctx, scene, undefined, source);
    } else if (
      layer === 'camera' &&
      t.camera &&
      t.cameraStyle &&
      camera &&
      seconds < (t.cameraSeconds || 0)
    ) {
      const style = settings.camera || cameraAt(t.layouts, sample, t.cameraStyle);
      drawCamera(
        ctx,
        camera.source,
        style,
        cameraBox(style, t.camera, t),
        camera.width,
        camera.height,
      );
    } else if (layer === 'input' && (settings.input || t.input)) {
      paintRecordingInput(ctx, t.inputs, sample, (settings.input || t.input)!, t.width, t.height);
    } else if (layer === 'time') {
      drawRecordingTime(ctx, t.width, t.height, seconds, t.seconds, settings.time);
    } else if ((layer === 'cursor' || layer === 'inverse') && this.cursorData) {
      paintRecordingCursor(
        ctx,
        this.cursorData,
        seconds * 48000,
        settings.cursor || defaultCursorStyle(),
        this.images,
        layer === 'inverse',
      );
    }
    ctx.restore();
  }
  render(
    canvas: HTMLCanvasElement,
    source: CanvasImageSource,
    seconds: number,
    settings: PlaybackSettings,
    camera?: { source: CanvasImageSource; width: number; height: number },
    output?: GifOutput,
  ) {
    const ctx = canvas.getContext('2d')!;
    const layerCanvas = this.layerCanvas;
    if (layerCanvas.width !== canvas.width || layerCanvas.height !== canvas.height) {
      layerCanvas.width = canvas.width;
      layerCanvas.height = canvas.height;
    }
    const layerContext = layerCanvas.getContext('2d')!;
    ctx.save();
    ctx.resetTransform();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const crop = output?.crop || {
      x: 0,
      y: 0,
      width: this.tracks.width,
      height: this.tracks.height,
    };
    if (output?.crop)
      ctx.drawImage(
        source,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    else ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const layer of RECORDING_LAYERS) {
      layerContext.clearRect(0, 0, canvas.width, canvas.height);
      layerContext.save();
      layerContext.scale(canvas.width / crop.width, canvas.height / crop.height);
      layerContext.translate(-crop.x, -crop.y);
      this.paintLayer(layerContext, layer, seconds, settings, camera, source);
      layerContext.restore();
      ctx.globalCompositeOperation = layer === 'inverse' ? 'difference' : 'source-over';
      ctx.drawImage(layerCanvas, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const text of [output?.caption, output?.watermark]) {
      if (!text?.text) continue;
      ctx.save();
      const size = Math.min(text.size, Math.max(8, canvas.height / 4)),
        padding = Math.min(12, canvas.width / 20, canvas.height / 20);
      ctx.font = `600 ${size}px "Microsoft YaHei UI", sans-serif`;
      ctx.textBaseline = text.position.startsWith('top') ? 'top' : 'bottom';
      ctx.textAlign = text.position.endsWith('left')
        ? 'left'
        : text.position.endsWith('right')
          ? 'right'
          : 'center';
      const x =
          ctx.textAlign === 'left'
            ? padding
            : ctx.textAlign === 'right'
              ? canvas.width - padding
              : canvas.width / 2,
        y = ctx.textBaseline === 'top' ? padding : canvas.height - padding;
      ctx.globalAlpha = text.opacity;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, size / 8);
      ctx.lineJoin = 'round';
      ctx.strokeText(text.text, x, y, canvas.width - padding * 2);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, x, y, canvas.width - padding * 2);
      ctx.restore();
    }
    ctx.restore();
  }
}
