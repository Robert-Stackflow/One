/** Media in a saved project can have a different cadence and size from live capture. */
export interface RecordingVideo {
  width: number;
  height: number;
  fps: number;
  encoder: string;
}
export function recordingVideo(value: unknown): RecordingVideo {
  const v = value as RecordingVideo;
  if (
    !v ||
    ![v.width, v.height].every((n) => Number.isSafeInteger(n) && n >= 2 && n <= 8192) ||
    v.width * v.height > 40_000_000 ||
    !Number.isFinite(v.fps) ||
    v.fps <= 0 ||
    v.fps > 120 ||
    typeof v.encoder !== 'string' ||
    !v.encoder ||
    v.encoder.length > 512
  )
    throw Error('视频尺寸或帧率超出支持范围');
  return { width: v.width, height: v.height, fps: v.fps, encoder: v.encoder };
}
