import type { Rectangle } from '../../shared/capture/region';
import { captureLayerLayout, CAPTURE_DISPLAYS } from '../../shared/capture/capture-layout';
import { IMAGE_BYTES } from '../../shared/capture/image-limits';
export interface DesktopMonitor {
  id: number;
  name: string;
  signature: string;
  bounds: Rectangle;
}
export interface DesktopFrameSource {
  list(): DesktopMonitor[];
  create(bounds: Rectangle): { frame(fresh: boolean): Promise<Buffer>; stop(): void };
}
export function desktopSignature(monitors: DesktopMonitor[]) {
  if (
    !monitors.length ||
    monitors.length > CAPTURE_DISPLAYS ||
    monitors.some((m) => !Number.isSafeInteger(m.id) || typeof m.signature !== 'string') ||
    new Set(monitors.map((m) => m.id)).size !== monitors.length
  )
    throw Error('显示器列表无效');
  captureLayerLayout(monitors.map((m) => m.bounds));
  return JSON.stringify(
    [...monitors]
      .sort((a, b) => a.id - b.id)
      .map((m) => [m.id, m.signature, m.bounds.x, m.bounds.y, m.bounds.width, m.bounds.height]),
  );
}
/** A complete desktop snapshot, or no replacement at all when any monitor changes. */
export async function captureDesktopFrames(source: DesktopFrameSource, signal: AbortSignal) {
  signal.throwIfAborted();
  const monitors = [...source.list()].sort((a, b) => a.id - b.id),
    signature = desktopSignature(monitors),
    layout = captureLayerLayout(monitors.map((m) => m.bounds));
  let active: ReturnType<DesktopFrameSource['create']> | undefined,
    bytes = 0;
  const stop = () => active?.stop();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const layers = [];
    for (let i = 0; i < monitors.length; i++) {
      signal.throwIfAborted();
      try {
        active = source.create(monitors[i].bounds);
        const png = await active.frame(true);
        signal.throwIfAborted();
        if (
          png.length < 24 ||
          png.readUInt32BE(16) !== monitors[i].bounds.width ||
          png.readUInt32BE(20) !== monitors[i].bounds.height
        )
          throw Error('显示器像素尺寸已改变，请重新截图');
        bytes += png.byteLength;
        if (bytes > IMAGE_BYTES) throw Error('全屏图像总量超过 64 MiB');
        layers.push({ png, name: monitors[i].name, ...layout.layers[i] });
      } finally {
        active?.stop();
        active = undefined;
      }
    }
    if (desktopSignature(source.list()) !== signature) throw Error('显示器配置已改变，请重新截图');
    signal.throwIfAborted();
    return {
      signature,
      physical: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
      layers,
    };
  } finally {
    signal.removeEventListener('abort', stop);
    active?.stop();
  }
}
