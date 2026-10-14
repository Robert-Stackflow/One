import { mountInlineOCR } from '../recognition/inline-ocr';
import { annotationPreferences } from './annotation-preferences';
import { annotationBrushCursor } from './annotation-brush-cursor';
import { watermarkControls } from './watermark-controls';
import { watermarkToolbar } from './watermark-toolbar';
import { AnnotationSelection } from './annotation-selection';
import {
  showAnnotationProperties,
  bindAnnotationFonts,
  readAnnotationStyle,
  bindAnnotationStyle,
  fillAnnotationStyle,
  imageAnnotationIds,
} from './annotation-controls';
import { InlineAnnotationText } from './inline-annotation-text';
import { toggleCaptureMenu, closeCaptureMenu } from './capture-menu';
import { editorMoreActions } from './editor-actions';
import './image-editor.css';
import './image-properties.css';
import {loadDocumentFont} from '../font-runtime';
import {applyCaptureScale} from '../capture/appearance';
import {
  createElement,
  Image as ImageIcon,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  SlidersHorizontal,
  Undo2,
  Redo2,
} from 'lucide';
import {
  ImageHistory,
  transformImage,
  selectionFrom,
  resizeSelection,
  shiftSelection,
  limit,
  type ImageDocument,
  type CaptureTool,
  type Point,
  type Annotation,
  type SelectionHandle,
} from '../../shared/capture/image-document';
import type { ImageEditorAPI, ImageEditorState } from '../../shared/capture/image-editor-api';
import { paintCapture, captureOutput } from './capture-paint';
import {mountEditorTranslation} from './translation-layer';
import { canvasPng } from './image-encode';
import { AnnotationEditor } from './annotation-editor';
import { stepOrderControls } from './step-order';
import { magnifierControls } from './magnifier-controls';
import { imageWatermarkControls } from './image-watermark-controls';
import { sensitiveControls } from './sensitive-controls';
import {
  defaultWatermarkPreset,
  watermarkPreset,
  type WatermarkStyle,
} from '../../shared/capture/watermark';
import { annotationTools } from './annotation-tools';
import { customControls } from '../controls';
import { strokeStyleControl } from './stroke-style-control';
import { captureProperties } from './capture-properties';
import { mountOutputEffects } from './output-effects';
import { mosaicControls } from './mosaic-controls';
import { responsiveImageToolbar } from './responsive-image-toolbar';
import { dismissFeedback, setupFloatingFeedback, transientNotice } from '../feedback';
let inlineOCR: ReturnType<typeof mountInlineOCR> | undefined;
let effectsUI: ReturnType<typeof mountOutputEffects>;
let propertyUI: ReturnType<typeof captureProperties>;
let watermarkBar: ReturnType<typeof watermarkToolbar> | undefined;

const api = window.one.imageEditor!;
const rememberedStyles = annotationPreferences(document,imageAnnotationIds,(tool,style)=>api.saveAnnotationStyle(data.token,tool,style),value=>message(value));
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fontFamilyControl=q<HTMLSelectElement>('font-family');
const source = new Image(),
  canvas = q<HTMLCanvasElement>('image'),
  overlay = q<HTMLCanvasElement>('overlay');
const viewport = q('viewport'),
  surface = q('surface'),
  textForm = q<HTMLFormElement>('text-editor');
let data: ImageEditorState,
  history: ImageHistory,
  scene: ImageDocument,
  annotations: AnnotationEditor;
let tool: CaptureTool = 'move',
  busy = false,
  frame = 0,
  saved = '',
  crop: ImageDocument['selection'] = null;
let textTarget: Annotation | undefined;
let translationEditor:ReturnType<typeof mountEditorTranslation>|undefined;
const currentImage=()=>translationEditor?.image(scene)||source;
let pointer: Point | undefined;
const brushCursor = annotationBrushCursor(surface);
const annotationSelection = new AnnotationSelection(
  q('annotation-selection'),
  q('annotation-handles'),
);
let dirtyQueue = Promise.resolve();
let watermarkQueue = Promise.resolve();
const openedAt = Date.now();
let cropGesture:
  | {
      before: ImageDocument;
      start: Point;
      rect: ImageDocument['selection'];
      handle?: SelectionHandle;
      move?: boolean;
    }
  | undefined;
