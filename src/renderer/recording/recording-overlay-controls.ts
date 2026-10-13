import { cameraAt, cameraBox, type CameraLayout } from '../../shared/recording/recording-camera';
import type { RecordingState } from '../../shared/recording/recording';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import { recordingTimeBox } from './recording-time';
import { recordingInputBox } from './recording-input';
import type { RecordingInput, InputStyle } from '../../shared/recording/recording-input';

/** Hit areas use the same video coordinates as the exported compositor. */
export function recordingOverlayControls(
  stage: HTMLElement,
  video: HTMLVideoElement,
  context: () => { state?: RecordingState; layouts: CameraLayout[]; inputs: RecordingInput[] },
  read: () => PlaybackSettings,
  commit: (patch: Partial<PlaybackSettings>) => void,
  redraw: () => void,
) {
  type Kind = 'camera' | 'time' | 'input';
  const measure = document.createElement('canvas').getContext('2d')!;
  let draft: Partial<PlaybackSettings> | undefined;
  const settings = () => ({ ...read(), ...draft });
  function layout(kind: Kind) {
    const { state, layouts, inputs } = context(),
      current = settings(),
      size = state?.video;
    if (!size || !video.videoWidth) return;
    if (kind === 'input') {
      const style = current.input || state.recordedInput || state.options?.input;
      if (!style) return;
      const box = recordingInputBox(
        measure,
        inputs,
        Math.round(video.currentTime * 48000),
        style,
        size.width,
        size.height,
      );
      if (!box) return;
      return { size, style, box };
    }
    if (kind === 'time') {
      if (!current.time.visible) return;
      return {
        size,
        style: current.time,
        box: recordingTimeBox(
          measure,
          size.width,
          size.height,
          video.currentTime,
          state.seconds,
          current.time,
        ),
      };
    }
    const fallback = state.options?.camera?.style || state.cameraStyle;
    if (
      !state.camera ||
      !state.cameraUrl ||
      !fallback ||
      video.currentTime >= (state.cameraSeconds || 0)
    )
      return;
    const style =
      current.camera || cameraAt(layouts, Math.round(video.currentTime * 48000), fallback);
    if (!style.visible) return;
    return { size, style, box: cameraBox(style, state.camera, size) };
  }
  let selected: Kind | undefined;
  const targets = (['camera', 'time', 'input'] as const).map((kind) => {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'overlay-drag-target';
    target.dataset.overlay = kind;
    target.hidden = true;
    target.ariaLabel = {
      camera: '移动摄像头画中画',
      time: '移动时间与进度叠层',
      input: '移动键鼠回显',
    }[kind];
    target.title = target.ariaLabel + ' · 拖动移动，边框手柄缩放，Alt＋方向键缩放';
    for (const corner of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handle = document.createElement('span');
      handle.className = 'overlay-resize-handle';
      handle.dataset.handle = corner;
      handle.ariaHidden = 'true';
      target.append(handle);
    }
    stage.append(target);
    let gesture:
      | {
          id: number;
          x: number;
          y: number;
          handle: string;
          layout: NonNullable<ReturnType<typeof layout>>;
        }
      | undefined;
    function patch(
      x: number,
      y: number,
      info: NonNullable<ReturnType<typeof layout>>,
    ): Partial<PlaybackSettings> {
      const left = Math.max(0, Math.min(x, info.size.width - info.box.width)) / info.size.width,
        top = Math.max(0, Math.min(y, info.size.height - info.box.height)) / info.size.height;
      return kind === 'camera'
        ? { camera: { ...info.style, x: left, y: top } as PlaybackSettings['camera'] }
        : kind === 'input'
          ? { input: { ...info.style, position: 'custom', x: left, y: top } as InputStyle }
          : {
              time: {
                ...info.style,
                position: 'custom',
                x: left,
                y: top,
              } as PlaybackSettings['time'],
            };
    }
    function resized(
      info: NonNullable<ReturnType<typeof layout>>,
      ratio: number,
      handle: string,
    ): Partial<PlaybackSettings> {
      const { box, size } = info;
      const lower =
          kind === 'camera'
            ? 0.1 / (info.style as NonNullable<PlaybackSettings['camera']>).width
            : (kind === 'time' ? 12 : 16) / (info.style as { size: number }).size,
        upper =
          kind === 'camera'
            ? 0.6 / (info.style as NonNullable<PlaybackSettings['camera']>).width
            : (kind === 'time' ? 64 : 96) / (info.style as { size: number }).size;
      const availableX = handle.includes('w') ? box.x + box.width : size.width - box.x,
        availableY = handle.includes('n') ? box.y + box.height : size.height - box.y;
      ratio = Math.max(
        lower,
        Math.min(ratio, upper, availableX / box.width, availableY / box.height),
      );
      const x = handle.includes('w') ? box.x + box.width * (1 - ratio) : box.x,
        y = handle.includes('n') ? box.y + box.height * (1 - ratio) : box.y,
        position = { x: Math.max(0, x) / size.width, y: Math.max(0, y) / size.height };
      if (kind === 'camera')
        return {
          camera: {
            ...info.style,
            ...position,
            width: (info.style as NonNullable<PlaybackSettings['camera']>).width * ratio,
          } as PlaybackSettings['camera'],
        };
      if (kind === 'input')
        return {
          input: {
            ...info.style,
            ...position,
            position: 'custom',
            size: (info.style as InputStyle).size * ratio,
          } as InputStyle,
        };
      const time = info.style as PlaybackSettings['time'];
      return {
        time: {
          ...time,
          ...position,
          position: 'custom',
          size: time.size * ratio,
          width: Math.max(0.08, Math.min(0.9, time.width * ratio)),
        },
      };
    }
    target.onpointerdown = (event) => {
      if (event.button !== 0 || gesture) return;
      const info = layout(kind);
      if (!info) return;
      event.preventDefault();
      video.pause();
      selected = kind;
      target.focus({ preventScroll: true });
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        handle: (event.target as HTMLElement).dataset.handle || 'move',
        layout: info,
      };
      target.setPointerCapture(event.pointerId);
      target.dataset.dragging = '';
      redraw();
    };
    // Follow the gesture outside the handle, including an offscreen preview
    // where Chromium may release capture before the next input event.
    window.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const { box, size } = gesture.layout,
        bounds = stage.getBoundingClientRect();
      const dx = ((event.clientX - gesture.x) * size.width) / bounds.width,
        dy = ((event.clientY - gesture.y) * size.height) / bounds.height,
        h = gesture.handle;
      if (h === 'move') draft = patch(box.x + dx, box.y + dy, gesture.layout);
      else {
        const horizontal = h.includes('e') || h.includes('w'),
          vertical = h.includes('n') || h.includes('s'),
          changeX = dx * (h.includes('w') ? -1 : 1),
          changeY = dy * (h.includes('n') ? -1 : 1),
          ratio =
            horizontal && vertical
              ? 1 +
                (box.width * changeX + box.height * changeY) / (box.width ** 2 + box.height ** 2)
              : horizontal
                ? 1 + changeX / box.width
                : 1 + changeY / box.height;
        draft = resized(gesture.layout, ratio, h);
      }
      redraw();
    });
    function finish(event: PointerEvent, cancelled: boolean) {
      if (!gesture || gesture.id !== event.pointerId) return;
      const change = draft;
      gesture = undefined;
      draft = undefined;
      delete target.dataset.dragging;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      if (!cancelled && change) commit(change);
      redraw();
    }
    window.addEventListener('pointerup', (event) => finish(event, false));
    window.addEventListener('pointercancel', (event) => finish(event, true));
    target.onlostpointercapture = (event) => finish(event, true);
    target.onkeydown = (event) => {
      if (event.key === 'Escape' && gesture) {
        finish(new PointerEvent('pointercancel', { pointerId: gesture.id }), true);
        event.stopPropagation();
      }
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = delta[event.key],
        info = layout(kind);
      if (!direction || !info || gesture) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      selected = kind;
      commit(
        event.altKey
          ? resized(info, 1 + ((direction[0] - direction[1]) * step) / 100, 'se')
          : patch(info.box.x + direction[0] * step, info.box.y + direction[1] * step, info),
      );
      redraw();
    };
    return { kind, target };
  });
  stage.addEventListener('pointerdown', (event) => {
    if (!(event.target as Element).closest('.overlay-drag-target')) {
      selected = undefined;
      redraw();
    }
  });
  return {
    settings,
    update() {
      for (const { kind, target } of targets) {
        const info = layout(kind);
        target.hidden = !info;
        target.toggleAttribute('data-selected', selected === kind);
        if (!info) continue;
        Object.assign(target.style, {
          left: (info.box.x / info.size.width) * 100 + '%',
          top: (info.box.y / info.size.height) * 100 + '%',
          width: (info.box.width / info.size.width) * 100 + '%',
          height: (info.box.height / info.size.height) * 100 + '%',
        });
      }
    },
  };
}
