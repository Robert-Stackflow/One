import { annotationPreferences } from '../editor/annotation-preferences';
import { annotationBrushCursor } from '../editor/annotation-brush-cursor';
import { watermarkControls } from '../editor/watermark-controls';
import { watermarkToolbar } from '../editor/watermark-toolbar';
import { AnnotationSelection } from '../editor/annotation-selection';
import {
  showAnnotationProperties,
  bindAnnotationFonts,
  readAnnotationStyle,
  bindAnnotationStyle,
  fillAnnotationStyle,
} from '../editor/annotation-controls';
import { InlineAnnotationText } from '../editor/inline-annotation-text';
import './capture.css';
import {
  Undo2,
  Redo2,
  RefreshCw,
  Pin,
  Download,
  X,
  Check,
  Ellipsis,
  Scan,
  ScanText,
  Languages,
  Sigma,
  GalleryHorizontal,
  SlidersHorizontal,
  Ratio,
  SquareDashed,
  Lasso,
  Waypoints,
  Play,
  Images,
  GripHorizontal,
  GripVertical,
  createElement,
} from 'lucide';
import {
  ImageHistory,
  selectionFrom,
  shiftSelection,
  resizeSelection,
  limit,
  type ImageDocument,
  type CaptureTool,
  type Annotation,
  type Point,
  type SelectionHandle,
} from '../../shared/capture/image-document';
import type { CaptureAPI, CaptureData, CaptureAction } from '../../shared/capture/capture-session';
import { captureOutput, paintCapture } from '../editor/capture-paint';
import { canvasPng } from '../editor/image-encode';
import { AnnotationEditor } from '../editor/annotation-editor';
import { stepOrderControls } from '../editor/step-order';
import { magnifierControls } from '../editor/magnifier-controls';
import { groupedAnnotationTools } from '../editor/annotation-tools';
import { mountOutputEffects } from '../editor/output-effects';
import { actionNames, type CaptureResult } from '../../shared/capture/capture-workflow';
import { customControls,selectSource } from '../controls';
import {loadDocumentFont} from '../font-runtime';
import {applyCaptureScale} from './appearance';
import type { WatermarkStyle } from '../../shared/capture/watermark';
import { imageWatermarkControls } from '../editor/image-watermark-controls';
import { sensitiveControls } from '../editor/sensitive-controls';
import { mosaicControls } from '../editor/mosaic-controls';
import { translationLanguages } from '../../shared/recognition/translation';
import { defaultEffects } from '../../shared/capture/image-output';
import { closeCaptureMenu, positionCaptureMenu, toggleCaptureMenu } from '../editor/capture-menu';
import { captureProperties } from '../editor/capture-properties';
import { captureGuide } from './capture-guide';
import { captureMessage } from './capture-message';
import { movableCaptureToolbar } from '../editor/capture-toolbar';
import { strokeStyleControl } from '../editor/stroke-style-control';
let annotations: AnnotationEditor;
let propertyUI: ReturnType<typeof captureProperties> | undefined;
let watermarkBar: ReturnType<typeof watermarkToolbar> | undefined;
let effectsUI: ReturnType<typeof mountOutputEffects>;
let workflowId = '';
import type { CandidateUpdate, CaptureCandidate } from '../../shared/capture/capture-detection';
import { candidateContains, stableCandidates } from '../../shared/capture/capture-detection';
import {
  maskContains,
  remapSelectionMask,
  type CaptureSelectionMode,
} from '../../shared/capture/capture-selection';
import { CaptureSelection } from './capture-selection';
import { captureSource } from './capture-source';

const api = window.one.capture!;
const rememberedStyles = annotationPreferences(document,{},(tool,style)=>api.saveAnnotationStyle(data.token,tool,style),value=>error(value));
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select=(id:string)=>selectSource(q(id))!;
const canvas = q<HTMLCanvasElement>('capture-preview');
let source: HTMLImageElement | HTMLCanvasElement = q<HTMLImageElement>('screen');
const panel = q('capture-actions'),
  selectionNode = q('selection'),
  textForm = q<HTMLFormElement>('capture-text');
const guide = captureGuide(q('capture-hint'));
const feedback = captureMessage(
  q('capture-message'),
  [panel, q('capture-properties'), q('capture-side'), q('capture-selection-mode'), textForm],
  () => draw(true),
);
const movableToolbar = movableCaptureToolbar(panel, q<HTMLButtonElement>('capture-drag'), () =>
  draw(true),
);
const movableSide = movableCaptureToolbar(
  q('capture-side'),
  q<HTMLButtonElement>('capture-side-drag'),
  () => draw(true),
);
strokeStyleControl(select('mark-stroke'));
let data: CaptureData,
  history: ImageHistory,
  scene: ImageDocument,
  tool: CaptureTool = 'select',
  selectedId = '',
  busy = false,
  frame = 0,
  ratio = 0;
let ratioMode = 0;
let refreshing = false;
const brushCursor = annotationBrushCursor(document.body, q('brush-cursor'));
let view = { x: 0, y: 0, width: innerWidth, height: innerHeight };
let sceneDirty = true;
let textTarget: Annotation | undefined;
const annotationSelection = new AnnotationSelection(
  q('annotation-selection'),
  q('annotation-handles'),
);
let pointer: Point | null = null;
let pointerOverControls = false;
let colorFormat: 'hex' | 'rgb' = 'hex';
let globalCoordinates = true;
let shiftOnly = false;
let sampledColor = '';
let candidates: CaptureCandidate[] = [];
let candidateIndex = 0;
let candidatePoint: Point | null = null;
let candidateCycled = false;
let candidatePartial = true;
let displayedCandidate: CaptureCandidate | undefined;
let candidateFallbackAt = 0;
let candidateFallbackTimer: ReturnType<typeof setTimeout> | undefined;
let detectionVersion = 0;
let detectionTimer: ReturnType<typeof setTimeout> | undefined;
let detectionPending: Promise<void> | undefined;
let lastDetection = 0;
let selectionCommand = Promise.resolve();
let gesture:
  | {
      kind: 'select' | 'move-region' | 'resize';
      start: Point;
      before: ImageDocument;
      handle?: SelectionHandle;
      candidate?: CaptureCandidate;
      moved?: boolean;
      mark?: Annotation;
    }
  | undefined;
const shapedSelection = new CaptureSelection({
  get: () => history.value,
  preview: (value) => {
    scene = value;
    draw();
  },
  commit: (value) => commit(value),
  changed: () => draw(true),
  error: (value) => error(value),
});
let modeHeld = false;
const typingTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input,textarea,select,[contenteditable=true],[role=combobox],.select-popup,.color-picker-panel',
  );
