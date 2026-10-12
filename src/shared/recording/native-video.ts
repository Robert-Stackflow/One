import type { Rectangle } from '../capture/region';
export interface NativeVideoTarget {
  kind: 'monitor' | 'window' | 'camera';
  handle: number;
  pid: number;
  crop?: Rectangle;
}
export interface VideoReady {
  width: number;
  height: number;
  fps: 15 | 30 | 60;
  encoder: string;
}
export function videoReady(value: unknown): VideoReady {
  const v = value as VideoReady;
  if (
    !v ||
    ![v.width, v.height].every(
      (n) => Number.isSafeInteger(n) && n >= 2 && n <= 2560 && n % 2 === 0,
    ) ||
    ![15, 30, 60].includes(v.fps) ||
    typeof v.encoder !== 'string' ||
    !v.encoder ||
    v.encoder.length > 512
  )
    throw Error('视频编码器响应无效');
  return { width: v.width, height: v.height, fps: v.fps, encoder: v.encoder };
}
