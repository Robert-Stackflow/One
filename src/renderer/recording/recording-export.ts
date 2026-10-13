import { waitMedia, seekMedia as seek } from './recording-media';
import type { RecordingExportRendererAPI } from '../../shared/recording/recording-export';
import { RecordingCompositor } from './recording-compositor';
const api = window.one!.recordingExport!;
async function media(url: string) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  document.body.append(video);
  await waitMedia(
    video,
    () => {
      video.src = url;
      video.load();
    },
    'loadeddata',
  );
  return video;
}
async function compose() {
  let id = '';
  try {
    const payload = await api.payload();
    id = payload.id;
    const video = await media(payload.video),
      camera = payload.camera ? await media(payload.camera) : undefined;
    if (
      video.videoWidth !== payload.project.video!.width ||
      video.videoHeight !== payload.project.video!.height
    )
      throw Error('视频尺寸与工程不一致，无法合成');
    const compositor = RecordingCompositor.project(payload.project),
      canvas = document.createElement('canvas');
    canvas.width = payload.plan.width;
    canvas.height = payload.plan.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    await document.fonts.ready;
    for (let index = 0; index < payload.plan.frames; index++) {
      const seconds =
        payload.plan.timeline?.[index].source ??
        Math.min(
          payload.plan.start + (index / payload.plan.fps) * payload.plan.speed,
          payload.plan.start + payload.plan.seconds * payload.plan.speed - 0.000001,
        );
      await seek(video, seconds);
      if (camera && seconds < (payload.project.cameraSeconds || 0)) await seek(camera, seconds);
      compositor.render(
        canvas,
        video,
        seconds,
        payload.project.playback,
        camera
          ? { source: camera, width: camera.videoWidth, height: camera.videoHeight }
          : undefined,
        payload.plan.gifOutput,
      );
      await api.frame(
        id,
        index,
        new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer),
      );
    }
    await api.finish(id);
  } catch (error) {
    if (id) await api.fail(id, (error as Error).message).catch(() => {});
  }
}
void compose();