function holdCaptureModes(held: boolean) {
  if (
    held &&
    (data?.purpose !== 'capture' || busy || gesture || annotations?.active || !textForm.hidden)
  )
    return;
  if (modeHeld === held) return;
  modeHeld = held;
  document.body.classList.toggle('choosing-capture-mode', held);
  q('capture-selection-mode').hidden = !held;
  if (held) closeCaptureMenu();
  draw();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Control' && !e.repeat && !typingTarget(e.target)) holdCaptureModes(true);
});
function selectCaptureMode(mode: CaptureSelectionMode) {
  if (busy || gesture || annotations.active || !textForm.hidden || mode === shapedSelection.mode)
    return;
  stopDetection();
  setTool('select');
  ratio = ratioMode = 0;
  shapedSelection.setMode(mode);
  q('capture-message').textContent =
    shapedSelection.mode === 'polygon'
      ? '逐点单击 · Backspace 或右键回退 · Enter / 双击完成 · Esc 取消绘制'
      : shapedSelection.mode === 'free'
        ? '按住鼠标绘制，松开闭合选区；轮廓外透明'
        : '';
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-selection-mode]')) {
  const icon = { rectangle: SquareDashed, free: Lasso, polygon: Waypoints }[
    button.dataset.selectionMode as CaptureSelectionMode
  ];
  button.prepend(createElement(icon, { 'aria-hidden': 'true' }));
  button.onclick = () => selectCaptureMode(button.dataset.selectionMode as CaptureSelectionMode);
}
q('selection-back').onclick = () => shapedSelection.back();
function finishShapedSelection() {
  if (shapedSelection.finish() && data.autoCopy) void output('copy');
}
q('selection-finish').onclick = finishShapedSelection;
q('selection-cancel').onclick = () => shapedSelection.cancel();
let precisePointer: Point | null = null;
let preciseNativePoint: Point | null = null;
let cursorRevision = 0;
const point = (e: PointerEvent | MouseEvent): Point => {
  if (precisePointer) {
    // A scaled image pixel may fall between physical cursor positions. Keep the
    // keyboard's exact source pixel through the rounded native move and click.
    const tolerance = 0.5 / devicePixelRatio + 0.001;
    if (
      preciseNativePoint &&
      Math.abs(e.clientX - preciseNativePoint.x) <= tolerance &&
      Math.abs(e.clientY - preciseNativePoint.y) <= tolerance
    ) {
      return { ...precisePointer };
    }
    precisePointer = null;
    preciseNativePoint = null;
    cursorRevision++;
  }
  return {
    x: limit(Math.round(((e.clientX - view.x) * scene.width) / view.width), 0, scene.width),
    y: limit(Math.round(((e.clientY - view.y) * scene.height) / view.height), 0, scene.height),
  };
};
const cssPoint = (p: Point) => ({
  x: view.x + (p.x / scene.width) * view.width,
  y: view.y + (p.y / scene.height) * view.height,
});
function anchorPointer(p: Point) {
  precisePointer = data.detection ? null : { ...p };
  const at = cssPoint(p);
  preciseNativePoint = precisePointer
    ? {
        x: limit(Math.round(at.x), 0, innerWidth - 1),
        y: limit(Math.round(at.y), 0, innerHeight - 1),
      }
    : null;
}
async function positionCursor(p: Point) {
  const revision = ++cursorRevision;
  anchorPointer(p);
  // A running dev window may still have the previous preload until restart.
  if (!data.detection && typeof api.cursorTarget === 'function') {
    const width = innerWidth,
      height = innerHeight,
      ratio = devicePixelRatio;
    // Resolve the physical round trip before moving. A window's physical origin
    // can be fractional in CSS pixels even when its DIP bounds are integers.
    let target: Point;
    try {
      target = await api.cursorTarget(data.token, p);
    } catch (failure) {
      if (revision !== cursorRevision) return;
      precisePointer = null;
      preciseNativePoint = null;
      throw failure;
    }
    if (revision !== cursorRevision || !samePoint(precisePointer, p)) return;
    if (width !== innerWidth || height !== innerHeight || ratio !== devicePixelRatio) {
      precisePointer = null;
      preciseNativePoint = null;
      cursorRevision++;
      return;
    }
    preciseNativePoint = target;
  }
  await api.moveCursor(data.token, p);
}
const samePoint = (a: Point | null, b: Point | null) => !!a && !!b && a.x === b.x && a.y === b.y;
const sameRect = (a: CaptureCandidate['rect'], b: CaptureCandidate['rect']) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const inPanel = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    '.capture-panel,.capture-menu,.select-popup,[popover],.inline-annotation-editor,.select-popup,.color-picker-panel,dialog',
  );
