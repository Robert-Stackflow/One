import type { Rectangle } from '../../shared/capture/region';

/** Pixels and layout belong to this acquisition, never to a live HWND. */
export interface CaptureSnapshot {
  readonly composition?: 'windows' | 'desktop';
  readonly layers?: readonly Readonly<{
    png: Buffer; name: string; x: number; y: number; width: number; height: number;
  }>[];
  readonly size: Readonly<{ width: number; height: number }>;
  readonly displayId: number;
  readonly sourceId: string;
  readonly signature: string;
  readonly name: string;
  readonly physical?: Readonly<Rectangle>;
  readonly pinPhysical?: Readonly<Rectangle>;
  readonly png: Buffer;
  readonly capturedAt: number;
}

/** Transfer newly acquired buffers; metadata is copied and frozen. Buffers are read-only by ownership. */
export function freezeCaptureSnapshot(value: CaptureSnapshot): CaptureSnapshot {
  return Object.freeze({
    ...value,
    size: Object.freeze({ ...value.size }),
    physical: value.physical && Object.freeze({ ...value.physical }),
    pinPhysical: value.pinPhysical && Object.freeze({ ...value.pinPhysical }),
    layers: value.layers && Object.freeze(value.layers.map(layer => Object.freeze({ ...layer }))),
  });
}

/** Retain annotations only when every layer still maps to the same image coordinates. */
export function checkSnapshotRefresh(old: CaptureSnapshot, next: CaptureSnapshot) {
  if (old.sourceId !== next.sourceId || old.composition !== next.composition)
    throw Error('截图来源已改变，已保留原快照，请重新截图');
  const changed = old.size.width !== next.size.width || old.size.height !== next.size.height ||
    old.layers?.length !== next.layers?.length || old.layers?.some((layer, index) => {
      const other = next.layers![index];
      return ['x', 'y', 'width', 'height'].some(key =>
        layer[key as keyof Rectangle] !== other[key as keyof Rectangle]);
    });
  if (changed)
    throw Error('新画面的尺寸或图层布局已改变，已保留原快照和标注；请结束当前截图后重新采集');
}
