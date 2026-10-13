import { readingTokens, selectedText, textBounds, textGroup, textVertical, type TextDocument, type TextToken } from '../../shared/recognition/text-document';
import { imageToTextView, textViewToImage, textViewSize, insideTextQuad, type TextRotation, type TextView } from '../../shared/recognition/text-geometry';
import './text-selection.css';

/** Shared image-space layer. Only visible lines create DOM nodes; selection always uses the full reading order. */
export function mountTextSelection(image: HTMLImageElement, options: {
  copy(text: string): Promise<void>;
  translate(text: string): void;
  selected?(start: number, end: number): void;
  message(value: unknown): void;
}) {
  const host = image.parentElement!;
  const root = document.createElement('div'); root.className = 'text-image-workspace';
  const tools = document.createElement('div'); tools.className = 'text-image-tools'; tools.setAttribute('aria-label', '图片文字操作');
  const button = (text: string, action: () => void) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'quiet'; node.textContent = text;
    node.onclick = action; tools.append(node); return node;
  };
  const viewport = document.createElement('div'); viewport.className = 'text-image-viewport'; viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '图片选字：拖动选择，双击词语，三击整行，Shift 与方向键扩选，Ctrl+A 全选，Ctrl+C 复制，空格拖动平移');
  const stage = document.createElement('div'); stage.className = 'text-image-stage';
  const inner = document.createElement('div'); inner.className = 'text-image-inner';
  const layer = document.createElement('div'); layer.className = 'text-selection-layer';
  image.classList.add('text-selection-image');
  inner.append(image, layer); stage.append(inner); viewport.append(stage); root.append(tools, viewport); host.append(root);
  const status = document.createElement('span'); status.className = 'text-image-status'; status.setAttribute('aria-live', 'polite');
  let doc: TextDocument | undefined, tokens: TextToken[] = [], enabled = true, visible = true, anchor = -1, focus = -1;
  let zoom: number | undefined, rotation: TextRotation = 0, view: TextView = { width: 1, height: 1, scale: 1, rotation: 0 };
  let lines: { top: number; bottom: number; left: number; right: number; prefixBottom: number; indices: number[] }[] = [];
  let frame = 0, space = false;
  let pendingLayout = false;
  let visibleSignature = '';
  const nodes = new Map<number, HTMLSpanElement>();
  let drag: { id: number; pan: boolean; x: number; y: number; left: number; top: number } | undefined;
  const text = () => selectedText(tokens, anchor, focus);
  const copy = () => { const value = text(); if (value) void options.copy(value).then(() => options.message('已复制选中文字')).catch(options.message); };
  const fit = button('适应宽度', () => { zoom = undefined; layout(); }); fit.dataset.textAction = 'fit';
  const less = button('缩小', () => setZoom(view.scale / 1.25)); less.dataset.textAction = 'zoom-out';
  const more = button('放大', () => setZoom(view.scale * 1.25)); more.dataset.textAction = 'zoom-in';
  const rotate = button('旋转', () => { rotation = ((rotation + 1) % 4) as TextRotation; layout(); }); rotate.dataset.textAction = 'rotate';
  const copyButton = button('复制选中文字', copy); copyButton.dataset.textAction = 'copy';
  const translateButton = button('翻译选中文字', () => { if (text()) options.translate(text()); }); translateButton.dataset.textAction = 'translate';
  const actions = document.createElement('div'); actions.className = 'text-selection-actions'; actions.hidden = true;
  actions.setAttribute('aria-label', '已选文字操作'); actions.append(copyButton, translateButton); root.append(actions);
  tools.append(status);
  function setZoom(value: number) { zoom = Math.max(0.05, Math.min(8, value)); layout(); }
  function layout() {
    // ResizeObserver and toolbar wrapping can arrive after pointerdown. Keep one
    // image transform for the complete selection gesture, then apply the new fit.
    if (drag && !drag.pan) { pendingLayout = true; return; }
    pendingLayout = false;
    const width = doc?.source.width || image.naturalWidth, height = doc?.source.height || image.naturalHeight;
    if (!width || !height) return;
    const fitScale = Math.max(0.01, viewport.clientWidth / (rotation % 2 ? height : width));
    view = { width, height, rotation, scale: visible ? zoom ?? fitScale : Math.min(fitScale, viewport.clientHeight / (rotation % 2 ? width : height)) || fitScale };
    const size = textViewSize(view), w = width * view.scale, h = height * view.scale;
    stage.style.width = `${size.width}px`; stage.style.height = `${size.height}px`;
    inner.style.width = `${w}px`; inner.style.height = `${h}px`;
    inner.style.transform = rotation === 0 ? '' : rotation === 1 ? `translate(${h}px,0) rotate(90deg)` :
      rotation === 2 ? `translate(${w}px,${h}px) rotate(180deg)` : `translate(0,${w}px) rotate(270deg)`;
    status.textContent = `${Math.round(view.scale * 100)}%${tokens.length ? ` · ${anchor < 0 ? '拖动图片文字进行选择' : '已选择文字'}` : ''}`;
    schedule();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }
  function render() {
    layer.hidden = !enabled || !visible || !tokens.length;
    copyButton.disabled = translateButton.disabled = !enabled || anchor < 0 || focus < 0 || !tokens.length;
    actions.hidden = !enabled || !visible || anchor < 0 || !tokens.length;
    if (layer.hidden) { layer.replaceChildren(); nodes.clear(); visibleSignature = ''; return; }
    const bounds = viewport.getBoundingClientRect(), rect = stage.getBoundingClientRect();
    const corners = [[bounds.left, bounds.top], [bounds.right, bounds.top], [bounds.right, bounds.bottom], [bounds.left, bounds.bottom]]
      .map(([x, y]) => textViewToImage({ x: x - rect.left, y: y - rect.top }, view));
    const top = Math.min(...corners.map(point => point.y)) - 20, bottom = Math.max(...corners.map(point => point.y)) + 20;
    const left = Math.min(...corners.map(point => point.x)) - 20, right = Math.max(...corners.map(point => point.x)) + 20;
    let low = 0, high = lines.length;
    while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].prefixBottom < top) low = mid + 1; else high = mid; }
    const fragment = document.createDocumentFragment(), start = Math.min(anchor, focus), end = Math.max(anchor, focus);
    const indices: number[] = [];
    visibleLines:
    for (let index = low; index < lines.length && lines[index].top <= bottom; index++) {
      const line = lines[index];
      if (line.bottom < top || line.right < left || line.left > right) continue;
      for (const tokenIndex of line.indices) {
        const token = tokens[tokenIndex], box = textBounds(token.quad);
        if (box.x + box.width < left || box.x > right || box.y + box.height < top || box.y > bottom) continue;
        indices.push(tokenIndex);
        if (indices.length > 5000) break visibleLines;
      }
    }
    viewport.dataset.selectionStart = String(anchor);
    viewport.dataset.selectionEnd = String(focus);
    if (indices.length > 5000) {
      layer.replaceChildren(); nodes.clear(); visibleSignature = ''; layer.dataset.renderedTokens = '0';
      status.textContent = `${Math.round(view.scale * 100)}% · 文字较密，请放大后选字；仍可全选复制`;
      return;
    }
    indices.sort((a, b) => a - b);
    const signature = indices.join(','), rebuild = signature !== visibleSignature;
    const wanted = new Set(indices);
    for (const index of nodes.keys()) if (!wanted.has(index)) nodes.delete(index);
    for (const tokenIndex of indices) {
        const token = tokens[tokenIndex], box = textBounds(token.quad);
        let node = nodes.get(tokenIndex);
        if (!node) {
          node = document.createElement('span'); node.className = 'text-selection-unit'; node.dataset.token = String(tokenIndex);
          node.dataset.geometry = token.geometry; node.textContent = token.text;
          node.style.cssText = `left:${box.x / view.width * 100}%;top:${box.y / view.height * 100}%;width:${box.width / view.width * 100}%;height:${box.height / view.height * 100}%;`;
          node.style.clipPath = `polygon(${token.quad.map(point => `${(point.x - box.x) / box.width * 100}% ${(point.y - box.y) / box.height * 100}%`).join(',')})`;
          nodes.set(tokenIndex, node);
        }
        node.classList.toggle('selected', anchor >= 0 && tokenIndex >= start && tokenIndex <= end);
        if (rebuild) fragment.append(node);
    }
    if (rebuild) layer.replaceChildren(fragment);
    visibleSignature = signature; layer.dataset.renderedTokens = String(indices.length);
    if (anchor >= 0 && focus >= 0 && doc?.alignment === 'source') {
      const first = tokens[Math.min(anchor, focus)], last = tokens[Math.max(anchor, focus)];
      if (first.sourceStart !== undefined && last.sourceEnd !== undefined) options.selected?.(first.sourceStart, last.sourceEnd);
    }
    status.textContent = `${Math.round(view.scale * 100)}% · ${anchor < 0 ? '拖动图片文字进行选择' : '已选择文字'}`;
  }
  function choose(index: number, extend = false) {
    if (index < 0) return;
    if (!extend || anchor < 0) anchor = index;
    focus = index; schedule();
  }
  function hit(event: PointerEvent, nearest = false) {
    const rect = stage.getBoundingClientRect();
    const point = textViewToImage({ x: event.clientX - rect.left, y: event.clientY - rect.top }, view);
    let best = -1, distance = Infinity;
    // Visible nodes provide exact quad hit-testing. During a drag, the nearest visible unit bridges whitespace.
    for (const element of layer.querySelectorAll<HTMLElement>('[data-token]')) {
      const index = Number(element.dataset.token), token = tokens[index], box = textBounds(token.quad);
      if (!nearest && !insideTextQuad(point, token.quad)) continue;
      const value = Math.hypot(point.x - box.x - box.width / 2, point.y - box.y - box.height / 2);
      if (value < distance) { distance = value; best = index; }
    }
    return best;
  }
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const pan = space;
    if (!pan && (!enabled || !visible)) return;
    const index = pan ? -1 : hit(event);
    if (!pan && index < 0) { anchor = focus = -1; schedule(); return; }
    event.preventDefault(); viewport.focus(); viewport.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, pan, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    if (!pan) choose(index, event.shiftKey);
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.pan) { viewport.scrollLeft = drag.left + drag.x - event.clientX; viewport.scrollTop = drag.top + drag.y - event.clientY; }
    else {
      const bounds = viewport.getBoundingClientRect();
      if (event.clientY < bounds.top + 20) viewport.scrollTop -= 18;
      if (event.clientY > bounds.bottom - 20) viewport.scrollTop += 18;
      if (event.clientX < bounds.left + 20) viewport.scrollLeft -= 18;
      if (event.clientX > bounds.right - 20) viewport.scrollLeft += 18;
      choose(hit(event, true), true);
    }
  });
  const stop = () => { drag = undefined; if (pendingLayout) layout(); };
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('lostpointercapture', stop);
  viewport.addEventListener('click', event => {
    if (enabled && visible && focus >= 0 && event.detail >= 2) {
      const group = textGroup(tokens, focus, event.detail >= 3 ? 'line' : 'word');
      anchor = group.anchor; focus = group.focus; schedule();
    }
  });
  viewport.addEventListener('keydown', event => {
    if (event.code === 'Space') { event.preventDefault(); space = true; viewport.classList.add('panning'); return; }
    if (!enabled || !visible || !tokens.length) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); anchor = 0; focus = tokens.length - 1; schedule(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); return; }
    if (event.key === 'Escape') { event.preventDefault(); anchor = focus = -1; schedule(); return; }
    let next = focus;
    if (event.key === 'ArrowLeft') next = !event.shiftKey && anchor >= 0 && anchor !== focus ? Math.min(anchor, focus) : Math.max(0, focus - 1);
    else if (event.key === 'ArrowRight') next = !event.shiftKey && anchor >= 0 && anchor !== focus ? Math.max(anchor, focus) : Math.min(tokens.length - 1, focus + 1);
    else if (event.key === 'ArrowUp') next = textVertical(tokens, focus, -1);
    else if (event.key === 'ArrowDown') next = textVertical(tokens, focus, 1);
    else if (event.key === 'Home') next = event.ctrlKey ? 0 : textGroup(tokens, Math.max(0, focus), 'line').anchor;
    else if (event.key === 'End') next = event.ctrlKey ? tokens.length - 1 : textGroup(tokens, Math.max(0, focus), 'line').focus;
    else return;
    event.preventDefault(); choose(next, event.shiftKey);
    const box = textBounds(tokens[next].quad), p = imageToTextView({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, view);
    if (p.x < viewport.scrollLeft || p.x > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = Math.max(0, p.x - viewport.clientWidth / 2);
    if (p.y < viewport.scrollTop || p.y > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, p.y - viewport.clientHeight / 2);
  });
  viewport.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; viewport.classList.remove('panning'); } });
  viewport.addEventListener('blur', () => { space = false; stop(); viewport.classList.remove('panning'); });
  viewport.addEventListener('scroll', schedule, { passive: true });
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault(); setZoom(view.scale * (event.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });
  image.addEventListener('load', layout);
  const resize = new ResizeObserver(layout); resize.observe(viewport);
  return {
    setDocument(value: TextDocument | undefined) {
      stop();
      doc = value; tokens = value ? readingTokens(value) : []; anchor = focus = -1;
      nodes.clear(); visibleSignature = ''; layer.replaceChildren();
      const indices = new Map<string, number[]>();
      tokens.forEach((token, index) => { const row = indices.get(token.lineId) || []; row.push(index); indices.set(token.lineId, row); });
      lines = (value?.blocks.flatMap(block => block.lines) || []).map(line => {
        const box = textBounds(line.quad);
        return { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width, prefixBottom: 0, indices: indices.get(line.id) || [] };
      }).sort((a, b) => a.top - b.top);
      let bottom = -Infinity; for (const line of lines) line.prefixBottom = bottom = Math.max(bottom, line.bottom);
      layout();
    },
    setEnabled(value: boolean, show = true) {
      if (enabled === value && visible === show) return;
      enabled = value; visible = show; tools.hidden = !show; layout(); schedule();
    },
    dispose() {
      resize.disconnect(); if (frame) cancelAnimationFrame(frame);
      image.removeEventListener('load', layout); image.classList.remove('text-selection-image');
      host.append(image); root.remove();
    },
  };
}