setupFloatingFeedback(q('message'), true);
const notify = transientNotice(q('message'), 4000);
const message = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value);
  const loading = /^正在/.test(text);
  q('message').dataset.kind = loading ? 'loading' : value instanceof Error ? 'error' : 'info';
  if (!text) dismissFeedback(q('message'), () => (q('message').textContent = ''));
  else
    notify(
      value,
      loading,
      loading && /识别/.test(text) ? { label: '取消', run: cancelRecognition } : undefined,
    );
};
function cancelRecognition() {
  if (sensitiveUI.active) void sensitiveUI.cancel();
  else if (mosaicUI.active) mosaicUI.cancel();
}
q('message').addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && (sensitiveUI.active || mosaicUI.active)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelRecognition();
    }
  },
  true,
);
const point = (e: MouseEvent | PointerEvent): Point => {
  const r = overlay.getBoundingClientRect();
  return {
    x: limit(Math.round(((e.clientX - r.x) * scene.width) / r.width), 0, scene.width),
    y: limit(Math.round(((e.clientY - r.y) * scene.height) / r.height), 0, scene.height),
  };
};
const active = () => busy || !!cropGesture || annotations?.active || !textForm.hidden||!!translationEditor?.busy();
function fingerprint() {
  return JSON.stringify(history.value);
}
function notifyDirty() {
  const existing = textTarget && history.value.annotations.find((a) => a.id === textTarget!.id);
  const withoutBounds = (mark: Annotation) => {
    const { textBounds: _bounds, ...value } = mark;
    return value;
  };
  const draftText = q<HTMLTextAreaElement>('text-value').value;
  const draftDirty =
    textTarget &&
    !textForm.hidden &&
    (existing
      ? JSON.stringify(withoutBounds({ ...textTarget, text: draftText })) !==
        JSON.stringify(withoutBounds(existing))
      : !!draftText.trim());
  const dirty = fingerprint() !== saved || !!draftDirty;
  q('dirty').textContent = dirty ? '未保存' : '';
  dirtyQueue = dirtyQueue.then(() => api.dirty(data.token, dirty)).catch(message);
}
function changed(next: ImageDocument, committed: boolean) {
  scene = next;
  if (committed) {
    message('');
    notifyDirty();
  }
  void translationEditor?.sync(next).catch(message);draw();
}
function commit(next: ImageDocument) {
  annotations.commit(next);
}
const stepOrder = stepOrderControls(
  q('selected-mark'),
  () => annotations,
  () => active(),
);
const magnifierUI = magnifierControls(q('selected-mark'), {
  editor: () => annotations,
  scene: () => scene,
  locked: () => !!active(),
  moveTool: (mark) => {
    setTool('move');
    annotations.select(mark);
  },
});
const imageWatermarkUI = imageWatermarkControls(q('watermark-image-controls'), {
  locked: () => !!active(),
  choose: () => api.chooseWatermarkImage(data.token),
  pending: (value) => {
    busy = value;
    draw();
  },
  change: (image, preview) => {
    updateStyle({ watermark: { ...watermarkOptions(), image } }, preview);
    if (!preview && !annotations.selectedId) saveWatermarkDefaults(true);
  },
  refresh: () => {
    options(scene.annotations.find((a) => a.id === annotations.selectedId)?.tool || tool);
    draw();
  },
  error: message,
});
const sensitiveUI = sensitiveControls(q('sensitive-controls'), {
  api,
  token: () => data.token,
  locked: () => !!active() || !!crop,
  document: () => history.value,
  source: () => currentImage(),
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
  message,
});
const mosaicUI = mosaicControls(q('mosaic-controls'), {
  document: () => history.value,
  source: () => currentImage(),
  selected: () => scene.annotations.find((a) => a.id === annotations.selectedId),
  locked: () => !!active() || !!crop,
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
    q<HTMLSelectElement>('redaction-mode').value = 'rectangle';
    setTool('mosaic');
  },
  strength: () => Number(q<HTMLInputElement>('strength').value),
  message,
});
addEventListener('beforeunload', () => {
  if (sensitiveUI.active) void api.cancelSensitive(data.token).catch(() => {});
});
function draw() {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
}
const viewportObserver = new ResizeObserver(() => {
  if (scene) draw();
});
viewportObserver.observe(viewport);
addEventListener('beforeunload', () => viewportObserver.disconnect());
function paint() {
  if (!scene || !source.naturalWidth) return;
  document.documentElement.style.setProperty(
    '--image-feedback-top',
    viewport.getBoundingClientRect().top + 12 + 'px',
  );
  const zoom = q<HTMLSelectElement>('zoom').value;
  q<HTMLSelectElement>('zoom').disabled=busy;
  const scale =
    zoom === 'fit'
      ? Math.min(
          1,
          Math.max(1, viewport.clientWidth - 48) / scene.width,
          Math.max(1, viewport.clientHeight - 48) / scene.height,
        )
      : Number(zoom) / devicePixelRatio;
  const width = scene.width * scale,
    height = scene.height * scale;
  surface.style.width = width + 'px';
  surface.style.height = height + 'px';
  const pixels = Math.min(1, scale * devicePixelRatio);
  for (const c of [canvas, overlay]) {
    const w = Math.max(1, Math.ceil(scene.width * pixels)),
      h = Math.max(1, Math.ceil(scene.height * pixels));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    c.style.width = width + 'px';
    c.style.height = height + 'px';
    c.style.imageRendering = zoom !== 'fit' && Number(zoom) >= 1 ? 'pixelated' : 'auto';
  }
  const c = canvas.getContext('2d')!;
  c.setTransform(canvas.width / scene.width, 0, 0, canvas.height / scene.height, 0, 0);
  if (textTarget) layoutText();
  paintCapture(c, currentImage(), textTarget ? textEditor.scene(scene) : scene);translationEditor?.render();
  const o = overlay.getContext('2d')!;
  o.setTransform(overlay.width / scene.width, 0, 0, overlay.height / scene.height, 0, 0);
  o.clearRect(0, 0, scene.width, scene.height);
  const unit = 1 / (scale * devicePixelRatio);
  if (crop) {
    o.fillStyle = '#0007';
    o.beginPath();
    o.rect(0, 0, scene.width, scene.height);
    o.rect(crop.x, crop.y, crop.width, crop.height);
    o.fill('evenodd');
    o.strokeStyle = '#ffffff';
    o.lineWidth = unit;
    o.strokeRect(crop.x, crop.y, crop.width, crop.height);
  }
  const brush =
    tool === 'erasebrush' ||
    (['mosaic', 'blur'].includes(tool) && q<HTMLSelectElement>('redaction-mode').value === 'brush');
  brushCursor.refresh(
    pointer && { x: pointer.x * scale, y: pointer.y * scale },
    Number(q<HTMLInputElement>('brush-size').value),
    scale,
    brush && !textTarget && !busy && !crop,
  );
  annotationSelection.refresh(
    scene,
    textTarget
      ? textEditor.selection
      : scene.annotations.find((mark) => mark.id === annotations.selectedId),
    tool,
    !!crop,
    annotations.magnifierPart,
    (point) => ({ x: point.x * scale, y: point.y * scale }),
    scale,
  );
  const handles = q('crop-handles');
  handles.hidden = !crop;
  if (crop)
    Object.assign(handles.style, {
      left: crop.x * scale + 'px',
      top: crop.y * scale + 'px',
      width: crop.width * scale + 'px',
      height: crop.height * scale + 'px',
    });
  q('dimensions').textContent = scene.width + ' × ' + scene.height + ' px';
  q('crop-size').textContent = crop ? crop.width + ' × ' + crop.height + ' px' : '';
  q<HTMLButtonElement>('apply-crop').disabled = !crop || active();
  q<HTMLButtonElement>('clear-selection').disabled = !crop || busy;
  for (const id of [
    'rotate',
    'flip',
    'flip-y',
    'copy',
    'ocr',
    'export',
    'save',
    'save-project',
  ])
    q<HTMLButtonElement>(id).disabled = active() || !!crop;
  q<HTMLButtonElement>('undo').disabled = active() || !history.canUndo;
  q<HTMLButtonElement>('redo').disabled = active() || !history.canRedo;
  q('selected-mark').hidden = !annotations.selectedId || !!textTarget;
  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >('.options input,.options select,.options .custom-select,#watermark-date'))
    field.disabled = busy || !!cropGesture || annotations.active;
  q('steps').textContent = scene.annotations.length + ' 个标注';
  stepOrder.refresh();
  magnifierUI.refresh();
  imageWatermarkUI.refresh();
  sensitiveUI.refresh();
  mosaicUI.refresh();
  effectsUI?.refresh(!active());
  const propertyKind = scene.annotations.find((a) => a.id === annotations.selectedId)?.tool || tool;
  const showOptions =
    !['select', 'move', 'erase'].includes(propertyKind) || !!annotations.selectedId;
  document.querySelector<HTMLElement>('.options')!.hidden = !showOptions;
  q('image-properties').hidden =
    (!showOptions && !crop && !textTarget) || !q('image-effects-popover').hidden;
  propertyUI?.refresh();
  q<HTMLButtonElement>('output-effects').disabled = !!active() || !!crop;
}
function selected(mark?: Annotation) {
  if (mark) {
    fillAnnotationStyle(document, mark, imageAnnotationIds);
    if (mark.tool === 'watermark')
      fillWatermark(
        mark.watermark || {
          position: 'custom',
          opacity: 1,
          angle: 0,
          spacing: 60,
          capturedAt: data.openedAt ?? openedAt,
        },
        mark.text,
      );
  }
  q('edit-text').hidden =
    !mark || !['text', 'watermark'].includes(mark.tool) || !!mark.watermark?.image;
  options(mark?.tool || tool);
  draw();
}
function options(kind: CaptureTool) {
  const image = kind === 'watermark' && !!imageWatermarkUI.image;
  showAnnotationProperties(
    document,
    kind,
    q<HTMLSelectElement>('redaction-mode').value === 'brush',
    image,
    imageAnnotationIds,
    q('watermark-fields'),
  );
  q('watermark-hint').textContent = image
    ? '点击图像放置图片水印。自由位置可拖动；保存工程会保留图片内容。'
    : '选择水印后可直接编辑内容与布局，点击画面设置自由位置，双击水印编辑文字。';
  q('watermark-date').title = q('watermark-hint').textContent || '';
  q('watermark-spacing-field').hidden = q<HTMLSelectElement>('watermark-position').value !== 'tile';
  watermarkBar?.sync(kind === 'watermark', image);
}
function setTool(next: CaptureTool) {
  if (busy || cropGesture || annotations?.active) return;
  if (textTarget) submitText();
  mosaicUI.stopChoosing();
  q('image-properties').scrollLeft = 0;
  closeCaptureMenu();
  crop = null;
  if (!annotations.retainsSelection(next)) annotations.clear();
  tool = next;
  if (!annotations.selectedId) rememberedStyles.restore(next);
  q('annotation-tools').dispatchEvent(new CustomEvent('annotation-tool-change', { detail: tool }));
  document
    .querySelectorAll<HTMLButtonElement>('[data-tool]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  q('crop-actions').hidden = tool !== 'select';
  overlay.style.cursor = annotations.cursor(tool);
  options(tool);
  if (next === 'watermark') {
    const existing = scene.annotations.find((a) => a.tool === 'watermark');
    if (existing) annotations.select(existing);
    else {
      const preset = data.watermark || defaultWatermarkPreset();
      fillWatermark({ ...preset, capturedAt: data.openedAt ?? openedAt }, preset.text);
      q<HTMLInputElement>('color').value = preset.color;
      q<HTMLInputElement>('text-size').value = String(preset.fontSize);
      setFamily(preset.fontFamily);
      q<HTMLSelectElement>('font-weight').value = String(preset.fontWeight);
      annotations.watermark();
    }
  }
  draw();
}
function setFamily(value: string) {
  const family = fontFamilyControl;
  if (![...family.options].some((o) => o.value === value)) family.add(new Option(value, value));
  family.value = value;
}
const watermarkUI = watermarkControls(document, {
  locked: () => busy || !!cropGesture || !!annotations?.active,
  current: () => textTarget || scene?.annotations.find((a) => a.id === annotations?.selectedId),
  timestamp: () => data.openedAt ?? openedAt,
  image: () => imageWatermarkUI.image,
  fillImage: (image) => imageWatermarkUI.fill(image),
  update: updateStyle,
  refresh: () => draw(),
  error: message,
});
function fillWatermark(style: WatermarkStyle, text: string) {
  watermarkUI.fill(style, text);
}
function watermarkOptions(): WatermarkStyle {
  return watermarkUI.read();
}
function saveWatermarkDefaults(draft = false) {
  const mark =
    scene.annotations.find((a) => a.id === annotations.selectedId && a.tool === 'watermark') ||
    (draft
      ? {
          watermark: watermarkOptions(),
          text: q<HTMLInputElement>('watermark-text').value,
          color: q<HTMLInputElement>('color').value,
          fontSize: Number(q<HTMLInputElement>('text-size').value),
          fontFamily: q<HTMLSelectElement>('font-family').value,
          fontWeight: Number(q<HTMLSelectElement>('font-weight').value),
        }
      : undefined);
  if (!mark) return;
  // Old projects may contain longer watermark text; keep it editable without replacing the preset.
  if (mark.text.length > 500) return;
  const preset = watermarkPreset({
    ...(mark.watermark || { position: 'custom', opacity: 1, angle: 0, spacing: 60 }),
    text: mark.text,
    color: mark.color,
    fontSize: mark.fontSize || 32,
    fontFamily: mark.fontFamily || 'Segoe UI',
    fontWeight: mark.fontWeight || 400,
  });
  data.watermark = preset;
  watermarkQueue = watermarkQueue.then(() => api.saveWatermark(data.token, preset)).catch(message);
}
function updateStyle(style: Parameters<AnnotationEditor['update']>[0], preview = false) {
  if (!annotations || busy || cropGesture || annotations.active) return;
  if (!preview) rememberedStyles.remember(textTarget?.tool || scene.annotations.find(mark=>mark.id===annotations.selectedId)?.tool || tool);
  if (textTarget) {
    Object.assign(textTarget, style);
    if (style.text !== undefined) q<HTMLTextAreaElement>('text-value').value = style.text;
    notifyDirty();
    draw();
  } else {
    annotations.update(style, preview);
    if (!preview) saveWatermarkDefaults();
  }
}
const textEditor = new InlineAnnotationText(textForm, q<HTMLTextAreaElement>('text-value'), {
  area: () => scene.selection!,
  position: (point) => {
    const scale = overlay.getBoundingClientRect().width / scene.width;
    return { x: point.x * scale, y: point.y * scale };
  },
  scale: () => overlay.getBoundingClientRect().width / scene.width,
  selected: (mark) => annotations.select(mark),
  existing: (id) => history.value.annotations.find((mark) => mark.id === id),
  commit: (mark, text) => annotations.text(mark, text),
  remove: (id) => annotations.remove(id),
  changed: (mark) => {
    textTarget = mark;
    notifyDirty();
    draw();
  },
  input: (mark, text) => {
    if (mark.tool === 'watermark') q<HTMLInputElement>('watermark-text').value = text;
  },
  accepted: () => saveWatermarkDefaults(),
});
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
q('edit-text').onclick = () => {
  const mark = scene.annotations.find((a) => a.id === annotations.selectedId);
  if (mark && !active()) editText(mark);
};
q('delete-mark').onclick = () => {
  if (!active()) annotations.remove();
};
bindAnnotationStyle(document, imageAnnotationIds, {
  locked: () => !annotations || busy || !!cropGesture || annotations.active,
  update: (style, preview) => updateStyle(style, preview),
});
q('redaction-mode').onchange = () => {
  if (active()) return;
  rememberedStyles.remember(tool);
  annotations.clear();
  options(tool);
  draw();
};
function down(e: PointerEvent) {
  if (textForm.contains(e.target as Node)) return;
  if (textTarget && e.button === 0) submitText();
  if (active() || !scene || e.button !== 0) return;
  const p = point(e);
  if (annotationSelection.begin(e, p, annotations)) return;
  if (tool === 'select') {
    const handle = (e.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle as
      | SelectionHandle
      | undefined;
    const inside =
      crop &&
      p.x >= crop.x &&
      p.x <= crop.x + crop.width &&
      p.y >= crop.y &&
      p.y <= crop.y + crop.height;
    cropGesture = {
      before: history.value,
      start: p,
      rect: crop,
      handle,
      move: !!inside && !handle,
    };
    if (!handle && !inside) crop = null;
  } else {
    if (annotations.down(tool, p)) e.preventDefault();
  }
  if (cropGesture || annotations.active) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  draw();
}
surface.addEventListener('pointerdown', down);
surface.addEventListener('pointermove', (e) => {
  if (!scene || busy) return;
  const p = point(e),
    g = cropGesture;
  pointer = p;
  overlay.style.cursor = annotations.cursor(tool, p);
  if (!g && !annotations.active) draw();
  if (g) {
    if (g.handle && g.rect)
      crop = resizeSelection(
        g.rect,
        g.handle,
        p,
        scene.width,
        scene.height,
        e.shiftKey ? g.rect.width / g.rect.height : 0,
      );
    else if (g.move && g.rect)
      crop = shiftSelection(g.rect, p.x - g.start.x, p.y - g.start.y, scene.width, scene.height);
    else {
      const r = selectionFrom(g.start, p, scene.width, scene.height, e.shiftKey ? 1 : 0);
      crop = r.width >= 2 && r.height >= 2 ? r : null;
    }
    draw();
  } else if (annotations.active) annotations.move(p, e.shiftKey);
});
surface.addEventListener('pointerleave', () => {
  pointer = undefined;
  brushCursor.hide();
});
surface.addEventListener('pointerup', () => {
  if (cropGesture) {
    cropGesture = undefined;
    draw();
  } else {
    annotations?.up(scene);
    mosaicUI.drawn();
  }
});
surface.addEventListener('pointercancel', () => {
  cropGesture = undefined;
  annotations?.cancel();
  draw();
});
overlay.ondblclick = (e) => {
  if (active()) return;
  const mark = annotations.markAt(point(e));
  if (mark && ['text', 'watermark'].includes(mark.tool) && !mark.watermark?.image) editText(mark);
};
q('apply-crop').onclick = () => {
  if (!crop || active()) return;
  const next = transformImage(history.value, 'crop', crop);
  crop = null;
  commit(next);
  setTool('move');
};
q('clear-selection').onclick = () => {
  crop = null;
  cropGesture = undefined;
  draw();
};
for (const [id, kind] of [
  ['rotate', 'rotate'],
  ['flip', 'flipX'],
  ['flip-y', 'flipY'],
] as const)
  q(id).onclick = () => {
    if (active() || crop) return;
    annotations.clear();
    commit(transformImage(history.value, kind));
  };
function undo(redo = false) {
  if (busy || !textForm.hidden) return;
  annotations.cancel();
  cropGesture = undefined;
  crop = null;
  annotations.clear();
  if (redo) history.redo();
  else history.undo();
  changed(history.value, true);
}
q('undo').onclick = () => undo();
q('redo').onclick = () => undo(true);
async function output(mode: 'asset' | 'copy' | 'export' | 'ocr') {
  if (active() || crop || !scene) return;
  busy = true;
  document.querySelector<HTMLElement>('.image-workbench')!.ariaBusy = 'true';
  message('正在输出…');
  draw();
  let exported: HTMLCanvasElement | undefined;
  try {
    await dirtyQueue;
    await loadSceneFonts(history.value);
    await translationEditor?.sync(history.value);const translationError=translationEditor?.outputError();if(translationError)throw Error(translationError);
    exported = captureOutput(currentImage(), history.value);
    const png = await canvasPng(exported);
    const result = await api.save({
      token: data.token,
      document: history.value,
      history: history.snapshot,
      png,
      mode,
    });
    if (result === null) message('已取消保存，可以继续编辑');
    else {
      if (mode !== 'copy' && mode !== 'ocr') saved = fingerprint();
      message(
        mode === 'copy'
          ? '已复制图片'
          : mode === 'ocr'
            ? '已打开文字识别，可继续编辑'
            : mode === 'asset'
              ? '已保存素材副本'
              : '已保存 PNG',
      );
    }
  } catch (e) {
    message(e);
  } finally {
    if (exported) exported.width = exported.height = 0;
    busy = false;
    document.querySelector<HTMLElement>('.image-workbench')!.ariaBusy = 'false';
    notifyDirty();
    draw();
  }
}
q('copy').onclick = () => void output('copy');
q('ocr').onclick = () => {
  if(active()||crop||!scene||!window.one.inlineOCR)return;
  const rect=canvas.getBoundingClientRect(),bounds=viewport.getBoundingClientRect(),scale=rect.width/scene.width;
  const initial={scale,center:{x:(bounds.left+viewport.clientWidth/2-rect.left)/scale,y:(bounds.top+viewport.clientHeight/2-rect.top)/scale}};
  const snapshot=structuredClone(history.value);busy=true;annotations.clear();draw();
  inlineOCR=mountInlineOCR(viewport,window.one.inlineOCR,{source:data.url,initial,back:'返回编辑',message,
    snapshot:async()=>{
      await loadSceneFonts(snapshot);const image=document.createElement('canvas');image.width=snapshot.width;image.height=snapshot.height;
      try{paintCapture(image.getContext('2d')!,currentImage(),snapshot);return await canvasPng(image);}finally{image.width=image.height=0;}
    },closed:()=>{inlineOCR=undefined;busy=false;draw();}
  });
};
addEventListener('pagehide',()=>inlineOCR?.dispose());
q('save').onclick = () => void output('asset');
q('export').onclick = () => void output('export');
q('save-project').onclick = () => void saveProject();
async function saveProject() {
  if (active() || crop || !scene) return;
  busy = true;
  document.querySelector<HTMLElement>('.image-workbench')!.ariaBusy = 'true';
  message('正在保存工程…');
  draw();
  try {
    await dirtyQueue;
    const result = await api.saveProject(data.token, history.value, history.snapshot);
    if (result === null) message('已取消保存，可以继续编辑');
    else {
      saved = fingerprint();
      message('已保存图片工程');
    }
  } catch (error) {
    message(error);
  } finally {
    busy = false;
    document.querySelector<HTMLElement>('.image-workbench')!.ariaBusy = 'false';
    notifyDirty();
    draw();
  }
}
q('zoom').onchange = () => draw();
q('image-properties').addEventListener(
  'wheel',
  (e) => {
    const bar = q('image-properties');
    if (
      e.ctrlKey ||
      bar.scrollWidth <= bar.clientWidth ||
      (e.target instanceof Element && e.target.closest('input,select,[role="slider"]'))
    )
      return;
    e.preventDefault();
    bar.scrollLeft += e.deltaX || e.deltaY;
  },
  { passive: false },
);
viewport.addEventListener(
  'wheel',
  (e) => {
    if (inlineOCR || !e.ctrlKey) return;
    e.preventDefault();
    const values = ['fit', '0.5', '1', '2', '4'],
      current = values.indexOf(q<HTMLSelectElement>('zoom').value);
    q<HTMLSelectElement>('zoom').value =
      values[limit(current + (e.deltaY < 0 ? 1 : -1), 0, values.length - 1)];
    q('zoom').dispatchEvent(new Event('change'));
  },
  { passive: false },
);
document.addEventListener('keydown', (e) => {
  if(inlineOCR){if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();inlineOCR.dispose();}return;}
  if (!e.isComposing && e.key === 'Escape' && mosaicUI.active) {
    e.preventDefault();
    mosaicUI.cancel();
    return;
  }
  if (!e.isComposing && e.key === 'Escape' && sensitiveUI.active) {
    e.preventDefault();
    void sensitiveUI.cancel();
    return;
  }
  if (stepOrder.keydown(e)) return;
  if (!e.isComposing && !textForm.hidden && !busy) {
    if (e.key === 'Escape') {
      e.preventDefault();
      q('text-cancel').click();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      textForm.requestSubmit();
    }
    return;
  }
  if (
    e.isComposing ||
    !scene ||
    busy ||
    (e.target instanceof Element && e.target.closest('input,textarea,select,dialog'))
  )
    return;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!textForm.hidden) q('text-cancel').click();
    else if (crop) q('clear-selection').click();
    else {
      annotations.cancel();
      annotations.clear();
      draw();
    }
  } else if (e.ctrlKey && ['z', 'y'].includes(key)) {
    e.preventDefault();
    undo(key === 'y' || e.shiftKey);
  } else if (e.ctrlKey && key === 's') {
    e.preventDefault();
    void output(e.shiftKey ? 'export' : 'asset');
  } else if (e.ctrlKey && e.shiftKey && key === 'c') {
    e.preventDefault();
    void output('copy');
  } else if (e.key === 'Enter' && crop) {
    e.preventDefault();
    q('apply-crop').click();
  } else if (e.key === 'Delete' && annotations.selectedId) {
    e.preventDefault();
    annotations.remove();
  } else if (e.key.startsWith('Arrow') && !active()) {
    e.preventDefault();
    const n = e.shiftKey ? 10 : 1,
      dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0,
      dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
    if (crop) crop = shiftSelection(crop, dx, dy, scene.width, scene.height);
    else if (annotations.selectedId) {
      annotations.nudge(dx, dy);
    }
    draw();
  }
});
surface.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  cropGesture = undefined;
  crop = null;
  annotations?.cancel();
  draw();
});
new ResizeObserver(() => draw()).observe(viewport);
bindAnnotationFonts(document, () => api.fonts(), imageAnnotationIds);
annotationTools(q('annotation-tools'), setTool, true);
responsiveImageToolbar(document.querySelector('.editor-commandbar')!, setTool);
editorMoreActions(document.querySelector('.editor-footer .actions')!, [
  'save-project',
  'ocr',
  'export',
]);
q('output-effects').append(createElement(SlidersHorizontal, { 'aria-hidden': 'true' }));
q('output-effects').onclick = () => {
  toggleCaptureMenu(q('image-effects-popover'), q('output-effects'), { close: draw });
  draw();
};
q('brand').append(createElement(ImageIcon) as unknown as Node);
for (const [id, glyph] of [
  ['rotate', RotateCw],
  ['flip', FlipHorizontal],
  ['flip-y', FlipVertical],
  ['undo', Undo2],
  ['redo', Redo2],
] as const)
  q(id).prepend(createElement(glyph) as unknown as Node);
