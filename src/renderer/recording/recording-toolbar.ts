import './recording-toolbar.css';
import {
  createElement,
  GripVertical,
  Pause,
  Play,
  Square,
  LoaderCircle,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Camera,
  Keyboard,
  Undo2,
  Redo2,
  Trash2,
  MoreHorizontal,
  Monitor,
  ScanLine,
  X,
  type IconNode,
} from 'lucide';
import type { RecordingState } from '../../shared/recording/recording';
import type { RecordingToolbarMenu } from '../../shared/recording/recording-toolbar';
import { t as tr } from '../../shared/capture/i18n';
import {
  defaultAnnotationStyle,
  recordingTools,
  type AnnotationCommand,
} from '../../shared/recording/recording-annotations';
import { groupedAnnotationTools } from '../editor/annotation-tools';
import { customControls } from '../controls';
import { strokeStyleControl } from '../editor/stroke-style-control';
import { strokeStyles } from '../../shared/capture/stroke-style';
import { captureProperties } from '../editor/capture-properties';
import {icon as controlIcon} from '../ui';
const api = window.one!.recordingToolbar!;
const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function menuLabel(id:string,text:string){
  const button=q(id);let label=button.querySelector('span');
  if(!label){label=document.createElement('span');button.replaceChildren(label);button.insertAdjacentHTML('beforeend',controlIcon('chevron-down'));}
  label.textContent=text;
}
let state: RecordingState | undefined,
  busy = false,
  stopPending = false,
  expanded = false,
  annotationExpanded = false,
  refreshId = 0;
let gainRequest: { token: string; system: number; microphone: number } | undefined;
let gaining = false;
let localError = '';
const remembered = { system: 1, microphone: 1 };
function icon(id: string, shape: IconNode, label?: string) {
  const element = q(id);
  if (label) {
    element.setAttribute('aria-label', tr(label));
    element.title = tr(label);
  }
  element.replaceChildren(createElement(shape, { 'aria-hidden': 'true' }));
}
function updateStop(next: RecordingState) {
  const loading = stopPending || (next.phase === 'stopping' && !next.retryAudio);
  const label = loading
    ? next.options?.mode === 'video'
      ? '正在处理视频…'
      : '正在处理录音…'
    : next.phase === 'arming'
      ? '取消录制'
      : next.retryAudio
        ? '重试处理'
        : '停止并预览';
  const button = q<HTMLButtonElement>('stop');
  // Progress ticks must not replace the SVG and restart its animation.
  if (button.ariaLabel !== tr(label) || !button.firstElementChild)
    icon('stop', loading ? LoaderCircle : next.phase === 'arming' ? X : Square, label);
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', String(loading));
  button.disabled =
    loading ||
    busy ||
    (!['recording', 'paused', 'arming'].includes(next.phase) && !next.retryAudio);
}
icon('move', GripVertical);
icon('sound', Volume2);
icon('camera', Camera);
icon('input-settings', Keyboard);
icon('annotation-undo', Undo2);
icon('annotation-redo', Redo2);
icon('annotation-clear', Trash2);
icon('annotation-more', MoreHorizontal);
icon('annotation-interact', Monitor);
icon('region-move', ScanLine);
q('region-move').onclick = () => void perform((next) => api.region(next.token));
let annotationStyle = defaultAnnotationStyle(),
  annotationTool = 'brush';
