import './pin.css';
import {applyCaptureScale} from '../capture/appearance';
import {
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Copy,
  Download,
  MousePointer2,
  EyeOff,
  X,
  File,
  Folder,
  FolderOpen,
  GripVertical,
  MoreHorizontal,
  RefreshCw,
} from 'lucide';
import { icon, registerIcons, toast } from '../ui';
import { customControls,selectSource } from '../controls';
import {iconButton} from '../ui';
import { setupFloatingFeedback, transientNotice } from '../feedback';
import {
  pinBase,
  pinDocument,
  type PinAPI,
  type PinWindowState,
  type PinAction,
} from '../../shared/pins';
registerIcons({
  rotate: RotateCw,
  flipX: FlipHorizontal2,
  flipY: FlipVertical2,
  copy: Copy,
  download: Download,
  pointer: MousePointer2,
  hide: EyeOff,
  x: X,
  file: File,
  folder: Folder,
  locate: FolderOpen,
  grip: GripVertical,
  more: MoreHorizontal,
  reset: RefreshCw,
});
const api = window.one.pin!,
  content = document.getElementById('pin-content'),
  tools = document.getElementById('pin-tools');
const feedback = document.getElementById('toast')!;
setupFloatingFeedback(feedback, true);
const notify = transientNotice(feedback, 3500);
document.addEventListener('one:feedback', (event) => notify((event as CustomEvent).detail));
let state: PinWindowState,
  contentId = '',
  pending = false,
  moving = false;
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
async function perform(action: PinAction) {
  try {
    await api.action(action);
    if (action.kind === 'copy') toast('已复制原内容');
  } catch (error) {
    toast(error instanceof Error ? error.message : error);
  }
}
function render(next: PinWindowState) {
  state = next;
  applyCaptureScale(document.body,next.uiScale);
  const record = state.record,
    base = pinBase(record.content),
    documentView = pinDocument(record.content, record.view);
  if (content) {
    if (contentId !== record.id) {
      contentId = record.id;
      if (record.content.kind === 'image') {
        const img = document.createElement('img');
        img.alt = record.title;
        img.src = state.image!;
        img.draggable = false;
        img.addEventListener('error', () => {
          content.replaceChildren();
          const error = document.createElement('p');
          error.className = 'pin-load-error';
          error.textContent = '原图加载失败，可从管理页重试';
          content.append(error);
        });
        content.replaceChildren(img);
      } else if (record.content.kind === 'text') {
        content.className = 'pin-text';
        const text = document.createElement('pre');
        text.textContent = record.content.text;
        content.replaceChildren(text);
      } else {
        content.className = 'pin-files';
        content.innerHTML = `<div class="pin-files-heading">${icon('lucide:folder')}<span>${record.content.files.length} 个文件</span><small>Ctrl 拖出文件</small></div><div class="pin-file-list">${record.content.files.map((f, i) => `<div class="pin-file" draggable="true" data-file-index="${i}" title="${escape(f.path)}">${icon('lucide:' + (f.directory ? 'folder' : 'file'))}<span class="pin-file-name">${escape(f.name)}</span><button type="button" data-open-file="${i}" class="quiet">打开</button><button type="button" data-locate-file="${i}" class="icon-button quiet" aria-label="所在位置">${icon('lucide:locate')}</button></div>`).join('')}</div>`;
        content
          .querySelectorAll<HTMLButtonElement>('[data-open-file]')
          .forEach(
            (b) =>
              (b.onclick = () =>
                void perform({ kind: 'open-file', index: Number(b.dataset.openFile) })),
          );
        content
          .querySelectorAll<HTMLButtonElement>('[data-locate-file]')
          .forEach(
            (b) =>
              (b.onclick = () =>
                void perform({ kind: 'locate-file', index: Number(b.dataset.locateFile) })),
          );
        content.querySelectorAll<HTMLElement>('[data-file-index]').forEach((row) => {
          row.addEventListener('dragstart', (event) => {
            event.preventDefault();
            moving = false;
            void api.drag('end').catch(() => {});
            void perform({ kind: 'drag-file', index: Number(row.dataset.fileIndex) });
          });
          row.addEventListener('pointerdown', (event) => {
            if (event.ctrlKey && event.button === 0) {
              event.stopPropagation();
              event.preventDefault();
              void perform({ kind: 'drag-file', index: Number(row.dataset.fileIndex) });
            }
          });
        });
      }
    }
    content.style.width = base.width + 'px';
    content.style.height = base.height + 'px';
    const [a, b, c, d, e, f] = documentView.transform,
      sx = record.view.scale,
      sy = record.view.scale;
    content.style.transform = `matrix(${a * sx},${b * sy},${c * sx},${d * sy},${e * sx},${f * sy})`;
    document.title = 'One · ' + record.title;
  }
  if (tools && !tools.childElementCount) buildTools();
  if (tools) {
    const title = tools.querySelector<HTMLElement>('#pin-title')!;
    title.textContent = record.title;
    title.title = record.title;
    tools.querySelector<HTMLElement>('#pin-status')!.textContent =
      `${Math.round(record.view.scale * 100)}% · ${record.view.rotation * 90}°${record.view.flipX ? ' · 水平镜像' : ''}${record.view.flipY ? ' · 垂直镜像' : ''}`;
    for (const key of ['flipX', 'flipY'] as const)
      tools
        .querySelector<HTMLButtonElement>('#pin-' + key)!
        .setAttribute('aria-pressed', String(record.view[key]));
    const opacity = tools.querySelector<HTMLInputElement>('#pin-opacity')!;
    if (document.activeElement !== opacity)
      opacity.value = String(Math.round(record.view.opacity * 100));
    const group = selectSource(tools.querySelector<HTMLElement>('#pin-group')!)!;
    const options = `<option value="">未分组</option>${state.groups.map((g) => `<option value="${g.id}">${escape(g.name)}</option>`).join('')}`;
    if (group.innerHTML !== options) group.innerHTML = options;
    group.value = record.group || '';
    tools.querySelector<HTMLButtonElement>('#pin-export')!.disabled =
      record.content.kind === 'files';
    customControls(tools);
  }
}
function buildTools() {
  tools!.innerHTML = `<header class="pin-tool-heading"><h2 id="pin-title"></h2><div class="window-controls">${iconButton('pin-panel-close','关闭操作面板','close')}</div></header>
    <div class="pin-tool-body">
      <section class="pin-display-section" aria-labelledby="pin-display-label">
        <div class="pin-display-heading"><span id="pin-display-label">显示调整</span><p id="pin-status"></p></div>
        <div class="pin-transform-tools" role="group" aria-label="显示变换">
          <button type="button" class="quiet pin-transform-action" id="pin-rotate" title="旋转 90°">${icon('lucide:rotate')}<span>旋转</span></button>
          <button type="button" class="quiet pin-transform-action" id="pin-flipX" aria-pressed="false">${icon('lucide:flipX')}<span>水平镜像</span></button>
          <button type="button" class="quiet pin-transform-action" id="pin-flipY" aria-pressed="false">${icon('lucide:flipY')}<span>垂直镜像</span></button>
          <button type="button" class="quiet pin-transform-action" id="pin-reset" title="恢复原始显示">${icon('lucide:reset')}<span>还原</span></button>
        </div>
        <div class="pin-tool-row"><label for="pin-opacity">透明度</label><div><input id="pin-opacity" type="number" min="20" max="100" step="5" aria-label="透明度" /><span class="pin-unit">%</span></div></div>
      </section>
      <div class="pin-tool-row pin-group-row"><label for="pin-group">分组</label><select id="pin-group" aria-label="分组"></select></div>
      <div class="pin-operation-buttons" role="group" aria-label="原内容操作"><button class="quiet pin-menu-action" id="pin-copy">${icon('lucide:copy')}<span>复制原内容</span><kbd>Ctrl+C</kbd></button><button class="quiet pin-menu-action" id="pin-export">${icon('lucide:download')}<span>保存原内容</span></button></div>
      <div class="pin-window-actions" role="group" aria-label="贴图窗口"><button class="quiet pin-menu-action" id="pin-pass" title="开启后可从 One 贴图页或托盘菜单恢复交互">${icon('lucide:pointer')}<span>开启鼠标穿透</span></button><button class="quiet pin-menu-action" id="pin-hide" title="隐藏后可从 One 贴图页恢复">${icon('lucide:hide')}<span>隐藏贴图</span><kbd>Esc</kbd></button></div>
      <p class="pin-recovery">滚轮缩放 · Alt 拖动整组 · 双击隐藏</p>
    </div>`;
  for (const kind of ['rotate', 'flipX', 'flipY', 'reset', 'copy', 'export', 'hide'] as const)
    tools!.querySelector<HTMLButtonElement>('#pin-' + kind)!.onclick = () => void perform({ kind });
  tools!.querySelector<HTMLButtonElement>('#pin-pass')!.onclick = () =>
    void perform({ kind: 'pass', value: true });
  tools!.querySelector<HTMLButtonElement>('#pin-panel-close')!.onclick = () =>
    window.one.windowAction('close').catch(toast);
  tools!.querySelector<HTMLInputElement>('#pin-opacity')!.onchange = (event) =>
    void perform({
      kind: 'opacity',
      value: Number((event.target as HTMLInputElement).value) / 100,
    });
  tools!.querySelector<HTMLSelectElement>('#pin-group')!.onchange = (event) =>
    void perform({ kind: 'group', group: (event.target as HTMLSelectElement).value || null });
  let height = 0;
  new ResizeObserver(() => {
    const next = Math.ceil(tools!.getBoundingClientRect().height);
    if (next !== height) {
      height = next;
      void api.controlsHeight(next).catch(toast);
    }
  }).observe(tools!);
}
if (content) {
  let started: Promise<void> | undefined,
    flight: Promise<void> | undefined,
    ending = false,
    queued = false;
  const move = () => {
    queued = true;
    if (flight) return;
    const operation = (async () => {
      await started;
      while (queued && moving) {
        queued = false;
        await api.drag('move');
      }
    })();
    flight = operation;
    void operation.catch(toast).finally(() => {
      if (flight === operation) flight = undefined;
    });
  };
  content.addEventListener('pointerdown', (event) => {
    if (
      moving ||
      ending ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button,input,select'))
    )
      return;
    event.preventDefault();
    moving = true;
    content.setPointerCapture(event.pointerId);
    started = api.drag('start', event.altKey);
    void started.catch(toast);
  });
  content.addEventListener('pointermove', (event) => {
    if (!moving) return;
    move();
  });
  const end = () => {
    if (!moving) return;
    moving = false;
    ending = true;
    queued = false;
    const previous = flight;
    void started
      ?.then(async () => {
        try {
          await previous;
          await api.drag('move');
        } finally {
          await api.drag('end');
        }
      })
      .catch(toast)
      .finally(() => (ending = false));
  };
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', end);
  content.addEventListener('lostpointercapture', end);
  content.addEventListener('dblclick', (event) => {
    if (!(event.target instanceof Element && event.target.closest('button')))
      void perform({ kind: 'hide' });
  });
  content.addEventListener(
    'wheel',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.pin-file-list,pre') &&
        !event.ctrlKey
      ) {
        const scroll = event.target.closest('.pin-file-list,pre')!;
        if (scroll.scrollHeight > scroll.clientHeight) return;
      }
      event.preventDefault();
      if (moving || ending || event.buttons !== 0 || pending || !event.deltaY) return;
      pending = true;
      void api
        .action({
          kind: 'zoom',
          direction: event.deltaY < 0 ? 1 : -1,
          x: Math.max(0, Math.min(1, event.clientX / innerWidth)),
          y: Math.max(0, Math.min(1, event.clientY / innerHeight)),
        })
        .catch(toast)
        .finally(() => (pending = false));
    },
    { passive: false },
  );
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void perform({ kind: 'controls' });
  });
}
document.addEventListener('keydown', (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest('input,textarea,select,[role=combobox]')
  )
    return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (tools) void window.one.windowAction('close').catch(toast);
    else void perform({ kind: 'hide' });
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    void perform({ kind: 'copy' });
  }
});
window.addEventListener('resize', () => {
  if (state) render(state);
});
api.onChange(render);
void api.state().then(state=>{render(state);document.body.dataset.pinReady='true';}).catch(error=>{document.body.dataset.pinError=String(error);toast(error);});