for (const [name, x, y] of [
  ['nw', 0, 0],
  ['n', 50, 0],
  ['ne', 100, 0],
  ['e', 100, 50],
  ['se', 100, 100],
  ['s', 50, 100],
  ['sw', 0, 100],
  ['w', 0, 50],
] as const) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.handle = name;
  b.ariaLabel = '调整裁剪 ' + name;
  Object.assign(b.style, { left: x + '%', top: y + '%', cursor: name + '-resize' });
  q('crop-handles').append(b);
}
propertyUI = captureProperties(document.querySelector<HTMLElement>('.options')!, {
  ids: imageAnnotationIds,
});
strokeStyleControl(q<HTMLSelectElement>('stroke-style'));
watermarkBar = watermarkToolbar(document.querySelector<HTMLElement>('.options')!, true);

customControls(document.body);
translationEditor=mountEditorTranslation({source,document:()=>scene,locked:()=>!!active()||!!crop,interactive:()=>tool==='move'&&!crop&&!annotations?.selectedId,commit,draw,message});
addEventListener('beforeunload',()=>translationEditor?.dispose(),{once:true});
void api
  .state()
  .then(async (initial) => {
    data = initial;
    rememberedStyles.load(initial.annotationStyles);
    await Promise.all([...new Set(Object.values(initial.annotationStyles||{}).map(style=>style.fontFamily))].map(loadAnnotationFont));
    applyCaptureScale(document.body,initial.uiScale||100);
    source.crossOrigin='anonymous';
    source.src = initial.url;
    await source.decode();
    if (source.naturalWidth !== initial.width || source.naturalHeight !== initial.height)
      throw Error('原图尺寸不符');
    history = new ImageHistory(initial.width, initial.height, true);
    if (initial.document) history.restore(initial.document, initial.history);
    // Publish the scene only after font loading; resize callbacks can paint while awaiting fonts.
    await loadSceneFonts(history.value);
    await translationEditor.sync(history.value);
    scene = history.value;
    saved = fingerprint();
    annotations = new AnnotationEditor({
      history,
      style: () => readAnnotationStyle(document, tool, imageAnnotationIds, watermarkOptions()),
      tolerance: () => (5 * scene.width) / overlay.getBoundingClientRect().width,
      measure: (mark) => textEditor.measured(mark),
      changed,
      selected,
      text: editText,
      error: message,
    });
    effectsUI = mountOutputEffects(q('image-output-effects'), {
      value: () => history.value.effects,
      disabled: () => !!active() || !!crop,
      change: (value) => commit({ ...history.value, effects: value }),
      preview: () => ({ source:currentImage(), document: scene }),
      error: message,
    });
    q('source-name').textContent = initial.name;
    setTool('move');
    draw();
    document.body.dataset.editorReady = 'true';
  })
  .catch(error=>{document.body.dataset.editorError=String(error);message(error);void window.one.diagnosticsReport('image-editor-init',error?.stack||String(error)).catch(()=>{});});

async function loadSceneFonts(value:ImageDocument){await Promise.all([...new Set(value.annotations.map(mark=>mark.fontFamily).filter((font):font is string=>!!font))].map(loadAnnotationFont));}
document.addEventListener('change',event=>{const target=event.target;if(target instanceof HTMLElement&&target.id==='font-family'){void loadAnnotationFont(fontFamilyControl.value).then(draw).catch(message);}});
api.onPreferences(value=>applyCaptureScale(document.body,value.uiScale));

async function loadAnnotationFont(family:string){if(await api.selectFont(data.token,family))await loadDocumentFont(family);}
