import './mosaic-controls.css';
import {
  annotationBounds,
  validateImageDocument,
  type Annotation,
  type ImageDocument,
} from '../../shared/capture/image-document';
import { customControls } from '../controls';

interface Host {
  document(): ImageDocument;
  source(): CanvasImageSource;
  selected(): Annotation | undefined;
  locked(): boolean;
  pending(value: boolean): void;
  preview(value: ImageDocument): void;
  commit(value: ImageDocument): void;
  select(value: Annotation): void;
  choose(): void;
  strength(): number;
  message(value: unknown): void;
}

/** Shared same-content matching, full-selection masking and review lifecycle. */
export function mosaicControls(root: HTMLElement, host: Host) {
  root.classList.add('mosaic-controls');
  root.innerHTML = `<button id="auto-mosaic" type="button" title="先框选一处内容，再识别图像中相同内容">识别同类</button><button id="mosaic-selection" type="button" title="遮盖当前图像选区">遮盖选区</button><span id="mosaic-review-field" hidden><span id="mosaic-review-count" role="status"></span><button id="mosaic-apply" type="button">应用遮盖</button><button id="mosaic-dismiss" type="button" class="quiet">取消</button></span>`;
  customControls(root);
  const get = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let before: ImageDocument | undefined,
    preview: ImageDocument | undefined,
    choosing = false;
  function cancel() {
    choosing = false;
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    timer = undefined;
    if (!before) return;
    const original = before;
    before = preview = undefined;
    get('mosaic-review-field').hidden = true;
    host.preview(original);
    host.pending(false);
    host.message('');
  }
  async function match() {
    const seed = host.selected(),
      region = host.document().selection;
    if (host.locked() || !region || !seed || seed.tool !== 'mosaic' || seed.brush) return;
    const r = annotationBounds(seed),
      left = Math.max(region.x, Math.floor(r.x)),
      top = Math.max(region.y, Math.floor(r.y)),
      right = Math.min(region.x + region.width, Math.ceil(r.x + r.width)),
      bottom = Math.min(region.y + region.height, Math.ceil(r.y + r.height));
    if (right - left < 4 || bottom - top < 4)
      return host.message(Error('请框选至少 4 × 4 像素的完整内容'));
    before = host.document();
    host.pending(true);
    host.message('正在本地识别相同内容，Esc 可取消…');
    const sample = document.createElement('canvas');
    sample.width = region.width;
    sample.height = region.height;
    try {
      const context = sample.getContext('2d', { willReadFrequently: true })!;
      context.translate(-region.x, -region.y);
      context.transform(...before.transform);
      context.drawImage(host.source(), 0, 0);
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      const current = (worker = new Worker(new URL('./mosaic-worker.ts',import.meta.url),{type:'module'}));
      const fail = (value: unknown) => {
        if (worker !== current) return;
        cancel();
        host.message(value);
      };
      timer = setTimeout(() => fail(Error('相同内容识别超时，请缩小选区重试')), 10000);
      current.onerror = () => fail(Error('匹配进程失败，请重试'));
      current.onmessage = ({ data }) => {
        if (worker !== current || !before) return;
        if (data.error) return fail(Error(String(data.error)));
        const matches = data.matches as { x: number; y: number; width: number; height: number }[];
        if (!Array.isArray(matches) || !matches.length || matches.length > 100)
          return fail(Error('没有找到相同内容'));
        try {
          const extra = matches
            .filter(
              (m) => Math.abs(m.x + region.x - left) > 2 || Math.abs(m.y + region.y - top) > 2,
            )
            .map((m) => ({
              ...structuredClone(seed),
              id: crypto.randomUUID(),
              transform: undefined,
              start: { x: region.x + m.x, y: region.y + m.y },
              end: { x: region.x + m.x + m.width, y: region.y + m.y + m.height },
              points: [],
              brush: false,
            }));
          preview = { ...before, annotations: [...before.annotations, ...extra] };
          validateImageDocument(preview, before.original);
          current.terminate();
          worker = undefined;
          clearTimeout(timer);
          timer = undefined;
          get('mosaic-review-count').textContent = '找到 ' + matches.length + ' 处';
          get('mosaic-review-field').hidden = false;
          host.preview(preview);
          host.message('请检查遮盖结果；应用后可一次撤销。');
        } catch (e) {
          fail(e);
        }
      };
      current.postMessage(
        {
          pixels: pixels.buffer,
          width: sample.width,
          height: sample.height,
          template: {
            x: left - region.x,
            y: top - region.y,
            width: right - left,
            height: bottom - top,
          },
        },
        [pixels.buffer],
      );
    } catch (e) {
      cancel();
      host.message(e);
    } finally {
      sample.width = sample.height = 0;
    }
  }
  get('auto-mosaic').onclick = () => {
    if (host.locked()) return;
    const seed = host.selected();
    if (seed?.tool === 'mosaic' && !seed.brush) void match();
    else {
      host.choose();
      choosing = true;
      host.message('框选一处要遮盖的完整文字或图案，随后识别同类内容');
    }
  };
  get('mosaic-selection').onclick = () => {
    const doc = host.document(),
      r = doc.selection;
    if (host.locked() || !r) return;
    const mark: Annotation = {
      id: crypto.randomUUID(),
      tool: 'mosaic',
      start: { x: r.x, y: r.y },
      end: { x: r.x + r.width, y: r.y + r.height },
      points: [],
      width: 3,
      strength: host.strength(),
      color: '#000000',
      text: '',
      number: 1,
      brush: false,
    };
    host.commit({ ...doc, annotations: [...doc.annotations, mark] });
    host.select(mark);
  };
  get('mosaic-dismiss').onclick = cancel;
  get('mosaic-apply').onclick = () => {
    if (!preview) return;
    const next = preview;
    cancel();
    host.commit(next);
  };
  addEventListener('beforeunload', () => {
    worker?.terminate();
    clearTimeout(timer);
  });
  return {
    get active() {
      return !!before;
    },
    cancel,
    stopChoosing() {
      choosing = false;
    },
    drawn() {
      if (choosing) {
        choosing = false;
        void match();
      }
    },
    refresh() {
      get<HTMLButtonElement>('mosaic-apply').disabled = !preview;
      for (const id of ['auto-mosaic', 'mosaic-selection'])
        get<HTMLButtonElement>(id).disabled = host.locked();
    },
  };
}