let pendingStyle: Extract<AnnotationCommand, { kind: 'style' }> | undefined;
function annotationAction(command: AnnotationCommand) {
  if (command.kind === 'style' && busy) {
    pendingStyle = command;
    return;
  }
  void perform(async (next) => {
    await api.annotate(next.token, command);
    if (command.kind === 'tool' || command.kind === 'interact') {
      const interactive = command.kind === 'tool' || !next.annotating;
      const tool = command.kind === 'tool' ? command.tool : next.annotationTool;
      annotationExpanded = interactive && !['move', 'erase'].includes(tool || '');
      expanded = false;
      q('sound-panel').hidden = true;
      q('sound').setAttribute('aria-expanded', 'false');
      q('capture-properties').hidden = !annotationExpanded;
      positionStrips(
        await api.expand(next.token, annotationExpanded, true),
        annotationExpanded ? 120 : 64,
      );
    }
  });
}
function openMenu(menu: RecordingToolbarMenu, anchor: HTMLElement) {
  if (!state) return;
  const r = anchor.getBoundingClientRect();
  void perform((next) =>
    api.menu(next.token, menu, { x: r.x, y: r.y, width: r.width, height: r.height }),
  );
}
const annotationTools = groupedAnnotationTools(
  q('annotation-tools'),
  (tool) => annotationAction({ kind: 'tool', tool }),
  {
    allowed: recordingTools,
    menu: (family, selected, anchor) =>
      openMenu({ kind: 'tools', tools: family, selected }, anchor),
  },
);
annotationTools.set('brush');
const toolFamilies = [
  ...q('annotation-tools').querySelectorAll<HTMLElement>(':scope > [data-tools]'),
];
function layoutToolbar() {
  if (q('annotation-tools').hidden) return;
  for (const family of toolFamilies) family.hidden = false;
  q('annotation-actions').hidden = false;
  q('fps').hidden = false;
  const row = q('capture-actions').firstElementChild as HTMLElement;
  for (const divider of row.querySelectorAll<HTMLElement>(':scope > .capture-divider'))
    divider.hidden = false;
  for (const divider of q('annotation-tools').querySelectorAll<HTMLElement>('.capture-divider'))
    divider.hidden = false;
  const children = [...row.children].filter((el) => !(el as HTMLElement).hidden);
  const natural =
    Math.max(...children.map((el) => el.getBoundingClientRect().right)) -
    row.getBoundingClientRect().left +
    16;
  if (state) void api.fit(state.token, Math.ceil(natural)).catch(() => {});
  const overflowing = () => row.scrollWidth > row.clientWidth;
  for (const family of [...toolFamilies].reverse()) {
    if (!overflowing()) break;
    if (!family.dataset.tools?.includes('erasebrush')) family.hidden = true;
  }
  if (overflowing()) q('annotation-actions').hidden = true;
  if (overflowing()) q('fps').hidden = true;
  for (const divider of row.querySelectorAll<HTMLElement>('.capture-divider')) {
    const previous = divider.previousElementSibling as HTMLElement;
    const next = divider.nextElementSibling as HTMLElement | null;
    const empty = (element: HTMLElement | null) =>
      !element ||
      element.hidden ||
      (element.id === 'annotation-tools' && toolFamilies.every((family) => family.hidden));
    divider.hidden = empty(previous) || empty(next);
  }
}
new ResizeObserver(layoutToolbar).observe(q('capture-actions'));
strokeStyleControl(q<HTMLSelectElement>('mark-stroke'));
customControls(q('capture-properties'));
const propertyUI = captureProperties(q('capture-properties'), {
  colorMenu: (anchor) => openMenu({ kind: 'color' }, anchor),
});
for (const [kind, field] of [
  ['stroke', 'stroke'],
  ['font', 'family'],
  ['weight', 'weight'],
] as const)
  q('mark-' + field + '-trigger').onclick = () =>
    openMenu({ kind }, q('mark-' + field + '-trigger'));
q('annotation-more').onclick = () =>
  openMenu(
    {
      kind: 'more',
      tools: toolFamilies
        .filter((family) => family.hidden)
        .flatMap((family) => family.dataset.tools!.split(' ')) as typeof recordingTools,
      selected: annotationTool as (typeof recordingTools)[number],
    },
    q('annotation-more'),
  );
for (const id of [
  'color',
  'width',
  'strength',
  'redaction',
  'stroke',
  'filled',
  'family',
  'font',
  'weight',
  'italic',
  'outline',
  'size',
])
  q('mark-' + id).addEventListener('change', () => {
    annotationStyle = {
      ...annotationStyle,
      color: q<HTMLInputElement>('mark-color').value,
      width: Number(q<HTMLInputElement>('mark-width').value),
      strength: Number(q<HTMLInputElement>('mark-strength').value),
      brushSize: Number(q<HTMLInputElement>('mark-size').value),
      italic: q<HTMLInputElement>('mark-italic').checked,
      textOutline: q<HTMLInputElement>('mark-outline').checked,
      brush: q<HTMLSelectElement>('mark-redaction').value === 'brush',
      strokeStyle: q<HTMLSelectElement>('mark-stroke').value as typeof annotationStyle.strokeStyle,
      filled: q<HTMLInputElement>('mark-filled').checked,
      fontFamily: q<HTMLSelectElement>('mark-family').value,
      fontSize: Number(q<HTMLInputElement>('mark-font').value),
      fontWeight: Number(q<HTMLSelectElement>('mark-weight').value) as 400 | 600 | 700,
    };
    annotationAction({ kind: 'style', style: annotationStyle });
  });
