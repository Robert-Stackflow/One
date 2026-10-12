import { captureWindowLayout } from '../../shared/capture/capture-window-layout';
import { imageDimensions, IMAGE_BYTES } from '../../shared/capture/image-limits';
import type { Rectangle } from '../../shared/capture/region';
export interface WindowCaptureChoice {
  hwnd: number;
  pid: number;
  name: string;
}
export interface WindowFrameSource {
  ownPid: number;
  info(hwnd: number): (Rectangle & { hwnd: number; pid: number }) | null;
  create(info: { hwnd: number; pid: number }): {
    frame(fresh: boolean): Promise<Buffer>;
    stop(): void;
  };
}
/** Capture each selected window independently; reject the whole new snapshot if any identity changes. */
export async function captureWindowFrames(
  choices: WindowCaptureChoice[],
  signal: AbortSignal,
  source: WindowFrameSource,
  placements?: { x: number; y: number }[],
) {
  const current = () =>
    choices.map((choice) => {
      const info = source.info(choice.hwnd);
      if (!info || info.pid !== choice.pid || info.pid === source.ownPid)
        throw Error(`窗口“${choice.name}”已关闭或最小化，请返回列表重新选择`);
      return info;
    });
  signal.throwIfAborted();
  const before = current();
  if (placements && placements.length !== before.length) throw Error('窗口布局无效');
  captureWindowLayout(before.map((item, index) => ({ ...item, ...placements?.[index] })));
  let native: ReturnType<WindowFrameSource['create']> | undefined,
    bytes = 0;
  const stop = () => native?.stop();
  signal.addEventListener('abort', stop, { once: true });
  try {
    const layers = [];
    for (let i = 0; i < before.length; i++) {
      signal.throwIfAborted();
      try {
        native = source.create(before[i]);
        const png = await native.frame(true);
        signal.throwIfAborted();
        if (png.byteLength < 24) throw Error('窗口图像不完整');
        const width = png.readUInt32BE(16),
          height = png.readUInt32BE(20);
        imageDimensions(width, height);
        bytes += png.byteLength;
        if (bytes > IMAGE_BYTES) throw Error('所选窗口图像总量超过 64 MiB');
        layers.push({
          png,
          name: choices[i].name,
          x: placements?.[i].x ?? before[i].x,
          y: placements?.[i].y ?? before[i].y,
          width,
          height,
        });
      } finally {
        native?.stop();
        native = undefined;
      }
    }
    signal.throwIfAborted();
    const after = current();
    if (
      before.some((old, i) =>
        ['x', 'y', 'width', 'height'].some(
          (key) => old[key as keyof Rectangle] !== after[i][key as keyof Rectangle],
        ),
      )
    )
      throw Error('窗口位置或尺寸已改变，请保持窗口稳定后重试');
    const layout = captureWindowLayout(layers);
    return {
      width: layout.width,
      height: layout.height,
      layers: layers.map((layer, i) => ({
        ...layer,
        x: layout.layers[i].x,
        y: layout.layers[i].y,
      })),
    };
  } finally {
    signal.removeEventListener('abort', stop);
    native?.stop();
  }
}
