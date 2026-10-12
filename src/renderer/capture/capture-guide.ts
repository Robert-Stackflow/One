/** A passive guide that moves clear of selections and hides when no corner is free. */
export function captureGuide(root: HTMLElement) {
  let bounds: DOMRect | undefined;
  let selection: { x: number; y: number; width: number; height: number } | null = null;
  let controls: HTMLElement[] = [];
  const place = () => {
    const width = root.offsetWidth,
      height = root.offsetHeight,
      gap = 18;
    if (!width || !height) return;
    const obstacles = controls
      .filter((e) => !e.hidden && e.getClientRects().length)
      .map((e) => e.getBoundingClientRect());
    if (selection)
      obstacles.push(new DOMRect(selection.x, selection.y, selection.width, selection.height));
    const right = Math.max(gap, innerWidth - width - gap),
      bottom = Math.max(gap, innerHeight - height - gap);
    const candidates = [
      { x: gap, y: bottom },
      { x: right, y: bottom },
      { x: gap, y: gap },
      { x: right, y: gap },
    ];
    const clear = candidates.find(
      (p) =>
        p.x + width <= innerWidth - gap &&
        p.y + height <= innerHeight - gap &&
        obstacles.every(
          (r) =>
            p.x + width + 12 <= r.left ||
            p.x >= r.right + 12 ||
            p.y + height + 12 <= r.top ||
            p.y >= r.bottom + 12,
        ),
    );
    const position = clear || candidates[0];
    root.style.left = position.x + 'px';
    root.style.top = position.y + 'px';
    root.style.bottom = 'auto';
    root.classList.toggle('is-avoiding-selection', !clear);
    bounds = root.getBoundingClientRect();
  };
  let last: { x: number; y: number } | undefined;
  const update = () => {
    if (!bounds) return;
    const near =
      !!last &&
      last.x >= bounds.left - 14 &&
      last.x <= bounds.right + 14 &&
      last.y >= bounds.top - 14 &&
      last.y <= bounds.bottom + 14;
    root.classList.toggle('is-avoiding-pointer', near);
    root.setAttribute(
      'aria-hidden',
      String(near || root.classList.contains('is-avoiding-selection')),
    );
  };
  const measure = () => {
    place();
    update();
  };
  new ResizeObserver(measure).observe(root);
  window.addEventListener('resize', measure);
  function setPurpose(
    purpose: 'capture' | 'region',
    hint?: 'scroll' | 'recording',
    scope: 'desktop' | 'screen' | 'image' = 'screen',
  ) {
    const heading = document.createElement('div');
    heading.className = 'capture-guide-heading';
    heading.textContent =
      purpose === 'capture'
        ? '截图快捷操作'
        : hint === 'scroll'
          ? '选择长截图区域'
          : '选择录制区域';
    const rows: [string[], string][] = [
      ...(purpose === 'capture'
        ? [[['Ctrl', '1 / 2 / 3'], '矩形 / 自由 / 折线'] as [string[], string]]
        : []),
      [['W', 'A', 'S', 'D'], '移动鼠标 · 1 像素'],
      [['↑', '↓', '←', '→'], '移动选区 · 1 像素'],
      [['滚轮'], '切换窗口 / 界面元素'],
      [
        ['Ctrl', 'A'],
        scope === 'desktop'
          ? '选择窗口 / 所有显示器'
          : scope === 'image'
            ? '选择整张图像'
            : '选择窗口 / 当前屏幕',
      ],
      [['Shift'], '轻按切换颜色格式 · 移动时加速'],
      [['C'], '复制鼠标位置的颜色'],
      [['P'], '切换全局 / 相对坐标'],
      ...(purpose === 'region' ? [[['Enter'], '确认选区'] as [string[], string]] : []),
      [['Esc'], '取消'],
    ];
    root.replaceChildren(heading);
    const list = document.createElement('dl');
    for (const [keys, description] of rows) {
      const term = document.createElement('dt'),
        detail = document.createElement('dd');
      for (const key of keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        term.append(cap);
      }
      detail.textContent = description;
      list.append(term, detail);
    }
    root.append(list);
    if (hint === 'scroll') {
      const note = document.createElement('p');
      note.textContent = '框选滚动内容，避开固定栏和动画';
      root.append(note);
    }
    measure();
  }
  setPurpose('capture');
  return {
    setPurpose,
    avoid(rect: typeof selection, elements: HTMLElement[]) {
      selection = rect;
      controls = elements;
      place();
      update();
    },
    pointer(x: number, y: number) {
      last = { x, y };
      update();
    },
  };
}
