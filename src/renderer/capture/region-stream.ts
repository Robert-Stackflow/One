import { t as tr } from '../../shared/capture/i18n';
import { regionVideo, type Region } from '../../shared/capture/region';
export async function cropStream(
  source: MediaStream,
  region: Region,
  maxWidth: number,
  fps: number,
  signal: AbortSignal,
  changed: () => void,
) {
  const video = document.createElement('video'),
    canvas = document.createElement('canvas');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  let timer: ReturnType<typeof setInterval> | undefined,
    stream: MediaStream | undefined,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.pause();
    video.srcObject = null;
    canvas.width = canvas.height = 0;
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (signal.aborted) throw new Error(tr('录制已取消'));
    await video.play();
    if (signal.aborted || disposed) throw new Error(tr('录制已取消'));
    const width = video.videoWidth,
      height = video.videoHeight;
    if (Math.abs(width / height - region.screen.width / region.screen.height) > 0.01)
      throw new Error(tr('显示器画面比例已改变，请重新选区'));
    const { crop, output } = regionVideo(region.rect, width, height, maxWidth);
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext('2d', { alpha: false })!;
    stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const draw = () => {
      if (disposed || signal.aborted) return;
      if (video.videoWidth !== width || video.videoHeight !== height) {
        dispose();
        changed();
        return;
      }
      if (video.readyState >= 2) {
        context.drawImage(
          video,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          output.width,
          output.height,
        );
        track.requestFrame();
      }
    };
    draw();
    timer = setInterval(draw, 1000 / fps);
    return { stream, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}
