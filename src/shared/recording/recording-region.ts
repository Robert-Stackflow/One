import type { Rectangle } from '../capture/region';

export interface RecordingRegionState {
  token: string;
  enabled: boolean;
  crop: Rectangle;
  message: string;
}
export interface RecordingRegionAPI {
  state(): Promise<RecordingRegionState>;
  drag(
    token: string,
    phase: 'start' | 'move' | 'end',
    point: { x: number; y: number },
  ): Promise<void>;
  onChange(callback: () => void): () => void;
}
/** Coordinates and dimensions are physical pixels in one bound capture source. */
export function moveRecordingRegion(
  crop: Rectangle,
  delta: { x: number; y: number },
  source: { width: number; height: number },
): Rectangle {
  if (
    !crop ||
    !delta ||
    !source ||
    ![crop.x, crop.y, crop.width, crop.height, source.width, source.height].every(
      Number.isSafeInteger,
    ) ||
    ![delta.x, delta.y].every(Number.isFinite) ||
    Math.abs(delta.x) > 100000 ||
    Math.abs(delta.y) > 100000 ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 2 ||
    crop.height < 2 ||
    crop.x + crop.width > source.width ||
    crop.y + crop.height > source.height ||
    source.width > 16384 ||
    source.height > 16384
  )
    throw Error('录制区域坐标无效');
  return {
    ...crop,
    x: Math.max(0, Math.min(source.width - crop.width, Math.round(crop.x + delta.x))),
    y: Math.max(0, Math.min(source.height - crop.height, Math.round(crop.y + delta.y))),
  };
}