for (const kind of ['undo', 'redo', 'clear'] as const)
  q('annotation-' + kind).onclick = () => annotationAction({ kind });
q('annotation-interact').onclick = () => annotationAction({ kind: 'interact' });
const format = (seconds: number) =>
  [Math.floor(seconds / 60), Math.floor(seconds % 60)]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
async function refresh() {
  const id = ++refreshId;
  try {
    const next = await api.state();
    if (id !== refreshId) return;
    state = next;
    annotationTool = next.annotationTool || 'brush';
    annotationTools.set(
      (next.annotating ? annotationTool : 'select') as Parameters<typeof annotationTools.set>[0],
    );
    annotationStyle = pendingStyle?.style || next.annotationStyle || annotationStyle;
    const contextTool = next.annotationSelection || annotationTool;
    const propertyVisible =
      !expanded && !!next.annotating && !['move', 'erase'].includes(contextTool);
    if (propertyVisible !== annotationExpanded) {
      annotationExpanded = propertyVisible;
      q('capture-properties').hidden = !propertyVisible;
      positionStrips(
        await api.expand(next.token, propertyVisible, true),
        propertyVisible ? 120 : 64,
      );
    }
    const textTool = contextTool === 'text',
      strokeTool = ['line', 'arrow', 'brush', 'highlight'].includes(contextTool),
      shapeTool = ['rectangle', 'roundrect', 'ellipse', 'triangle', 'diamond', 'solid'].includes(
        contextTool,
      ),
      eraser = ['erasebrush', 'erase'].includes(contextTool);
    const redaction = ['mosaic', 'blur'].includes(contextTool);
    q('mark-color-field').hidden = eraser || redaction;
    q('mark-width-field').hidden = textTool || eraser || redaction;
    q('mark-size-field').hidden = !(
      contextTool === 'erasebrush' ||
      (redaction && annotationStyle.brush)
    );
    q('capture-properties').querySelector<HTMLElement>('[data-text-emphasis]')!.hidden = !textTool;
    q('mark-strength-field').hidden = !redaction;
    q('mark-redaction-field').hidden = !redaction;
    q<HTMLSelectElement>('mark-redaction').value = annotationStyle.brush ? 'brush' : 'rectangle';
    q('mark-stroke-field').hidden = !strokeTool;
    q('mark-filled-field').hidden = !shapeTool || contextTool === 'solid';
    for (const id of ['family', 'font', 'weight']) q('mark-' + id + '-field').hidden = !textTool;
    for (const [id, value] of [
      ['color', annotationStyle.color],
      ['width', annotationStyle.width],
      ['size', annotationStyle.brushSize ?? 24],
      ['strength', annotationStyle.strength],
      ['stroke', annotationStyle.strokeStyle],
      ['family', annotationStyle.fontFamily],
      ['font', annotationStyle.fontSize],
      ['weight', annotationStyle.fontWeight],
    ] as const) {
      const field = q<HTMLInputElement>('mark-' + id);
      if (document.activeElement !== field) field.value = String(value);
    }
    q<HTMLInputElement>('mark-filled').checked = annotationStyle.filled;
    q<HTMLInputElement>('mark-italic').checked = !!annotationStyle.italic;
    q<HTMLInputElement>('mark-outline').checked = !!annotationStyle.textOutline;
    propertyUI.refresh();
    menuLabel('mark-stroke-trigger',strokeStyles.find(
      (s) => s.value === annotationStyle.strokeStyle,
    )!.label);
    menuLabel('mark-family-trigger',annotationStyle.fontFamily);
    menuLabel('mark-weight-trigger',
      annotationStyle.fontWeight === 400
        ? '常规'
        : annotationStyle.fontWeight === 600
          ? '半粗'
          : '粗体');
    document.documentElement.dataset.phase = next.phase;
    q('time').textContent =
      next.countdown !== undefined ? `${next.countdown} s` : format(next.seconds);
    q('fps').textContent = `${next.video?.fps || next.options?.fps || 30} FPS`;
    q('phase').textContent = tr(
      next.countdown !== undefined
        ? '即将开始'
        : (
            {
              arming: '正在准备',
              recording: '正在录制',
              paused: '已暂停',
              stopping: next.retryAudio ? '处理失败，可重试' : '正在处理',
            } as Record<string, string>
          )[next.phase] || '录制已结束',
    );
    const active = ['recording', 'paused'].includes(next.phase);
    q('region-move').hidden = !next.regionMovable;
    q<HTMLButtonElement>('region-move').disabled = busy || !active;
    q('region-move').setAttribute('aria-pressed', String(!!next.movingRegion));
    q('camera').hidden = !next.camera;
    q<HTMLButtonElement>('camera').disabled = busy || !active;
    q<HTMLButtonElement>('input-settings').disabled = busy || !active;
    q('input-settings').hidden = next.options?.videoSource === 'camera';
    q('input-settings').setAttribute(
      'aria-pressed',
      String(
        !!next.inputStyle &&
          (next.inputStyle.keys !== 'off' || next.inputStyle.clicks || next.inputStyle.trail),
      ),
    );
    document
      .querySelectorAll<HTMLElement>('.video-only')
      .forEach(
        (element) =>
          (element.hidden =
            next.options?.mode !== 'video' || next.options?.videoSource === 'camera'),
      );
    q('annotation-interact').title = q('annotation-interact').ariaLabel = next.annotating
      ? '返回桌面操作'
      : '继续绘制标注';
    q('annotation-interact').setAttribute('aria-pressed', String(!next.annotating));
    q('annotation-tools')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => (b.disabled = busy || !active));
    document
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement
      >('#annotation-actions button,#capture-properties button,#capture-properties input,#annotation-interact')
      .forEach((control) => (control.disabled = busy || !active));
    q<HTMLButtonElement>('pause').disabled = busy || !active;
    icon(
      'pause',
      next.phase === 'paused' ? Play : Pause,
      next.phase === 'paused' ? '继续录制' : '暂停录制',
    );
    updateStop(next);
    for (const channel of ['system', 'microphone'] as const) {
      q(channel + '-channel').hidden =
        !next.options?.[channel === 'system' ? 'systemAudio' : 'microphone'];
      const value = next.gains?.[channel] ?? 1;
      const input = q<HTMLInputElement>(channel + '-gain');
      if (!gaining && !gainRequest && document.activeElement !== input)
        input.value = String(Math.round(value * 100));
      input.disabled = !active;
      q<HTMLButtonElement>(channel + '-mute').disabled = busy || !active;
      q(channel + '-value').textContent = Math.round(Number(input.value)) + '%';
      icon(
        channel + '-mute',
        channel === 'system' ? (value ? Volume2 : VolumeX) : value ? Mic : MicOff,
        value
          ? channel === 'system'
            ? '静音系统声音'
            : '静音麦克风'
          : channel === 'system'
            ? '取消静音系统声音'
            : '取消静音麦克风',
      );
    }
    q('sound-empty').hidden = !!next.options?.systemAudio || !!next.options?.microphone;
    q('message').textContent = localError || next.message;
    layoutToolbar();
    if (next.retryAudio && !expanded) await expand(true);
  } catch (error) {
    q('phase').textContent = tr('操作栏暂不可用');
  }
}
async function perform(action: (state: RecordingState) => Promise<void>) {
  if (busy || !state) return;
  busy = true;
  localError = '';
  q<HTMLButtonElement>('pause').disabled = q<HTMLButtonElement>('stop').disabled = true;
  try {
    await action(state);
  } catch (error) {
    localError = String((error as Error).message).replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    );
    if (annotationExpanded) {
      q('annotation-message').hidden = false;
      q('annotation-message').textContent = localError;
    } else {
      q('message').textContent = localError;
      await expand(true);
    }
  } finally {
    busy = false;
    await refresh();
    if (pendingStyle) {
      const command = pendingStyle;
      pendingStyle = undefined;
      annotationAction(command);
    }
  }
}
async function expand(value: boolean) {
  if (!state) return;
  positionStrips(await api.expand(state.token, value), value ? 212 : 64);
  expanded = value;
  annotationExpanded = false;
  q('capture-properties').hidden = true;
  q('sound-panel').hidden = !value;
  q('sound').setAttribute('aria-expanded', String(value));
}
function positionStrips(above: boolean, height: number) {
  document.documentElement.style.setProperty('--action-top', (above ? height - 64 : 0) + 'px');
  document.documentElement.style.setProperty('--property-top', (above ? 0 : 64) + 'px');
}
q('sound').onclick = () => {
  void perform(() => expand(!expanded));
};
q('camera').onclick = () => openMenu({ kind: 'camera' }, q('camera'));
q('input-settings').onclick = () => openMenu({ kind: 'input' }, q('input-settings'));
q('pause').onclick = () => {
  void perform((next) => api.pause(next.token, next.phase !== 'paused'));
};
q('stop').onclick = () => {
  if (busy || !state) return;
  stopPending = state.phase !== 'arming';
  updateStop(state);
  void perform((next) =>
    next.phase === 'arming' ? api.cancel(next.token) : api.stop(next.token),
  ).finally(() => {
    stopPending = false;
    if (state) updateStop(state);
  });
};
q('move').ondblclick = () => {
  void perform(async (next) =>
    positionStrips(
      await api.resetPosition(next.token),
      annotationExpanded ? 120 : expanded ? 212 : 64,
    ),
  );
};
q('move').onkeydown = (event) => {
  if (event.key === 'Enter') q('move').dispatchEvent(new MouseEvent('dblclick'));
};
let drag: { pointer: number; token: string } | undefined;
let dragChain = Promise.resolve();
function sendDrag(phase: 'start' | 'move' | 'end', event: PointerEvent) {
  const current = drag;
  if (!current) return;
  const point = { x: event.screenX, y: event.screenY };
  dragChain = dragChain.then(() => api.drag(current.token, phase, point)).catch(() => {});
}
q('move').onpointerdown = (event) => {
  if (event.button !== 0 || !state) return;
  event.preventDefault();
  drag = { pointer: event.pointerId, token: state.token };
  q('move').setPointerCapture(event.pointerId);
  sendDrag('start', event);
};
q('move').onpointermove = (event) => {
  if (drag?.pointer === event.pointerId) sendDrag('move', event);
};
const endDrag = (event: PointerEvent) => {
  if (drag?.pointer !== event.pointerId) return;
  sendDrag('end', event);
  drag = undefined;
  if (q('move').hasPointerCapture(event.pointerId))
    q('move').releasePointerCapture(event.pointerId);
};
q('move').onpointerup = endDrag;
q('move').onpointercancel = endDrag;
async function flushGain() {
  if (gaining) return;
  gaining = true;
  try {
    while (gainRequest) {
      const request = gainRequest;
      gainRequest = undefined;
      if (state?.token !== request.token) continue;
      await api.gain(request.token, request.system, request.microphone);
    }
  } catch (error) {
    localError = (error as Error).message;
    q('message').textContent = localError;
    await expand(true);
  } finally {
    gaining = false;
    await refresh();
  }
}
for (const channel of ['system', 'microphone'] as const) {
  q<HTMLInputElement>(channel + '-gain').oninput = () => {
    if (!state || !['recording', 'paused'].includes(state.phase)) return;
    q(channel + '-value').textContent = q<HTMLInputElement>(channel + '-gain').value + '%';
    gainRequest = {
      token: state.token,
      system: Number(q<HTMLInputElement>('system-gain').value) / 100,
      microphone: Number(q<HTMLInputElement>('microphone-gain').value) / 100,
    };
    void flushGain();
  };
  q(channel + '-mute').onclick = () => {
    const input = q<HTMLInputElement>(channel + '-gain'),
      value = Number(input.value) / 100;
    if (value) remembered[channel] = value;
    input.value = value ? '0' : String(remembered[channel] * 100);
    input.dispatchEvent(new Event('input'));
  };
}
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    q('pause').click();
  }
  if (event.key === 'Escape' && state?.phase === 'arming') q('stop').click();
});
api.onChange(() => {
  void refresh();
});
void refresh();
