import {
  gifEdit,
  gifFrames,
  gifSequence,
  gifOutput,
  type GifEdit,
  type GifText,
} from '../../shared/recording/recording-gif';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import type { RecordingExportOptions } from '../../shared/recording/recording-export';
import { seekMedia } from './recording-media';

export function recordingGifEditor(host: {
  settings(): PlaybackSettings;
  options(): RecordingExportOptions;
  seconds(): number;
  size(): { width: number; height: number };
  quality(): Promise<void>;
  edit(patch: Partial<PlaybackSettings>): void;
  error(error: unknown): void;
  pause(): void;
  redraw(): void;
}) {
  const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T,
    video = q<HTMLVideoElement>('preview'),
    history: (GifEdit | undefined)[] = [],
    future: (GifEdit | undefined)[] = [];
  let token = '',
    active = 0,
    first = 0,
    last = 0,
    revision = 0,
    playing = false,
    blocked = false;
  let releaseWait: (() => void) | undefined;
  let displayedOutput: string | undefined,
    outputInitialized = false,
    outputDirty = false;
  for (const field of q('gif-output-settings').querySelectorAll('input,select')) {
    const dirty = () => {
      outputDirty = true;
      q('gif-output-pending').hidden = false;
    };
    field.addEventListener('input', dirty);
    field.addEventListener('change', dirty);
  }
  const current = () => host.settings().gif;
  function stop() {
    releaseWait?.();
    releaseWait = undefined;
    revision++;
    playing = false;
    q('gif-preview').textContent = '预览帧序列';
  }
  function save(value: GifEdit | undefined, remember = true) {
    const parsed = value ? gifEdit(value, host.seconds(), host.size()) : undefined;
    stop();
    if (remember) {
      history.push(structuredClone(current()));
      if (history.length > 20) history.shift();
      future.length = 0;
    }
    host.edit({ gif: parsed });
    render();
  }
  async function show(index: number) {
    stop();
    host.pause();
    const frame = current()?.frames[index],
      id = revision;
    if (!frame) return;
    active = index;
    render();
    await seekMedia(video, frame.source);
    if (id === revision) host.redraw();
  }
  function render() {
    const edit = current(),
      count = edit?.frames.length || 0;
    q<HTMLFieldSetElement>('gif-controls').disabled = blocked;
    q('gif-tools').hidden = !edit;
    q<HTMLButtonElement>('gif-undo').disabled = blocked || !history.length;
    q<HTMLButtonElement>('gif-redo').disabled = blocked || !future.length;
    if (!edit) {
      outputInitialized = false;
      q('gif-summary').textContent =
        '从导出片段抽帧后，可删除、重排并调整延时。编辑仅用于 GIF 导出。';
      return;
    }
    if (!outputInitialized || displayedOutput !== JSON.stringify(edit.output)) {
      displayedOutput = JSON.stringify(edit.output);
      outputInitialized = true;
      outputDirty = false;
      q('gif-output-pending').hidden = true;
      const output = edit.output,
        size = host.size(),
        crop = output?.crop || { x: 0, y: 0, ...size };
      q<HTMLInputElement>('gif-width').value = output?.width ? String(output.width) : '';
      q<HTMLSelectElement>('gif-colors').value = output?.colors ? String(output.colors) : '';
      q<HTMLInputElement>('gif-optimize').checked = output?.optimize || false;
      for (const field of ['x', 'y', 'width', 'height'] as const)
        q<HTMLInputElement>('gif-crop-' + field).value = String(crop[field]);
      for (const kind of ['caption', 'watermark'] as const) {
        const text = output?.[kind];
        q<HTMLInputElement>('gif-' + kind + '-text').value = text?.text || '';
        q<HTMLInputElement>('gif-' + kind + '-size').value = String(
          text?.size || (kind === 'caption' ? 24 : 16),
        );
        q<HTMLSelectElement>('gif-' + kind + '-position').value =
          text?.position || (kind === 'caption' ? 'top-center' : 'bottom-right');
        q<HTMLInputElement>('gif-' + kind + '-color').value = text?.color || '#ffffff';
        q<HTMLInputElement>('gif-' + kind + '-opacity').value = String(
          (text?.opacity ?? (kind === 'caption' ? 1 : 0.5)) * 100,
        );
      }
    }
    active = Math.min(active, count - 1);
    first = Math.min(first, count - 1);
    last = Math.max(first, Math.min(last, count - 1));
    const timeline = gifSequence(edit, host.settings().speed);
    q('gif-summary').textContent =
      `${count} 个源帧 · 输出 ${timeline.length} 帧 · ${timeline.reduce((sum, f) => sum + f.delay / 100, 0).toFixed(2)} 秒 · 编辑随工程保存`;
    for (const [id, value] of [
      ['gif-from', first + 1],
      ['gif-to', last + 1],
      ['gif-position', active + 1],
    ] as const) {
      const input = q<HTMLInputElement>(id);
      input.max = String(count);
      input.value = String(value);
    }
    q('gif-current').textContent =
      `第 ${active + 1} / ${count} 帧 · 原片 ${edit.frames[active].source.toFixed(3)} 秒 · ${edit.frames[active].delay * 10} ms`;
    q<HTMLSelectElement>('gif-direction').value = edit.direction;
    q<HTMLInputElement>('gif-repeat').value = String(edit.repeat);
    q<HTMLInputElement>('gif-delay').value = String(edit.frames[first].delay * 10);
    const list = q('gif-frames');
    list.replaceChildren();
    const start = Math.max(0, Math.min(active - 4, count - 9));
    for (let index = start; index < Math.min(count, start + 9); index++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet';
      button.textContent = String(index + 1);
      button.title = `原片 ${edit.frames[index].source.toFixed(3)} 秒 · ${edit.frames[index].delay * 10} ms`;
      button.setAttribute('aria-pressed', String(index >= first && index <= last));
      button.setAttribute('aria-label', `定位第 ${index + 1} 帧`);
      button.onclick = () => {
        first = last = index;
        void show(index).catch(host.error);
      };
      list.append(button);
    }
  }
  function act(id: string, fn: () => void | Promise<void>) {
    q(id).onclick = () => {
      if (!blocked) Promise.resolve().then(fn).catch(host.error);
    };
  }
  act('gif-create', () => {
    const range = host.options().range!;
    const value = gifFrames(range.start, range.end, q<HTMLInputElement>('gif-fps').valueAsNumber);
    if (current()?.output) value.output = structuredClone(current()!.output);
    first = last = active = 0;
    save(value);
    return show(0);
  });
  act('gif-clear', () => save(undefined));
  act('gif-quality', () => {
    if (outputDirty) applyOutput();
    return host.quality();
  });
  function applyOutput() {
    const text = (kind: 'caption' | 'watermark'): GifText => ({
      text: q<HTMLInputElement>('gif-' + kind + '-text').value,
      size: q<HTMLInputElement>('gif-' + kind + '-size').valueAsNumber,
      position: q<HTMLSelectElement>('gif-' + kind + '-position').value as GifText['position'],
      color: q<HTMLInputElement>('gif-' + kind + '-color').value,
      opacity: q<HTMLInputElement>('gif-' + kind + '-opacity').valueAsNumber / 100,
    });
    const crop = {
      x: q<HTMLInputElement>('gif-crop-x').valueAsNumber,
      y: q<HTMLInputElement>('gif-crop-y').valueAsNumber,
      width: q<HTMLInputElement>('gif-crop-width').valueAsNumber,
      height: q<HTMLInputElement>('gif-crop-height').valueAsNumber,
    };
    const colors = q<HTMLSelectElement>('gif-colors').value;
    const output = gifOutput(
      {
        width:
          q<HTMLInputElement>('gif-width').value === ''
            ? undefined
            : q<HTMLInputElement>('gif-width').valueAsNumber,
        colors: colors === '' ? undefined : Number(colors),
        optimize: q<HTMLInputElement>('gif-optimize').checked,
        crop,
        caption: text('caption'),
        watermark: text('watermark'),
      },
      host.size(),
    );
    save({ ...current()!, output });
    outputDirty = false;
    q('gif-output-pending').hidden = true;
  }
  act('gif-apply-output', applyOutput);
  act('gif-reset-output', () => {
    outputInitialized = false;
    save({ ...current()!, output: undefined });
  });
  act('gif-undo', () => {
    if (!history.length) return;
    future.push(structuredClone(current()));
    save(history.pop(), false);
  });
  act('gif-redo', () => {
    if (!future.length) return;
    history.push(structuredClone(current()));
    save(future.pop(), false);
  });
  act('gif-all', () => {
    first = 0;
    last = current()!.frames.length - 1;
    render();
  });
  act('gif-delete', () => {
    const edit = structuredClone(current()!);
    if (last - first + 1 === edit.frames.length)
      throw Error('至少保留一帧；可使用“清除帧编辑”恢复原片导出');
    edit.frames.splice(first, last - first + 1);
    active = first;
    last = first;
    save(edit);
    return show(Math.min(active, edit.frames.length - 1));
  });
  for (const [id, delta] of [
    ['gif-earlier', -1],
    ['gif-later', 1],
  ] as const)
    act(id, () => {
      const edit = structuredClone(current()!);
      if (first + delta < 0 || last + delta >= edit.frames.length) return;
      const selected = edit.frames.splice(first, last - first + 1);
      edit.frames.splice(first + delta, 0, ...selected);
      first += delta;
      last += delta;
      active = first;
      save(edit);
      return show(active);
    });
  act('gif-apply-delay', () => {
    const ms = q<HTMLInputElement>('gif-delay').valueAsNumber;
    if (!Number.isSafeInteger(ms) || ms < 20 || ms > 60000 || ms % 10)
      throw Error('延时须为 20–60000 ms，且为 10 ms 的倍数');
    const edit = structuredClone(current()!);
    for (let index = first; index <= last; index++) edit.frames[index].delay = ms / 10;
    save(edit);
  });
  for (const id of ['gif-from', 'gif-to'])
    q<HTMLInputElement>(id).onchange = () => {
      const a = q<HTMLInputElement>('gif-from').valueAsNumber - 1,
        b = q<HTMLInputElement>('gif-to').valueAsNumber - 1;
      if (
        !Number.isSafeInteger(a) ||
        !Number.isSafeInteger(b) ||
        a < 0 ||
        b < a ||
        b >= current()!.frames.length
      ) {
        host.error(Error('请选择有效的帧范围'));
        render();
        return;
      }
      first = a;
      last = b;
      render();
    };
  q<HTMLInputElement>('gif-position').onchange = () => {
    const index = q<HTMLInputElement>('gif-position').valueAsNumber - 1;
    if (Number.isSafeInteger(index) && index >= 0 && index < current()!.frames.length)
      void show(index).catch(host.error);
  };
  q<HTMLSelectElement>('gif-direction').onchange = () => {
    try {
      save({
        ...current()!,
        direction: q<HTMLSelectElement>('gif-direction').value as GifEdit['direction'],
      });
    } catch (error) {
      host.error(error);
      render();
    }
  };
  q<HTMLInputElement>('gif-repeat').onchange = () => {
    try {
      save({ ...current()!, repeat: q<HTMLInputElement>('gif-repeat').valueAsNumber });
    } catch (error) {
      host.error(error);
      render();
    }
  };
  act('gif-preview', async () => {
    if (playing) {
      stop();
      return;
    }
    host.pause();
    stop();
    playing = true;
    q('gif-preview').textContent = '停止帧预览';
    const id = revision,
      edit = current()!,
      sequence = gifSequence(edit, host.settings().speed);
    const repeats = edit.repeat === 0 ? Infinity : edit.repeat === -1 ? 1 : edit.repeat + 1;
    try {
      for (let cycle = 0; cycle < repeats && id === revision; cycle++)
        for (const frame of sequence) {
          if (id !== revision) return;
          await seekMedia(video, frame.source);
          if (id !== revision) return;
          active = edit.frames.findIndex((source) => source.source === frame.source);
          render();
          host.redraw();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              releaseWait = undefined;
              resolve();
            }, frame.delay * 10);
            releaseWait = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
    } catch (error) {
      if (id === revision) throw error;
    } finally {
      if (id === revision) stop();
    }
  });
  return {
    stop,
    applyPending() {
      if (outputDirty && current()) applyOutput();
    },
    preview() {
      q<HTMLButtonElement>('gif-preview').click();
    },
    update(nextToken: string, disabled: boolean, visible: boolean) {
      if (nextToken !== token) {
        stop();
        token = nextToken;
        first = last = active = 0;
        history.length = future.length = 0;
        outputInitialized = false;
      }
      if (disabled || !visible) stop();
      blocked = disabled;
      q('gif-editor').hidden = !visible;
      render();
    },
  };
}
