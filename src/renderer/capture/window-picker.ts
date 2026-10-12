import type {CaptureWindowChoice} from '../../shared/capture/api';
import {
  captureWindowLayout,
  arrangeWindows,
  CAPTURE_WINDOWS,
} from '../../shared/capture/capture-window-layout';
import {customControls} from '../controls';
import {onRemoval} from '../dom-lifecycle';
import {searchField,setupSearchField} from '../search-field';
import { icon } from '../ui';

type WindowChoice = CaptureWindowChoice;
type Layer = WindowChoice & { x: number; y: number };
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const coordinate = (value: number) => Math.max(-100000, Math.min(100000, Math.round(value)));

/** The list is the only scrolling surface. Preview coordinates are physical source pixels. */
export function windowCompositionPicker(
  root: HTMLElement,
  choices: WindowChoice[],
  changed: (valid: boolean) => void,
  refresh: () => void = () => {},
) {
  let selected: Layer[] = [],
    active = '',
    filter = '',
    policy: 'auto' | 'desktop' | 'custom' = 'auto';
  const history: { layers: Layer[]; active: string; policy: 'auto' | 'desktop' | 'custom' }[] = [];
  let scale = 1,
    origin = { x: 0, y: 0 },
    disposed = false;
  let drag:
    | {
        id: number;
        token: string;
        existing: boolean;
        startX: number;
        startY: number;
        x: number;
        y: number;
        moved: boolean;
        origin: typeof origin;
        scale: number;
        ghost?: HTMLElement;
        target: HTMLElement;
      }
    | undefined;
  root.classList.add('window-composition-editor');
  root.closest('.capture-source-scroll')?.classList.add('composition-host');
  root.innerHTML = `<section class="composition-list"><div class="composition-list-heading"><span>窗口</span><small id="composition-count">0 / ${CAPTURE_WINDOWS}</small></div><div class="composition-search-row">${searchField('composition-search', '搜索窗口', '搜索窗口名称')}<button id="composition-refresh" class="quiet icon-button" aria-label="刷新窗口" title="刷新窗口">${icon('lucide:refresh-cw')}</button></div><div class="composition-list-scroll" id="composition-choices"></div></section><section class="composition-workspace"><div class="composition-heading"><strong>组合预览</strong><span id="composition-size"></span><div class="composition-actions"><button id="composition-arrange" class="quiet">智能排列</button><button id="composition-desktop" class="quiet">恢复位置</button><button id="composition-undo" class="quiet" aria-label="撤销布局" title="撤销布局">撤销</button><button id="composition-clear" class="quiet">清空</button></div></div><div id="composition-stage" class="composition-stage" tabindex="0" aria-label="多窗口组合预览；选择窗口后可拖动，方向键微调位置"><div id="composition-empty"><span>${icon('lucide:layers')}</span><strong>拖入窗口，自由组合</strong><p>保留原始尺寸，空隙透明</p></div><div id="composition-layers"></div></div><div id="composition-inspector" class="composition-inspector" hidden><div class="composition-position"><label>X<input id="composition-x" type="number" step="1" min="-100000" max="100000" aria-label="窗口横向位置"></label><label>Y<input id="composition-y" type="number" step="1" min="-100000" max="100000" aria-label="窗口纵向位置"></label></div><div class="composition-layer-actions"><button id="composition-down" class="quiet" aria-label="下移一层" title="下移一层">${icon('lucide:arrow-down')}</button><button id="composition-up" class="quiet" aria-label="上移一层" title="上移一层">${icon('lucide:arrow-up')}</button><button id="composition-remove" class="quiet icon-button" aria-label="移除所选窗口" title="移除所选窗口">${icon('lucide:trash')}</button></div></div><p id="composition-feedback" class="composition-tip" role="status"></p></section>`;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const stage = q('composition-stage'),
    layers = q('composition-layers');
  function remember() {
    history.push({ layers: structuredClone(selected), active, policy });
    if (history.length > 50) history.shift();
  }
  function arrange() {
    const positions = arrangeWindows(selected.map((item) => item.bounds));
    selected.forEach((item, i) => {
      item.x = positions[i].x;
      item.y = positions[i].y;
    });
  }
  function renderList() {
    const list = choices.filter((item) =>
      item.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    );
    q('composition-choices').innerHTML = list.length
      ? list
          .map((item) => {
            const index = selected.findIndex((layer) => layer.token === item.token);
            return `<button class="composition-source ${index >= 0 ? 'selected' : ''}" type="button" data-window-token="${item.token}" aria-pressed="${index >= 0}" title="${escape(item.name)}"><img src="${item.thumbnail}" alt="" draggable="false"><span><strong>${escape(item.name)}</strong><small>${item.bounds.width} × ${item.bounds.height}</small></span>${index >= 0 ? '<span class="composition-source-mark">' + icon('lucide:check') + '</span>' : ''}</button>`;
          })
          .join('')
      : '<p class="composition-tip">没有匹配的窗口</p>';
    q('composition-choices')
      .querySelectorAll<HTMLButtonElement>('[data-window-token]')
      .forEach((node) => {
        node.onclick = () => {
          if (node.dataset.dragged) {
            delete node.dataset.dragged;
            return;
          }
          const existing = selected.find((item) => item.token === node.dataset.windowToken);
          if (existing) {
            active = existing.token;
            render();
          } else add(node.dataset.windowToken!);
        };
        node.onpointerdown = (event) => begin(event, node, node.dataset.windowToken!, false);
      });
  }
  function add(token: string, position?: { x: number; y: number }) {
    if (selected.some((item) => item.token === token)) {
      active = token;
      render();
      return;
    }
    if (selected.length >= CAPTURE_WINDOWS) {
      q('composition-feedback').textContent = '最多组合 8 个窗口，请先移除一个窗口。';
      return;
    }
    const item = choices.find((item) => item.token === token);
    if (!item) return;
    remember();
    selected.push({ ...item, x: position?.x ?? item.bounds.x, y: position?.y ?? item.bounds.y });
    active = token;
    if (position) policy = 'custom';
    else if (policy === 'auto') arrange();
    render();
  }
  function render() {
    if (disposed) return;
    q('composition-feedback').textContent = '';
    let layout: ReturnType<typeof captureWindowLayout> | undefined;
    try {
      if (selected.length)
        layout = captureWindowLayout(
          selected.map((item) => ({ ...item.bounds, x: item.x, y: item.y })),
        );
    } catch (error) {
      q('composition-feedback').textContent = (error as Error).message;
    }
    changed(!!layout);
    q('composition-count').textContent = `${selected.length} / ${CAPTURE_WINDOWS}`;
    q('composition-size').textContent = layout ? `${layout.width} × ${layout.height}` : '';
    q('composition-empty').hidden = !!selected.length;
    q<HTMLButtonElement>('composition-undo').disabled = !history.length;
    for (const id of ['composition-arrange', 'composition-desktop', 'composition-clear'])
      q<HTMLButtonElement>(id).disabled = !selected.length;
    if (!drag) {
      const width = layout?.width || 1920,
        height = layout?.height || 1080,
        padding = 24;
      scale = Math.max(
        0.005,
        Math.min(
          (stage.clientWidth - padding * 2) / width,
          (stage.clientHeight - padding * 2) / height,
          1,
        ),
      );
      origin = {
        x: (layout?.x || 0) - (stage.clientWidth / scale - width) / 2,
        y: (layout?.y || 0) - (stage.clientHeight / scale - height) / 2,
      };
    }
    layers.innerHTML = selected
      .map(
        (item, i) =>
          `<button type="button" class="composition-layer ${item.token === active ? 'selected' : ''}" data-layer="${item.token}" aria-label="${escape(item.name)}，第 ${i + 1} 层" aria-pressed="${item.token === active}" style="left:${(item.x - origin.x) * scale}px;top:${(item.y - origin.y) * scale}px;width:${item.bounds.width * scale}px;height:${item.bounds.height * scale}px;z-index:${i + 1}"><img src="${item.thumbnail}" alt="" draggable="false"><span class="composition-layer-label">${escape(item.name)}</span></button>`,
      )
      .join('');
    layers.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((node) => {
      node.onclick = () => {
        if (node.dataset.dragged) {
          delete node.dataset.dragged;
          return;
        }
        active = node.dataset.layer!;
        renderInspector();
        layers.querySelectorAll<HTMLElement>('[data-layer]').forEach((item) => {
          item.classList.toggle('selected', item === node);
          item.setAttribute('aria-pressed', String(item === node));
        });
      };
      node.onpointerdown = (event) => begin(event, node, node.dataset.layer!, true);
      node.onkeydown = keyMove;
    });
    renderList();
    renderInspector();
  }
  function renderInspector() {
    const item = selected.find((item) => item.token === active),
      index = selected.findIndex((item) => item.token === active);
    q('composition-inspector').hidden = !item;
    if (!item) return;
    q<HTMLInputElement>('composition-x').value = String(item.x);
    q<HTMLInputElement>('composition-y').value = String(item.y);
    q<HTMLButtonElement>('composition-down').disabled = index <= 0;
    q<HTMLButtonElement>('composition-up').disabled = index === selected.length - 1;
  }
  function begin(event: PointerEvent, target: HTMLElement, token: string, existing: boolean) {
    if (event.button !== 0 || drag) return;
    const item = selected.find((item) => item.token === token);
    if (!existing && item) {
      active = token;
      renderInspector();
      return;
    }
    if (!existing && selected.length >= CAPTURE_WINDOWS) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    if (existing) active = token;
    drag = {
      id: event.pointerId,
      token,
      existing,
      startX: event.clientX,
      startY: event.clientY,
      x: item?.x || 0,
      y: item?.y || 0,
      moved: false,
      origin: { ...origin },
      scale,
      target,
    };
    renderInspector();
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4)
      return;
    if (!drag.moved) {
      if (drag.existing) remember();
      drag.moved = true;
      drag.target.dataset.dragged = 'true';
      if (!drag.existing) {
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'composition-drag-ghost';
        const image = new Image();
        image.src = choices.find((item) => item.token === drag!.token)!.thumbnail;
        drag.ghost.append(image);
        document.body.append(drag.ghost);
      }
    }
    stage.classList.add('is-dragging');
    if (drag.existing) {
      const item = selected.find((item) => item.token === drag!.token)!;
      item.x = coordinate(drag.x + (event.clientX - drag.startX) / drag.scale);
      item.y = coordinate(drag.y + (event.clientY - drag.startY) / drag.scale);
      policy = 'custom';
      drag.target.style.left = (item.x - drag.origin.x) * drag.scale + 'px';
      drag.target.style.top = (item.y - drag.origin.y) * drag.scale + 'px';
      renderInspector();
    } else if (drag.ghost) {
      drag.ghost.style.left = event.clientX + 12 + 'px';
      drag.ghost.style.top = event.clientY + 12 + 'px';
    }
  }
  function end(event?: PointerEvent, cancel = false) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const previous = drag;
    drag = undefined;
    previous.ghost?.remove();
    stage.classList.remove('is-dragging');
    if (previous.target.hasPointerCapture(previous.id))
      previous.target.releasePointerCapture(previous.id);
    if (cancel && previous.existing) {
      if (previous.moved) {
        const before = history.pop();
        if (before) policy = before.policy;
      }
      const item = selected.find((item) => item.token === previous.token);
      if (item) {
        item.x = previous.x;
        item.y = previous.y;
      }
    }
    if (previous.moved && !previous.existing && !cancel && event) {
      const box = stage.getBoundingClientRect();
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      ) {
        // The initial ghost is centered at the drop point, in physical source pixels.
        const item = choices.find((item) => item.token === previous.token)!;
        add(previous.token, {
          x: coordinate(
            previous.origin.x + (event.clientX - box.left) / previous.scale - item.bounds.width / 2,
          ),
          y: coordinate(
            previous.origin.y + (event.clientY - box.top) / previous.scale - item.bounds.height / 2,
          ),
        });
      }
    }
    if (previous.moved) render();
  }
  function remove() {
    if (!active) return;
    remember();
    selected = selected.filter((item) => item.token !== active);
    active = selected.at(-1)?.token || '';
    render();
  }
  function keyMove(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      end(undefined, true);
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    const item = selected.find((item) => item.token === active);
    if (!item) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
      stage.focus({ preventScroll: true });
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    remember();
    const step = event.shiftKey ? 10 : 1;
    item.x = coordinate(
      item.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
    );
    item.y = coordinate(
      item.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
    );
    policy = 'custom';
    render();
    layers
      .querySelector<HTMLElement>('[data-layer="' + active + '"]')
      ?.focus({ preventScroll: true });
  }
  q('composition-refresh').onclick = refresh;
  q('composition-arrange').onclick = () => {
    remember();
    policy = 'auto';
    arrange();
    render();
  };
  q('composition-desktop').onclick = () => {
    remember();
    policy = 'desktop';
    selected.forEach((item) => {
      item.x = item.bounds.x;
      item.y = item.bounds.y;
    });
    render();
  };
  q('composition-clear').onclick = () => {
    remember();
    selected = [];
    active = '';
    render();
  };
  q('composition-undo').onclick = () => {
    const previous = history.pop();
    if (previous) {
      selected = previous.layers;
      active = previous.active;
      policy = previous.policy;
      render();
    }
  };
  q('composition-remove').onclick = remove;
  for (const [id, delta] of [
    ['composition-up', 1],
    ['composition-down', -1],
  ] as const)
    q(id).onclick = () => {
      const index = selected.findIndex((item) => item.token === active),
        next = index + delta;
      if (index < 0 || next < 0 || next >= selected.length) return;
      remember();
      [selected[index], selected[next]] = [selected[next], selected[index]];
      render();
    };
  for (const axis of ['x', 'y'] as const)
    q<HTMLInputElement>('composition-' + axis).onchange = () => {
      const item = selected.find((item) => item.token === active),
        value = q<HTMLInputElement>('composition-' + axis).valueAsNumber;
      if (!item || !Number.isFinite(value)) {
        renderInspector();
        return;
      }
      remember();
      item[axis] = coordinate(value);
      policy = 'custom';
      render();
    };
  q<HTMLInputElement>('composition-search').oninput = (event) => {
    filter = (event.target as HTMLInputElement).value;
    renderList();
  };
  stage.onkeydown = keyMove;
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => end(undefined, true));
  const resize = new ResizeObserver(() => {
    if (!drag) render();
  });
  resize.observe(stage);
  onRemoval(root, () => {
    disposed = true;
    end(undefined, true);
    resize.disconnect();
  });
  onRemoval(root, setupSearchField(q<HTMLInputElement>('composition-search')));
  customControls(root);
  render();
  return {
    tokens: () => selected.map((item) => item.token),
    placements: () => selected.map((item) => ({ token: item.token, x: item.x, y: item.y })),
  };
}
