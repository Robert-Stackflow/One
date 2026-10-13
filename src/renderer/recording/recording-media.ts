export function waitMedia(
  video: HTMLVideoElement,
  action: () => void,
  event: 'loadeddata' | 'seeked',
) {
  return new Promise<void>((accept, reject) => {
    const clear = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
    };
    const done = () => {
        clear();
        accept();
      },
      failed = () => {
        clear();
        reject(Error('无法读取视频素材，原片仍已保留'));
      };
    const timer = setTimeout(() => {
      clear();
      reject(Error('视频素材读取超时，请重试'));
    }, 20000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    try {
      action();
    } catch (error) {
      clear();
      reject(error);
    }
  });
}
export async function seekMedia(video: HTMLVideoElement, seconds: number) {
  const target = Math.min(seconds, Math.max(0, video.duration - 0.001));
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.000001) return;
  await waitMedia(
    video,
    () => {
      video.currentTime = target;
    },
    'seeked',
  );
}