function updateCandidates(update: CandidateUpdate) {
  if (
    !scene ||
    (!samePoint(pointer, update.point) &&
      (!pointer ||
        !update.candidates.some((c) => c.kind === 'element' && candidateContains(c, pointer!)) ||
        !update.candidates.some(
          (c) =>
            c.kind === 'window' &&
            candidates.some((old) => old.kind === 'window' && sameRect(old.rect, c.rect)),
        ))) ||
    busy ||
    gesture ||
    scene.selection ||
    tool !== 'select'
  )
    return;
  const old = candidateCycled ? candidates[candidateIndex] : undefined;
  candidatePoint = pointer;
  candidates = stableCandidates(candidates, { ...update, point: pointer! });
  candidateIndex = old
    ? Math.max(
        0,
        candidates.findIndex((c) => c.kind === old.kind && sameRect(c.rect, old.rect)),
      )
    : 0;
  q('candidate-label').dataset.partial = String(update.partial);
  candidatePartial = update.partial;
  draw(true);
}
api.onCandidates(updateCandidates);
function stopDetection(preserve = false) {
  detectionVersion++;
  clearTimeout(detectionTimer);
  detectionTimer = undefined;
  if (!preserve) {
    clearTimeout(candidateFallbackTimer);
    displayedCandidate = undefined;
    candidateFallbackAt = 0;
    candidates = [];
    candidatePoint = null;
    candidateCycled = false;
    candidateIndex = 0;
  }
}
function detect(immediate = false): Promise<void> | undefined {
  if (shapedSelection.mode !== 'rectangle' || shapedSelection.active) return;
  if (!data?.detection || !pointer || busy || gesture || scene.selection || tool !== 'select')
    return;
  clearTimeout(detectionTimer);
  detectionTimer = undefined;
  const delay = immediate
    ? 0
    : Math.min(40, Math.max(0, 100 - (performance.now() - lastDetection)));
  if (delay) {
    detectionTimer = setTimeout(() => {
      void detect(true);
    }, delay);
    return;
  }
  const at = { ...pointer },
    version = ++detectionVersion;
  lastDetection = performance.now();
  detectionPending = api
    .detect(data.token, at)
    .then((found) => {
      if (version === detectionVersion && !samePoint(candidatePoint, at))
        updateCandidates({ point: at, candidates: found, partial: false });
    })
    .catch(error);
  return detectionPending;
}
function hover(p: Point) {
  const next = { x: Math.min(scene.width - 1, p.x), y: Math.min(scene.height - 1, p.y) };
  if (samePoint(pointer, next)) return;
  pointer = next;
  const css = cssPoint(next);
  guide.pointer(css.x, css.y);
  const old = candidates[candidateIndex];
  stopDetection(true);
  candidates = candidates.filter((c) => candidateContains(c, next));
  candidateIndex = Math.max(0, candidates.indexOf(old));
  candidatePoint = candidates.length ? next : null;
  if (!candidates.includes(old)) candidateCycled = false;
  candidatePartial = true;
  void detect();
  draw(true);
}
function paintLocator() {
  let candidate =
    !scene.selection && !gesture && tool === 'select' && samePoint(pointer, candidatePoint)
      ? candidates[candidateIndex]
      : undefined;
  // Give the deeper provider a brief chance to replace its fast HWND fallback.
  // Keep presentation steady while crossing siblings; clicking still validates
  // that the displayed rectangle actually contains the current point.
  if (
    candidate &&
    !candidateCycled &&
    candidatePartial &&
    candidate.kind !== 'element' &&
    displayedCandidate?.kind === 'element'
  ) {
    candidateFallbackAt ||= performance.now();
    const remaining = 100 - (performance.now() - candidateFallbackAt);
    if (remaining > 0) {
      candidate = displayedCandidate;
      clearTimeout(candidateFallbackTimer);
      candidateFallbackTimer = setTimeout(() => draw(true), remaining + 1);
    }
  } else candidateFallbackAt = 0;
  displayedCandidate = candidate;
  const node = q('capture-candidate'),
    loupe = q('capture-loupe');
  node.dataset.animate = String(!node.hidden && !!candidate);
  node.hidden = !candidate || shapedSelection.mode !== 'rectangle' || shapedSelection.active;
  loupe.hidden =
    !pointer ||
    !!(
      pointer &&
      scene.selection &&
      (scene.selectionMask
        ? !maskContains(scene.selectionMask, pointer)
        : pointer.x < scene.selection.x ||
          pointer.y < scene.selection.y ||
          pointer.x > scene.selection.x + scene.selection.width ||
          pointer.y > scene.selection.y + scene.selection.height)
    ) ||
    pointerOverControls ||
    !!gesture ||
    shapedSelection.active ||
    tool !== 'select' ||
    !!textTarget ||
    busy;
  if (candidate) {
    const r = candidate.rect,
      p = cssPoint(r);
    Object.assign(node.style, {
      left: p.x + 'px',
      top: p.y + 'px',
      width: (r.width / scene.width) * view.width + 'px',
      height: (r.height / scene.height) * view.height + 'px',
    });
    const label = q('candidate-label');
    label.textContent =
      { window: '窗口', element: '界面元素', screen: '当前屏幕' }[candidate.kind] +
      ' · ' +
      r.width +
      ' × ' +
      r.height +
      ' px · ' +
      (candidateIndex + 1) +
      '/' +
      candidates.length;
    label.style.bottom = p.y > 30 ? 'calc(100% + 7px)' : 'auto';
    label.style.top = p.y > 30 ? 'auto' : '7px';
  }
  if (!loupe.hidden && pointer) {
    const p = cssPoint(pointer);
    const width = loupe.offsetWidth,
      height = loupe.offsetHeight;
    Object.assign(loupe.style, {
      left:
        limit(
          p.x + 22 + width <= innerWidth - 8 ? p.x + 22 : p.x - width - 22,
          8,
          Math.max(8, innerWidth - width - 8),
        ) + 'px',
      top:
        limit(
          p.y + 22 + height <= innerHeight - 8 ? p.y + 22 : p.y - height - 22,
          8,
          Math.max(8, innerHeight - height - 8),
        ) + 'px',
    });
    const zoom = q<HTMLCanvasElement>('loupe-image').getContext('2d', {
      willReadFrequently: true,
    })!;
    zoom.imageSmoothingEnabled = false;
    zoom.fillStyle = '#111111';
    zoom.fillRect(0, 0, 147, 147);
    const left = Math.max(0, pointer.x - 10),
      top = Math.max(0, pointer.y - 10),
      right = Math.min(scene.width, pointer.x + 11),
      bottom = Math.min(scene.height, pointer.y + 11);
    zoom.drawImage(
      source,
      left,
      top,
      right - left,
      bottom - top,
      (left - pointer.x + 10) * 7,
      (top - pointer.y + 10) * 7,
      (right - left) * 7,
      (bottom - top) * 7,
    );
    const rgb = zoom.getImageData(73, 73, 1, 1).data;
    const hex =
      '#' +
      [...rgb.subarray(0, 3)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    sampledColor = colorFormat === 'hex' ? hex : `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    q('loupe-color').textContent = sampledColor;
    q('loupe-swatch').style.backgroundColor = hex;
    zoom.strokeStyle = '#00000024';
    zoom.lineWidth = 1;
    zoom.beginPath();
    for (let i = 7; i < 147; i += 7) {
      zoom.moveTo(i + 0.5, 0);
      zoom.lineTo(i + 0.5, 147);
      zoom.moveTo(0, i + 0.5);
      zoom.lineTo(147, i + 0.5);
    }
    zoom.stroke();
    zoom.strokeStyle = '#000';
    zoom.lineWidth = 3;
    zoom.strokeRect(69.5, 69.5, 8, 8);
    zoom.strokeStyle = '#fff';
    zoom.lineWidth = 1;
    zoom.strokeRect(69.5, 69.5, 8, 8);
    const origin = globalCoordinates
      ? data.origin || { x: 0, y: 0 }
      : scene.selection || { x: 0, y: 0 };
    const x = globalCoordinates ? pointer.x + origin.x : pointer.x - origin.x,
      y = globalCoordinates ? pointer.y + origin.y : pointer.y - origin.y;
    q('loupe-position').textContent =
      (globalCoordinates ? '全局' : scene.selection ? '选区' : '屏幕') +
      ' · X ' +
      x +
      '  ·  Y ' +
      y +
      ' px';
  }
}
const error = (e: unknown) => {
  q('capture-message').textContent =
    e instanceof Error
      ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      : String(e);
};
function paint() {
  if (!scene) return;
  const scale = Math.min(innerWidth / scene.width, innerHeight / scene.height);
  view = {
    x: (innerWidth - scene.width * scale) / 2,
    y: (innerHeight - scene.height * scale) / 2,
    width: scene.width * scale,
    height: scene.height * scale,
  };
  Object.assign(canvas.style, {
    left: view.x + 'px',
    top: view.y + 'px',
    width: view.width + 'px',
    height: view.height + 'px',
    right: 'auto',
    bottom: 'auto',
  });
  // Preserve source pixels. Rounding DIP × DPI to a second bitmap size can
  // resample every edge on monitors with fractional scaling.
  const physicalWidth=view.width*devicePixelRatio,physicalHeight=view.height*devicePixelRatio;
  const nativeSize=Math.abs(physicalWidth-scene.width)<=1&&Math.abs(physicalHeight-scene.height)<=1;
  const width = nativeSize?scene.width:Math.max(1,Math.round(physicalWidth)),
    height = nativeSize?scene.height:Math.max(1,Math.round(physicalHeight));
  if (canvas.width !== width) {
    canvas.width = width;
    sceneDirty = true;
  }
  if (canvas.height !== height) {
    canvas.height = height;
    sceneDirty = true;
  }
  const updateEffects = sceneDirty;
  shapedSelection.paint(q<HTMLCanvasElement>('selection-outline'), scene, view);
  selectionNode.classList.toggle('shaped', !!scene.selectionMask);
  q('selection-draft-actions').hidden = !shapedSelection.active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-selection-mode]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.selectionMode === shapedSelection.mode),
    );
    button.disabled = busy || !!gesture || annotations?.active || !textForm.hidden;
  }
  if (sceneDirty) {
    if (textTarget) layoutText();
    const context = canvas.getContext('2d')!;
    context.setTransform(canvas.width / scene.width, 0, 0, canvas.height / scene.height, 0, 0);
    paintCapture(
      context,
      source,
      modeHeld ? { ...scene, selection: null } : textTarget ? textEditor.scene(scene) : scene,
    );
    sceneDirty = false;
  }
  if (updateEffects)
    effectsUI?.refresh(!q('capture-effects-menu').hidden && !gesture && !annotations.active);
  selectionNode.hidden = !scene.selection;
  panel.hidden = !scene.selection;
  q('start-scroll').hidden=!data.canScroll||!!scene.selectionMask||data.selectionMode==='free'||data.selectionMode==='polygon';
  q('capture-side').hidden = !scene.selection;
  q('capture-properties').hidden =
    !scene.selection ||
    ![...q('capture-properties').children].some((l) => !(l as HTMLElement).hidden);
  propertyUI?.refresh();
  const selected = scene.annotations.find((a) => a.id === selectedId);
  annotationSelection.refresh(
    scene,
    textTarget ? textEditor.selection : selected,
    tool,
    false,
    annotations.magnifierPart,
    cssPoint,
    scale,
  );
  if (textTarget) layoutText();
  const brush =
    tool === 'erasebrush' ||
    (['mosaic', 'blur'].includes(tool) && select('mark-mode').value === 'brush');
  brushCursor.refresh(
    pointer && cssPoint(pointer),
    Number(q<HTMLInputElement>('mark-size').value),
    scale,
    !!scene.selection && brush && !textTarget && !busy,
  );
  if (scene.selection) {
    const r = scene.selection,
      p = cssPoint(r);
    const selectionWidth = (r.width / scene.width) * view.width,
      selectionHeight = (r.height / scene.height) * view.height;
    Object.assign(selectionNode.style, {
      left: p.x + 'px',
      top: p.y + 'px',
      width: selectionWidth + 'px',
      height: selectionHeight + 'px',
    });
    q('dimensions').textContent = r.width + ' × ' + r.height + ' px';
    q('dimensions').style.bottom = p.y > 42 ? 'calc(100% + 9px)' : 'auto';
    q('dimensions').style.top = p.y > 42 ? 'auto' : '10px';
    const panelHeight = panel.offsetHeight,
      below = p.y + selectionHeight + 12;
    const top =
      below + panelHeight < innerHeight - 12
        ? below
        : p.y - panelHeight - 12 >= 12
          ? p.y - panelHeight - 12
          : Math.max(12, innerHeight - panelHeight - 12);
    const toolbarPosition = movableToolbar.place(p.x + selectionWidth - panel.offsetWidth, top);
    Object.assign(panel.style, { left: toolbarPosition.x + 'px', top: toolbarPosition.y + 'px' });
    const props = q('capture-properties'),
      propsHeight = props.hidden ? 0 : props.offsetHeight;
    // Keep tool parameters in their own bar. Prefer outside the selected image,
    // then reverse the pair near a screen edge instead of clipping controls.
    let propertyTop = toolbarPosition.y + panelHeight + 7;
    if (propertyTop + propsHeight > innerHeight - 8)
      propertyTop = Math.max(8, toolbarPosition.y - propsHeight - 7);
    Object.assign(props.style, {
      left: limit(parseFloat(panel.style.left), 8, innerWidth - props.offsetWidth - 8) + 'px',
      top: propertyTop + 'px',
    });
    const side = q('capture-side'),
      sideWidth = side.offsetWidth;
    const sideLeft =
      p.x + selectionWidth + sideWidth + 14 < innerWidth
        ? p.x + selectionWidth + 10
        : p.x - sideWidth - 10 >= 8
          ? p.x - sideWidth - 10
          : Math.max(8, p.x + selectionWidth - sideWidth - 10);
    const sidePosition = movableSide.place(sideLeft, p.y);
    Object.assign(side.style, { left: sidePosition.x + 'px', top: sidePosition.y + 'px' });
    positionCaptureMenu();
  } else closeCaptureMenu();
  q<HTMLButtonElement>('undo').disabled = !history.canUndo;
  q<HTMLButtonElement>('redo').disabled = !history.canRedo;
  for (const node of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLSelectElement
  >('.capture-panel button,.capture-panel input,.capture-panel select')) {
    if (['mosaic-apply', 'mosaic-dismiss', 'undo', 'redo', 'cancel'].includes(node.id)) continue;
    node.disabled = busy;
  }
  stepOrder.refresh();
  magnifierUI.refresh();
  imageWatermarkUI.refresh();
  sensitiveUI.refresh();
  mosaicUI.refresh();
  paintLocator();
  feedback.place();
  const avoid = shapedSelection.draftBounds || scene.selection;
  const point = avoid ? cssPoint(avoid) : null;
  guide.avoid(
    avoid && point
      ? { x: point.x, y: point.y, width: avoid.width * scale, height: avoid.height * scale }
      : null,
    [
      panel,
      q('capture-properties'),
      q('capture-side'),
      q('capture-selection-mode'),
      textForm,
      q('capture-loupe'),
    ],
  );
}
const stepOrder = stepOrderControls(
  q('capture-properties'),
  () => annotations,
  () => busy || !!gesture || !!annotations?.active || !textForm.hidden,
);
const magnifierUI = magnifierControls(q('capture-properties'), {
  editor: () => annotations,
  scene: () => scene,
  locked: () => busy || !!gesture || !!annotations?.active || !textForm.hidden,
  moveTool: (mark) => {
    setTool('move');
    annotations.select(mark);
  },
});
const imageWatermarkUI = imageWatermarkControls(q('watermark-image-controls'), {
  locked: () => busy || !!gesture || !!annotations?.active || !textForm.hidden,
  choose: () => api.chooseWatermarkImage(data.token),
  pending: (value) => {
    busy = value;
    draw();
  },
  change: (image, preview) => {
    const mark = scene.annotations.find((a) => a.id === selectedId && a.tool === 'watermark');
    if (mark)
      annotations.update(
        {
          watermark: {
            ...watermarkOptions(),
            capturedAt: mark.watermark?.capturedAt ?? data.capturedAt,
            image,
          },
        },
        preview,
      );
    if (!preview) saveWatermarkDefaults();
  },
  refresh: () => {
    properties(scene.annotations.find((a) => a.id === selectedId));
    draw();
  },
  error,
});
const sensitiveUI = sensitiveControls(q('sensitive-controls'), {
  api,
  token: () => data.token,
  locked: () => busy || !!gesture || !!annotations?.active || !textForm.hidden || !scene?.selection,
  document: () => history.value,
  source: () => source,
  pending: (value) => {
    busy = value;
    if (value) annotations.clear();
    draw();
  },
  preview: (value) => {
    scene = value;
    draw();
  },
  commit,
  message: (value) => {
    if (value instanceof Error) error(value);
    else q('capture-message').textContent = String(value);
  },
});
addEventListener('beforeunload', () => {
  feedback.dispose();
  if (sensitiveUI.active) void api.cancelSensitive(data.token).catch(() => {});
});
function draw(locatorOnly = false) {
  if (!locatorOnly) sceneDirty = true;
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
}
function commit(next: ImageDocument) {
  try {
    history.commit(next);
    scene = history.value;
    q('capture-message').textContent = '';
  } catch (e) {
    scene = history.value;
    error(e);
  }
  draw();
}
function setTool(next: CaptureTool) {
  if (busy || gesture || annotations?.active) return;
  if (textTarget) submitText();
  closeCaptureMenu();
  mosaicUI.stopChoosing();
  stopDetection();
  tool = next;
  toolUI.set(next);
  if (!annotations?.retainsSelection(next)) {
    annotations?.clear();
    selectedId = '';
  }
  if (!selectedId) rememberedStyles.restore(next);
  document
    .querySelectorAll<HTMLButtonElement>('[data-tool]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === next)));
  canvas.style.cursor = annotations?.cursor(next) || 'crosshair';
  properties();
  if (next === 'watermark' && scene.selection) {
    const existing = scene.annotations.find((a) => a.tool === 'watermark');
    if (existing) annotations.select(existing);
    else {
      const preset = data.watermark;
      imageWatermarkUI.fill(preset.image);
      q<HTMLInputElement>('mark-color').value = preset.color;
      q<HTMLInputElement>('mark-font').value = String(preset.fontSize);
      const family = select('mark-family');
      if (![...family.options].some((o) => o.value === preset.fontFamily)) {
        const option = document.createElement('option');
        option.value = option.textContent = preset.fontFamily;
        family.append(option);
      }
      family.value = preset.fontFamily;
      select('mark-weight').value = String(preset.fontWeight);
      annotations.watermark();
    }
  }
  draw();
  void detect();
}
function properties(mark?: Annotation) {
  const name = mark?.tool || tool,
    image = name === 'watermark' && !!(mark ? mark.watermark?.image : imageWatermarkUI.image),
    brush = !!(mark ? mark.brush : select('mark-mode').value === 'brush');
  showAnnotationProperties(document, name, brush, image);
  watermarkBar?.sync(name === 'watermark', image);
  mosaicUI.refresh();
}
const watermarkUI = watermarkControls(document, {
  locked: () => busy || !scene || !!gesture || !!annotations?.active,
  current: () => textTarget || scene?.annotations.find((a) => a.id === selectedId),
  timestamp: () => data.capturedAt,
  image: () => imageWatermarkUI.image,
  fillImage: (image) => imageWatermarkUI.fill(image),
  update: (style, preview) => {
    if (textTarget) {
      Object.assign(textTarget, style);
      q<HTMLTextAreaElement>('capture-text-value').value = style.text || '';
      layoutText();
    } else {
      annotations.update(style, preview);
      if (!preview) saveWatermarkDefaults();
    }
  },
  refresh: () => {
    properties(textTarget || scene.annotations.find((a) => a.id === selectedId));
    draw();
  },
  error,
});
function watermarkOptions(): WatermarkStyle {
  return watermarkUI.read();
}
function saveWatermarkDefaults() {
  const mark = scene.annotations.find((a) => a.id === selectedId && a.tool === 'watermark');
  if (!mark) return;
  const { capturedAt: _timestamp, ...style } = mark.watermark || watermarkOptions();
  const preset = {
    ...style,
    text: mark.text,
    color: mark.color,
    fontSize: mark.fontSize || 32,
    fontFamily: mark.fontFamily || 'Segoe UI',
    fontWeight: mark.fontWeight || 400,
  };
  data.watermark = preset;
  void api.saveWatermark(data.token, preset).catch(error);
}
bindAnnotationStyle(
  document,
  {},
  {
    locked: () => busy || !scene || !!gesture || annotations.active,
    update: (style, preview) => {
      if (!preview) rememberedStyles.remember(textTarget?.tool || scene.annotations.find(mark=>mark.id===selectedId)?.tool || tool);
      if (textTarget) {
        Object.assign(textTarget, style);
        layoutText();
        draw();
        return;
      }
      if (!selectedId) return;
      annotations.update(style, preview);
      if (!preview) saveWatermarkDefaults();
    },
  },
);
const toolUI = groupedAnnotationTools(q('annotation-tools'), setTool);
bindAnnotationFonts(document, () => api.fonts());
q('mark-mode').onchange = () => {
  rememberedStyles.remember(tool);
  annotations?.clear();
  properties();
  draw();
};
const mosaicUI = mosaicControls(q('mosaic-controls'), {
  document: () => history.value,
  source: () => source,
  selected: () => scene.annotations.find((a) => a.id === selectedId),
  locked: () => busy || !!gesture || !!annotations?.active || !textForm.hidden,
  pending: (value) => {
    busy = value;
    draw();
  },
  preview: (value) => {
    scene = value;
    draw();
  },
  commit,
  select: (mark) => annotations.select(mark),
  choose: () => {
    select('mark-mode').value = 'rectangle';
    setTool('mosaic');
  },
  strength: () => Number(q<HTMLInputElement>('mark-strength').value),
  message: (value) => {
    if (value instanceof Error) error(value);
    else q('capture-message').textContent = String(value);
  },
});
for (const [name, glyph] of [
  ['capture-drag', GripVertical],
  ['capture-side-drag', GripHorizontal],
  ['undo', Undo2],
  ['redo', Redo2],
  ['refresh', RefreshCw],
  ['retry', Scan],
  ['pin', Pin],
  ['save', Download],
  ['cancel', X],
  ['copy', Check],
  ['region-confirm', Check],
  ['aspect', Ratio],
  ['capture-more', Ellipsis],
  ['capture-effects', SlidersHorizontal],
  ['run-workflow', Play],
  ['ocr', ScanText],
  ['translate', Languages],
  ['start-scroll', GalleryHorizontal],
] as const)
  q(name).append(createElement(glyph, { class: 'icon', 'aria-hidden': 'true' }) as unknown as Node);
q('library')
  .querySelector('[data-menu-icon]')!
  .append(createElement(Images, { class: 'icon', 'aria-hidden': 'true' }));
q('more-ocr')
  .querySelector('[data-menu-icon]')!
  .append(createElement(ScanText, { class: 'icon', 'aria-hidden': 'true' }));
for(const [id,glyph] of [['more-translate',Languages],['formula',Sigma]] as const)q(id).querySelector('[data-menu-icon]')!.append(createElement(glyph,{class:'icon','aria-hidden':'true'}));
for (const [handle, x, y] of [
  ['nw', 0, 0],
  ['n', 50, 0],
  ['ne', 100, 0],
  ['e', 100, 50],
  ['se', 100, 100],
  ['s', 50, 100],
  ['sw', 0, 100],
  ['w', 0, 50],
] as const) {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.handle = handle;
  node.ariaLabel = '调整选区 ' + handle;
  node.style.left = x + '%';
  node.style.top = y + '%';
  node.style.cursor = handle + '-resize';
  q('selection-handles').append(node);
}
function markAt(p: Point) {
  return annotations.markAt(p);
}
const textEditor = new InlineAnnotationText(
  textForm,
  q<HTMLTextAreaElement>('capture-text-value'),
  {
    area: () => scene.selection!,
    position: (point) => cssPoint(point),
    scale: () => view.width / scene.width,
    selected: (mark) => annotations.select(mark),
    existing: (id) => history.value.annotations.find((mark) => mark.id === id),
    commit: (mark, text) => annotations.text(mark, text),
    remove: (id) => annotations.remove(id),
    changed: (mark) => {
      textTarget = mark;
      draw();
    },
    input: (mark, text) => {
      if (mark.tool === 'watermark') q<HTMLInputElement>('watermark-text').value = text;
    },
    accepted: () => saveWatermarkDefaults(),
  },
);
function editText(mark: Annotation) {
  textEditor.open(mark);
}
function layoutText() {
  textEditor.layout();
}
function submitText() {
  textEditor.submit();
}
q('text-cancel').onclick = () => textEditor.cancel();
function pointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement;
  if (textTarget && !textForm.contains(target) && !inPanel(target) && e.button === 0) submitText();
  if (busy || !scene || !textForm.hidden || inPanel(target)) return;
  if (modeHeld) return;
  if (e.button !== 0) return;
  const p = point(e),
    before = history.value;
  if (annotationSelection.begin(e, p, annotations)) return;
  const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as
    | SelectionHandle
    | undefined;
  const region = before.selection;
  const inside =
    region &&
    (before.selectionMask
      ? maskContains(before.selectionMask, p)
      : p.x >= region.x &&
        p.x <= region.x + region.width &&
        p.y >= region.y &&
        p.y <= region.y + region.height);
  if (
    tool === 'select' &&
    !handle &&
    (shapedSelection.active || !inside) &&
    shapedSelection.down(p, e)
  ) {
    stopDetection();
    return;
  }
  if (handle && scene.selection) gesture = { kind: 'resize', start: p, before, handle };
  else if (tool === 'select') {
    gesture = {
      kind: inside ? 'move-region' : 'select',
      start: p,
      before,
      candidate:
        samePoint(pointer, candidatePoint) &&
        samePoint(pointer, {
          x: Math.min(scene.width - 1, p.x),
          y: Math.min(scene.height - 1, p.y),
        })
          ? displayedCandidate && candidateContains(displayedCandidate, p)
            ? displayedCandidate
            : undefined
          : undefined,
    };
    if (!inside) {
      scene = { ...before, selection: null, selectionMask: undefined };
      panel.hidden = true;
    }
  } else if (annotations.down(tool, p)) {
    // Text opens its editor during pointerdown. Prevent the ensuing browser
    // mousedown from focusing the canvas and immediately blurring that editor.
    e.preventDefault();
    if (annotations.active) {
      stopDetection();
      target.setPointerCapture?.(e.pointerId);
    }
    return;
  }
  if (gesture) {
    stopDetection();
    e.preventDefault();
    (target instanceof Element ? target : canvas).setPointerCapture?.(e.pointerId);
  }
}
document.addEventListener('pointerdown', pointerDown);
document.addEventListener('pointermove', (e) => {
  guide.pointer(e.clientX, e.clientY);
  const overControls = !!inPanel(e.target) || textForm.contains(e.target as Node);
  if (pointerOverControls !== overControls) {
    pointerOverControls = overControls;
    draw(true);
  }
  if (overControls) {
    brushCursor.hide();
    return;
  }
  if (!scene || busy || !textForm.hidden || inPanel(e.target)) return;
  canvas.style.cursor = annotations.cursor(tool, point(e));
  if (shapedSelection.move(point(e), e)) return;
  if (annotations.active) {
    pointer = point(e);
    annotations.move(point(e), e.shiftKey);
    return;
  }
  if (!gesture) {
    hover(point(e));
    return;
  }
  const p = point(e),
    g = gesture,
    next = { ...g.before, annotations: [...g.before.annotations] };
  pointer = p;
  if (Math.hypot(p.x - g.start.x, p.y - g.start.y) >= 3) g.moved = true;
  if (g.kind === 'select') {
    next.selectionMask = undefined;
    const selection = selectionFrom(
      g.start,
      p,
      scene.width,
      scene.height,
      ratio || (e.shiftKey ? 1 : 0),
    );
    if (selection.width >= 2 && selection.height >= 2) next.selection = selection;
  } else if (g.kind === 'move-region')
    next.selection = shiftSelection(
      g.before.selection!,
      p.x - g.start.x,
      p.y - g.start.y,
      scene.width,
      scene.height,
    );
  else if (g.kind === 'resize')
    next.selection = resizeSelection(
      g.before.selection!,
      g.handle!,
      p,
      scene.width,
      scene.height,
      ratio || (e.shiftKey ? g.before.selection!.width / g.before.selection!.height : 0),
    );
  scene = next;
  if (g.before.selectionMask && g.before.selection && next.selection && g.kind !== 'select')
    scene.selectionMask = remapSelectionMask(
      g.before.selectionMask,
      g.before.selection,
      next.selection,
    );
  draw();
});
document.addEventListener('pointerup', (e) => {
  if (!scene) return;
  const shaped = shapedSelection.up(point(e), e);
  if (shaped) {
    if (shaped === 'completed' && data.autoCopy) void output('copy');
    return;
  }
  if (annotations?.active) {
    annotations.up(scene);
    mosaicUI.drawn();
    return;
  }
  if (!gesture) return;
  const g = gesture;
  gesture = undefined;
  if (g.kind === 'select' && !g.moved) {
    scene = g.candidate
      ? { ...g.before, selection: { ...g.candidate.rect }, selectionMask: undefined }
      : g.before;
  }
  commit(scene);
  if (g.kind === 'select' && scene.selection && data.autoCopy) void output('copy');
  if (!scene.selection) {
    pointer = null;
    hover(point(e));
  }
});
document.addEventListener('pointercancel', () => {
  shapedSelection.cancel();
  gesture = undefined;
  annotations?.cancel();
  scene = history.value;
  draw();
  void detect(true);
});
document.addEventListener(
  'wheel',
  (e) => {
    if (
      scene?.selection ||
      gesture ||
      busy ||
      tool !== 'select' ||
      !candidates.length ||
      inPanel(e.target)
    )
      return;
    e.preventDefault();
    candidateCycled = true;
    candidateIndex =
      (candidateIndex + (e.deltaY > 0 ? 1 : -1) + candidates.length) % candidates.length;
    draw(true);
  },
  { passive: false },
);
canvas.addEventListener('dblclick', (e) => {
  if (shapedSelection.active && shapedSelection.mode === 'polygon') {
    e.preventDefault();
    finishShapedSelection();
    return;
  }
  if (busy || !['move', 'text', 'watermark'].includes(tool)) return;
  const mark = markAt(point(e));
  if (mark && ['text', 'watermark'].includes(mark.tool) && !mark.watermark?.image) editText(mark);
});
function receipts(result: CaptureResult) {
  const list = q('capture-workflow-receipts');
  q('capture-receipts-title').hidden = result.receipts.length === 0;
  list.replaceChildren();
  for (const receipt of result.receipts) {
    const row = document.createElement('li'),
      name = document.createElement('span'),
      status = document.createElement('span');
    name.textContent = actionNames[receipt.action];
    status.textContent = {
      completed: '已完成',
      pending: '未执行',
      canceled: '已取消',
      failed: '失败',
    }[receipt.status];
    row.dataset.status = receipt.status;
    row.append(name, status);
    list.append(row);
  }
}
function setWorkflow() {
  const preset = data.workflows.find((p) => p.id === workflowId)!;
  q('capture-workflow-order').textContent =
    preset.actions.map((a) => actionNames[a]).join(' → ') +
    (preset.actions.includes('translate')
      ? ' · 译为' + translationLanguages[preset.translationTarget ?? 'zh-Hans']
      : '');
}
async function output(action?: CaptureAction) {
  if (busy || !scene?.selection || gesture || shapedSelection.active || annotations.active) return;
  if (textTarget) submitText();
  closeCaptureMenu();
  busy = true;
  panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  q('capture-message').textContent = '正在输出…';
  let exported: HTMLCanvasElement | undefined;
  try {
    await initialFonts;
    const request = {
      token: data.token,
      selection: scene.selection,
      workflowId: action || data.purpose !== 'capture' ? undefined : workflowId,
      actions:
        data.purpose === 'region'
          ? []
          : action
            ? [action]
            : data.workflows.find((p) => p.id === workflowId)!.actions,
      png: undefined as string | undefined,
      effects: data.purpose === 'capture' ? scene.effects : undefined,
      document: data.purpose === 'capture' ? scene : undefined,
      history: data.purpose === 'capture' ? history.snapshot : undefined,
      originalPng: undefined as string | undefined,
    };
    if (data.purpose === 'capture') {
      exported = captureOutput(source, scene);
      request.png = await canvasPng(exported);
      if (data.composition) {
        const original = document.createElement('canvas');
        original.width = data.width;
        original.height = data.height;
        original.getContext('2d')!.drawImage(source, 0, 0);
        request.originalPng = await canvasPng(original);
        original.width = original.height = 0;
      }
    }
    const result = await api.complete(request);
    receipts(result);
    if (!result.completed)
      q('capture-message').textContent =
        result.error || '已取消保存，可以继续编辑；再次执行相同流程会继续未完成的步骤';
  } catch (e) {
    error(e);
  } finally {
    if (exported) exported.width = exported.height = 0;
    busy = false;
    panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = false));
    draw();
  }
}
for (const action of ['copy', 'save', 'pin', 'library', 'ocr', 'translate', 'formula'] as const)
  q(action).onclick = () => void output(action);
q('more-ocr').onclick=()=>void output('ocr');
q('more-translate').onclick=()=>void output('translate');
q('start-scroll').onclick=()=>{if(busy||!scene.selection||scene.selectionMask||!data.canScroll)return;busy=true;draw();void api.startScroll(data.token,scene.selection).catch(error).finally(()=>{busy=false;draw();});};
q('region-confirm').onclick = () => void output();
q('run-workflow').onclick = () => void output();
q('capture-more').onclick = () => toggleCaptureMenu(q('capture-more-menu'), q('capture-more'));
q('capture-effects').onclick = () => {
  toggleCaptureMenu(q('capture-effects-menu'), q('capture-effects'), { side: true });
  effectsUI?.refresh(!q('capture-effects-menu').hidden);
};
q('cancel').onclick = () => {
  if (sensitiveUI.active) {
    void sensitiveUI.cancel();
    return;
  }
  if (mosaicUI.active) mosaicUI.cancel();
  if (!busy || refreshing) void api.complete(null).catch(error);
};
q('retry').onclick = () => {
  selectedId = '';
  setTool('select');
  shapedSelection.cancel();
  commit({ ...history.value, selection: null, selectionMask: undefined });
  void detect(true);
};
q('undo').onclick = () => {
  if (busy || gesture || annotations.active || !textForm.hidden) return;
  annotations.clear();
  history.undo();
  scene = history.value;
  selectedId = '';
  draw();
};
q('redo').onclick = () => {
  if (busy || gesture || annotations.active || !textForm.hidden) return;
  annotations.clear();
  history.redo();
  scene = history.value;
  selectedId = '';
  draw();
};
q('aspect').onclick = () => {
  if (busy || !scene?.selection) return;
  ratioMode = (ratioMode + 1) % 5;
  ratio = [0, scene.selection!.width / scene.selection!.height, 1, 16 / 9, 4 / 3][ratioMode];
  q('aspect').title = q('aspect').ariaLabel =
    '比例：' + ['自由', '锁定当前比例', '1:1', '16:9', '4:3'][ratioMode] + ' · 点击切换';
  q('aspect').setAttribute('aria-pressed', String(!!ratio));
};
async function refresh() {
  if (shapedSelection.active) return;
  if (busy || gesture || annotations.active || !textForm.hidden) return;
  busy = true;
  refreshing = true;
  stopDetection();
  q('capture-message').textContent = '正在刷新画面…';
  try {
    const next = await api.refresh(data.token);
    let decoded: Awaited<ReturnType<typeof captureSource>>;
    try {
      decoded = await captureSource(next);
      await api.refreshReady(data.token, next.revision, true);
    } catch (e) {
      await api.refreshReady(data.token, next.revision, false).catch(() => {});
      throw e;
    }
    source = decoded;
    data = next;
    precisePointer = null;
    preciseNativePoint = null;
    cursorRevision++;
    q('capture-message').textContent = '底图已刷新，选区与标注已保留';
    draw();
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    refreshing = false;
    void detect(true);
  }
}
q('refresh').onclick = () => void refresh();
document.addEventListener('keydown', (e) => {
  if (!e.isComposing && e.key === 'Escape' && sensitiveUI.active) {
    e.preventDefault();
    void sensitiveUI.cancel();
    return;
  }
  if (stepOrder.keydown(e)) return;
  if (e.key !== 'Shift') shiftOnly = false;
  if (e.isComposing || !scene) return;
  if (mosaicUI.active && e.key === 'Escape') {
    e.preventDefault();
    mosaicUI.cancel();
    return;
  }
  if (refreshing && e.key === 'Escape') {
    e.preventDefault();
    void api.complete(null).catch(error);
    return;
  }
  if (busy) return;
  if (
    e.target instanceof Element &&
    e.target.closest('.select-popup,.color-picker-panel,[role=combobox],.capture-menu')
  )
    return;
  if (!textForm.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      q('text-cancel').click();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      submitText();
    }
    return;
  }
  if (
    e.target instanceof Element &&
    e.target.closest('.capture-menu,button') &&
    ['Enter', ' '].includes(e.key)
  )
    return;
  if (
    e.target instanceof Element &&
    e.target.closest('input,textarea,select,[contenteditable=true]')
  )
    return;
  if (
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    ['1', '2', '3'].includes(e.key) &&
    data.purpose === 'capture' &&
    !typingTarget(e.target)
  ) {
    if (
      e.repeat ||
      gesture ||
      annotations.active ||
      (e.target instanceof Element && e.target.closest('[contenteditable=true]'))
    )
      return;
    e.preventDefault();
    selectCaptureMode((['rectangle', 'free', 'polygon'] as const)[Number(e.key) - 1]);
    return;
  }
  if (shapedSelection.active) {
    if (['Escape', 'Backspace', 'Delete', 'Enter'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') shapedSelection.cancel();
      else if (e.key === 'Enter') finishShapedSelection();
      else shapedSelection.back();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      shapedSelection.back();
    }
    return;
  }
  if (e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
    shiftOnly = true;
    return;
  }
  if (
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    ['c', 'p'].includes(e.key.toLowerCase())
  ) {
    if (gesture || annotations.active || tool !== 'select' || pointerOverControls || !pointer)
      return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.key.toLowerCase() === 'p') {
      globalCoordinates = !globalCoordinates;
      draw(true);
    } else {
      paintLocator();
      const color = sampledColor;
      if (color)
        void api
          .copyColor(data.token, color)
          .then(() => {
            q('capture-message').textContent = '已复制颜色 ' + color;
          })
          .catch(error);
    }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    void api.complete(null).catch(error);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void output();
  } else if (e.key === 'F5') {
    e.preventDefault();
    void refresh();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const selectWindow = async () => {
      if (busy || gesture || annotations.active) return;
      const choices =
        data.detection && pointer ? await api.detect(data.token, pointer) : candidates;
      if (busy || gesture || annotations.active) return;
      annotations.clear();
      const window = choices.find((c) => c.kind === 'window');
      const whole = { x: 0, y: 0, width: scene.width, height: scene.height };
      const selection =
        window && (!scene.selection || !sameRect(scene.selection, window.rect))
          ? window.rect
          : whole;
      commit({ ...history.value, selection: { ...selection }, selectionMask: undefined });
      if (data.autoCopy) void output('copy');
    };
    selectionCommand = selectionCommand.then(selectWindow).catch(error);
  } else if (e.ctrlKey && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    (e.key.toLowerCase() === 'y' || e.shiftKey ? q('redo') : q('undo')).click();
  } else if (e.key === 'Delete' && selectedId) {
    e.preventDefault();
    if (!gesture && !annotations.active) annotations.remove();
  } else if (
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    ['w', 'a', 's', 'd'].includes(e.key.toLowerCase())
  ) {
    if (gesture || annotations.active) return;
    e.preventDefault();
    const key = e.key.toLowerCase(),
      amount = e.shiftKey ? 10 : 1;
    const current = pointer || { x: Math.floor(scene.width / 2), y: Math.floor(scene.height / 2) };
    const next = {
      x: limit(current.x + (key === 'a' ? -amount : key === 'd' ? amount : 0), 0, scene.width - 1),
      y: limit(current.y + (key === 'w' ? -amount : key === 's' ? amount : 0), 0, scene.height - 1),
    };
    hover(next);
    void positionCursor(next).catch(error);
    draw(true);
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    if (gesture || annotations.active) return;
    e.preventDefault();
    const amount = e.shiftKey ? 10 : 1,
      dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0,
      dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0,
      next = history.value;
    if (!scene.selection) {
      if (!pointer) return;
      pointer = {
        x: limit(pointer.x + dx, 0, scene.width - 1),
        y: limit(pointer.y + dy, 0, scene.height - 1),
      };
      void positionCursor(pointer).catch(error);
      stopDetection();
      void detect(true);
      draw();
      return;
    }
    if (selectedId && e.altKey) {
      annotations.nudge(dx, dy);
      return;
    } else if (e.ctrlKey)
      next.selection = resizeSelection(
        scene.selection,
        'se',
        {
          x: scene.selection.x + scene.selection.width + dx,
          y: scene.selection.y + scene.selection.height + dy,
        },
        scene.width,
        scene.height,
        ratio,
      );
    else next.selection = shiftSelection(scene.selection, dx, dy, scene.width, scene.height);
    if (scene.selectionMask && next.selection)
      next.selectionMask = remapSelectionMask(scene.selectionMask, scene.selection, next.selection);
    commit(next);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') holdCaptureModes(false);
  if (e.key !== 'Shift') return;
  if (
    shiftOnly &&
    !busy &&
    !gesture &&
    !annotations.active &&
    textForm.hidden &&
    tool === 'select' &&
    !(
      e.target instanceof Element &&
      e.target.closest(
        'input,textarea,[role=combobox],.capture-menu,.select-popup,.color-picker-panel',
      )
    )
  ) {
    colorFormat = colorFormat === 'hex' ? 'rgb' : 'hex';
    draw(true);
  }
  shiftOnly = false;
});
document.addEventListener(
  'pointerdown',
  () => {
    shiftOnly = false;
  },
  true,
);
window.addEventListener('blur', () => {
  holdCaptureModes(false);
  shapedSelection.cancel();
  shiftOnly = false;
});
document.addEventListener('contextmenu', (e) => {
  if (shapedSelection.active) {
    e.preventDefault();
    shapedSelection.back();
    return;
  }
  if (inPanel(e.target)) return;
  e.preventDefault();
  if (annotations?.active) annotations.cancel();
  else if (gesture) {
    gesture = undefined;
    scene = history.value;
    draw();
  } else if (!busy || refreshing) void api.complete(null).catch(error);
});
addEventListener('resize', () => {
  precisePointer = null;
  preciseNativePoint = null;
  cursorRevision++;
  draw();
});
async function loadImage(value: CaptureData) {
  // Decode/validate away from the live source. A failed refresh must leave the
  // previous bitmap available for editing and output.
  source = await captureSource(value);
}
let initialFonts:Promise<void>=Promise.resolve();
void api
  .data()
  .then(async (initial) => {
    data = initial;
    rememberedStyles.load(initial.annotationStyles);
    applyCaptureScale(document.body,initial.uiScale);
    initialFonts=Promise.all([...new Set([initial.watermark.fontFamily,...Object.values(initial.annotationStyles||{}).map(style=>style.fontFamily)])].map(loadAnnotationFont)).then(()=>{});
    // Font discovery must not delay showing an unannotated desktop snapshot.
    // Output still waits for the selected document fonts before rasterization.
    void initialFonts.catch(()=>{});
    shapedSelection.mode = initial.selectionMode || 'rectangle';
    q('capture-selection-mode').hidden = true;
    const watermark = initial.watermark;
    watermarkUI.fill({ ...watermark, capturedAt: initial.capturedAt }, watermark.text);
    await loadImage(initial);
    workflowId = initial.workflowId;
    const preset = initial.workflows.find((p) => p.id === workflowId)!;
    history = new ImageHistory(
      initial.width,
      initial.height,
      initial.selected,
      initial.purpose === 'capture' && !initial.autoCopy ? preset.effects : defaultEffects(),
    );
    if (initial.initialSelection)
      history.commit({ ...history.value, selection: initial.initialSelection });
    scene = history.value;
    annotations = new AnnotationEditor({
      history,
      style: () => readAnnotationStyle(document, tool, {}, watermarkOptions()),
      tolerance: () => (5 * scene.width) / view.width,
      measure: (mark) => textEditor.measured(mark),
      changed: (next, committed) => {
        scene = next;
        if (committed) q('capture-message').textContent = '';
        draw();
      },
      selected: (mark) => {
        selectedId = mark?.id || '';
        if (mark) {
          fillAnnotationStyle(document, mark);
          if (mark.tool === 'watermark')
            watermarkUI.fill(
              mark.watermark || {
                position: 'custom',
                opacity: 1,
                angle: 0,
                spacing: 60,
                capturedAt: data.capturedAt,
              },
              mark.text,
            );
        }
        properties(mark);
        draw();
      },
      text: editText,
      error,
    });
    if (initial.purpose === 'capture') {
      const choice = select('capture-workflow-choice');
      for (const preset of initial.workflows) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        choice.append(option);
      }
      choice.value = workflowId;
      choice.onchange = () => {
        if (busy || gesture || annotations.active || !textForm.hidden) {
          choice.value = workflowId;
          return;
        }
        workflowId = choice.value;
        commit({
          ...history.value,
          effects: data.workflows.find((p) => p.id === workflowId)!.effects,
        });
        setWorkflow();
      };
      customControls(q('capture-workflow'));
      setWorkflow();
      effectsUI = mountOutputEffects(q('capture-output-effects'), {
        resetContainer: q('capture-effects-heading'),
        value: () => history.value.effects,
        change: (value) => commit({ ...history.value, effects: value }),
        disabled: () => busy || !!gesture || annotations.active || !textForm.hidden,
        preview: () => (scene.selection ? { source, document: scene } : undefined),
        error,
      });
    }
    pointer = initial.pointer;
    if (initial.purpose === 'region') {
      q('annotation-tools').hidden = q('capture-properties').hidden = true;
      q('capture-effects').hidden = q('capture-workflow').hidden = q('capture-more').hidden = true;
      for (const id of ['copy', 'save', 'pin', 'library', 'ocr', 'translate', 'start-scroll','capture-recognition-tools']) q(id).hidden = true;
      q('region-confirm').hidden = false;
    }
    guide.setPurpose(
      initial.purpose,
      initial.regionHint,
      initial.composition === 'desktop' ? 'desktop' : initial.detection ? 'screen' : 'image',
    );
    setTool('select');
    document.body.dataset.purpose = initial.purpose;
    customControls(q('capture-properties'));
    propertyUI = captureProperties(q('capture-properties'));
    watermarkBar = watermarkToolbar(q('capture-properties'));
    // Hidden/occluded windows can receive animation frames only once a second,
    // even with backgroundThrottling disabled. Flush the decoded bitmap and
    // layout now; interactive updates still coalesce through draw().
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    sceneDirty = true;
    paint();
    document.body.dataset.captureReady = 'true';
    await api.ready(initial.token);
    void initialFonts.then(()=>draw(),error);
  })
  .catch((e) => {
    document.body.dataset.captureError=String(e);
    void window.one.diagnosticsReport('capture-init',e?.stack||String(e)).catch(()=>{});
    error(e);
    panel.hidden = false;
    q('annotation-tools').hidden = q('capture-properties').hidden = true;
    if (data)
      void api.ready(data.token, e instanceof Error ? e.message : String(e)).catch(() => {});
  });

async function loadAnnotationFont(family:string){if(await api.selectFont(data.token,family))await loadDocumentFont(family);}
document.addEventListener('change',event=>{const target=event.target;if(target instanceof HTMLElement&&target.id==='mark-family')void loadAnnotationFont(select('mark-family').value).then(()=>draw(true)).catch(error);});
api.onPreferences(value=>applyCaptureScale(document.body,value.uiScale));
