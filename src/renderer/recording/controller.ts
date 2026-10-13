import { recorderAudioTests } from './audio-tests';
import { sourceCard, bindSourceCardPreviews } from '../capture/source-card';
import {customControls,selectSource,setSelectLoader,closeControls} from '../controls';
import {setupSegments} from '../segments';
import {onRemoval} from '../dom-lifecycle';
import {applyCaptureScale} from '../capture/appearance';
import {bindSplitAction,splitAction} from '../capture/split-action';
import { registerIcons } from '../ui';
import {confirmDialog} from '../dialog';
import {setupFloatingFeedback,transientNotice,disposeFeedback} from '../feedback';
import { t as tr, formatNumber } from '../../shared/capture/i18n';
import type { AudioCapabilities } from '../../shared/recording/native-audio';
import { cropStream } from '../capture/region-stream';
import { defaultInputStyle } from '../../shared/recording/recording-input';
import { inputSettings } from './recording-input-settings';
import { defaultCameraStyle } from '../../shared/recording/recording-camera';
import { cameraSettings } from './recording-camera-settings';
import {
  createElement,
  Video,
  Mic,
  AudioLines,
  Volume2,
  Keyboard,
  Camera,
  Eye,
  EyeOff,
  ScanLine,
  RefreshCw,
  RotateCcw,
  Monitor,
  AppWindow,
  SlidersHorizontal,
  Pause,
  Play,
  Square,
  Trash2,
  type IconNode,
} from 'lucide';
import {
  recordingMime,
  recordingExtension,
  RECORD_CHUNK,
  RECORD_SECONDS,
  type RecorderAPI,
  type RecordingOptions,
  type RecordingSource,
  type RecordingState,
} from '../../shared/recording/recording';
export function setupRecording(root:HTMLElement,heading:HTMLElement,api:RecorderAPI){
 const page=root.querySelector<HTMLElement>('.recording-page')!;
 let pageActive=false,disposed=false,closing=false,activationRevision=0,disposal:Promise<void>|undefined,startTask:Promise<void>|undefined;
 const events=new AbortController(),cleanups:(()=>void)[]=[];
 const elements=new Map<string,HTMLElement>();
 const q=<T extends HTMLElement=HTMLElement>(id:string):T=>{
   const node=elements.get(id)||page.querySelector<HTMLElement>('#recording-'+id)||heading.querySelector<HTMLElement>('#recording-'+id);
   if(!node)throw Error('Missing recording control: '+id);
   const source=selectSource(node)||node;elements.set(id,source);return source as T;
 };
 const confirmAction=(message:string)=>confirmDialog({title:'录制',message,confirm:'放弃',danger:true});
 const soundTests=recorderAudioTests(page,api);
let configTab = 'basic';
function selectConfigTab(name = configTab) {
  const previous = configTab;
  const audio = recordMode === 'audio';
  configTab = name;
  if (
    ['input', 'camera'].includes(configTab) &&
    (recordMode === 'audio' || sourceMode === 'camera' || !nativeMode())
  )
    configTab = 'basic';
  page.querySelectorAll<HTMLButtonElement>('[data-config-tab]').forEach((button) => {
    const selected = button.dataset.configTab === configTab;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
    button.hidden =
      ['input', 'camera'].includes(button.dataset.configTab || '') &&
      (recordMode === 'audio' || sourceMode === 'camera' || !nativeMode());
  });
  page
    .querySelectorAll<HTMLElement>('.record-config-panel')
    .forEach((panel) => (panel.hidden = panel.id !== 'recording-config-' + (audio ? 'basic' : configTab)));
  q('record-config-tabs').hidden = audio;
  q('config-basic').setAttribute('role', audio ? 'group' : 'tabpanel');
  q('record-config-tabs').querySelector<HTMLElement>('[data-config-tab=quality]')!.textContent =
    recordMode === 'audio' ? '音质' : '画质';
  q('config-quality').setAttribute(
    'aria-label',
    recordMode === 'audio' ? '音频质量' : '画质与编码',
  );
  if (previous !== configTab)
    q('record-config-tabs').closest('aside')!.querySelector('.record-options-scroll')!.scrollTop =
      0;
}
for (const button of page.querySelectorAll<HTMLButtonElement>('[data-config-tab]'))
  button.onclick = () => selectConfigTab(button.dataset.configTab);
let cameraChoices: { id: string; name: string }[] = [];
let cameraPreviewRevision = 0,
  cameraPreviewTimer: ReturnType<typeof setTimeout> | undefined;
async function cameraCardPreview() {
  const revision = ++cameraPreviewRevision;
  clearTimeout(cameraPreviewTimer);
  if (!api.cameraSetup) return;
  const visible =
    sourceMode === 'camera' &&
    recordMode === 'video' &&
    !nativeStarting &&
    pageActive && !closing && !disposed && !document.hidden &&
    ['idle', 'ready'].includes(state?.phase || 'idle');
  try {
    const device = visible ? q<HTMLSelectElement>('camera-source-device').value : '';
    const url = await api.cameraSetup(device || null);
    if (!url || revision !== cameraPreviewRevision) return;
    const card = [...q('camera-sources').querySelectorAll<HTMLElement>('[data-camera]')].find(
      (node) => node.dataset.camera === device,
    );
    const root = card?.querySelector('.display-preview');
    if (!root) return;
    const image = document.createElement('img');
    image.alt = '摄像头实时预览';
    image.draggable = false;
    let failures = 0;
    const next = () => {
      if (revision !== cameraPreviewRevision) return;
      image.src = url + '?frame=' + Date.now();
    };
    image.onload = () => {
      failures = 0;
      if (revision === cameraPreviewRevision) cameraPreviewTimer = setTimeout(next, 100);
    };
    image.onerror = () => {
      if (revision !== cameraPreviewRevision) return;
      if (++failures < 3) cameraPreviewTimer = setTimeout(next, 300);
      else {
        q('camera-source-feedback').textContent = '摄像头预览中断，请刷新设备';
        root.replaceChildren(createElement(Camera, { 'aria-hidden': 'true' }));
        void api.cameraSetup(null).catch(() => {});
      }
    };
    root.replaceChildren(image);
    next();
    q('camera-source-feedback').textContent = '';
  } catch (e) {
    if (revision === cameraPreviewRevision)
      q('camera-source-feedback').textContent = errorMessage(e);
  }
}
document.addEventListener('visibilitychange',()=>{soundTests.activate(pageActive&&!document.hidden);void cameraCardPreview();},{signal:events.signal});
function renderCameraSources() {
  const root = q('camera-sources');
  root.innerHTML = cameraChoices
    .map((device) =>
      sourceCard({
        key: device.id,
        attribute: 'data-camera',
        name: device.name,
        meta: '摄像头',
        selected: device.id === q<HTMLSelectElement>('camera-source-device').value,
        kind: 'camera',
        disabled: cameraLoading,
      }),
    )
    .join('');
  root.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(
    (button) =>
      (button.onclick = () => {
        for (const id of ['camera-device', 'camera-source-device'])
          q<HTMLSelectElement>(id).value = button.dataset.camera!;
        renderCameraSources();
        void cameraCardPreview();
        updateStartAvailability();
      }),
  );
}
let setupCamera = defaultCameraStyle(),
  cameraLoading = false;
cameraSettings(q('camera-setup-controls'), 'recording-camera-setup', setupCamera, (value) => {
  setupCamera = value;
});
async function loadCameras() {
  if(!pageActive||closing||disposed)return;
  if (cameraLoading || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
  cameraLoading = true;
  renderCameraSources();
  q<HTMLButtonElement>('camera-refresh').disabled = true;
  q<HTMLButtonElement>('refresh').disabled = true;
  updateStartAvailability();
  try {
    const devices = await api.cameras();
    if(closing||disposed)return;
    cameraChoices = devices;
    if (!['idle', 'ready'].includes(state?.phase || 'idle')) return;
    deviceOptions(q<HTMLSelectElement>('camera-device'), devices);
    const select = q<HTMLSelectElement>('camera-device');
    if (!select.value && devices.length) select.value = devices[0].id;
    q('camera-feedback').textContent = devices.length ? '' : '没有找到摄像头，请连接设备后刷新。';
    deviceOptions(q<HTMLSelectElement>('camera-source-device'), devices);
    q<HTMLSelectElement>('camera-source-device').value = select.value;
    q('camera-source-feedback').textContent = q('camera-feedback').textContent;
  } catch (e) {
    q('camera-feedback').textContent = (e as Error).message;
    q('camera-source-feedback').textContent = (e as Error).message;
  } finally {
    cameraLoading = false;
    if(closing||disposed)return;
    renderCameraSources();
    q<HTMLButtonElement>('camera-refresh').disabled = false;
    q<HTMLButtonElement>('refresh').disabled = false;
    updateStartAvailability();
    void cameraCardPreview();
  }
}
q('camera-enabled').onchange = () => {
  const enabled = q<HTMLInputElement>('camera-enabled').checked;
  q('camera-options').hidden = !enabled;
  updateStartAvailability();
  if (enabled) void loadCameras();
};
for (const id of ['camera-device', 'camera-source-device'])
  q(id).onchange = () => {
    const selected = q<HTMLSelectElement>(id).value;
    q<HTMLSelectElement>('camera-device').value = selected;
    q<HTMLSelectElement>('camera-source-device').value = selected;
    renderCameraSources();
    updateStartAvailability();
    void cameraCardPreview();
  };
q('camera-refresh').onclick = () => void loadCameras();

let setupInput = defaultInputStyle();
inputSettings(q('input-setup-controls'), 'recording-input', setupInput, (value) => {
  setupInput = value;
});
function command(id: string, shape: IconNode, label: string, key: string) {
  const button = q(id);
  if (button.dataset.command === key) return;
  button.dataset.command = key;
  button.setAttribute('aria-label', label);
  button.title = label;
  const caption = document.createElement('span');
  caption.textContent = label;
  button.replaceChildren(
    createElement(shape, { class: 'icon', 'aria-hidden': 'true', 'stroke-width': 1.75 }),
    caption,
  );
}
command('discard', Trash2, tr('放弃'), 'discard');
command('stop', Square, tr('停止并预览'), 'stop');
command('refresh', RefreshCw, tr('刷新来源'), 'refresh');
registerIcons({ 'scan-line': ScanLine, eye: Eye, 'eye-off': EyeOff });
q('region-entry').innerHTML=splitAction('recording-choose-region','选定录制区域','lucide:scan-line',false,{primary:'隐藏主窗口后选区（默认）',secondary:'保留主窗口选区',primaryIcon:'lucide:eye-off',secondaryIcon:'lucide:eye'});
cleanups.push(bindSplitAction(page,'recording-choose-region',preserve=>void chooseRegion(!preserve)));
command('choose-region', ScanLine, tr('选定录制区域'), 'region');
command('clear-region', RotateCcw, tr('恢复整屏'), 'reset-region');
q('meter-icon').appendChild(
  createElement(AudioLines, { 'aria-hidden': 'true', 'stroke-width': 1.75 }),
);
for (const [id, shape] of [
  ['system-sound-icon', Volume2],
  ['microphone-sound-icon', Mic],
] as const)
  q(id).prepend(createElement(shape, { 'aria-hidden': 'true', 'stroke-width': 1.75 }));
const format = (seconds: number) =>
    [Math.floor(seconds / 60), Math.floor(seconds % 60)]
      .map((s) => String(s).padStart(2, '0'))
      .join(':'),
  size = (bytes: number) =>
    formatNumber(bytes / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
const errorMessage = (value: unknown) =>
  String(value instanceof Error ? value.message : value).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
const error = (value: unknown) => {
  notify(errorMessage(value));
};
let stateNotice = '';
setupFloatingFeedback(q('toast'), true);
const notify = transientNotice(q('toast'), 7000);
let state: RecordingState | undefined,
  sources: RecordingSource[] = [],
  sourceId = '',
  sourceType: 'screen' | 'window' = 'screen',
  sourceMode: 'screen' | 'window' | 'region' | 'camera' = 'screen',
  recordMode: 'video' | 'audio' = 'video',
  refreshId = 0;
interface Run {
  abort: AbortController;
  cropDispose?: () => void;
  token: string;
  streams: MediaStream[];
  context?: AudioContext;
  recorder?: MediaRecorder;
  analyser?: AnalyserNode;
  chain: Promise<void>;
  sequence: number;
  queued: number;
  written: number;
  started: number;
  pausedAt: number;
  pausedMs: number;
  ending: boolean;
  reason: string;
  timer?: ReturnType<typeof setInterval>;
  done:Promise<void>;
  complete():void;
}
let sourceRequest = 0,
  choosingRegion = false,
  loadingSources = false;
let sourceTask:Promise<void>|undefined,sourceTaskType='';
let run: Run | undefined;
let nativeStarting = false,
  nativeAction = false,
  nativeDraftAction = false;
let draftsKey = '';
function renderAudioDrafts(next: RecordingState) {
  const drafts = next.audioDrafts || [],
    key = JSON.stringify([drafts, nativeDraftAction]);
  q('audio-drafts').hidden = !drafts.length;
  if (key === draftsKey) return;
  draftsKey = key;
  const list = q('audio-draft-list');
  list.replaceChildren();
  for (const draft of drafts) {
    const row = document.createElement('div'),
      title = document.createElement('span'),
      detail = document.createElement('small'),
      actions = document.createElement('div');
    row.className = 'audio-draft-row';
    title.textContent = new Date(draft.createdAt).toLocaleString(document.documentElement.lang);
    detail.textContent = draft.samples
      ? `${format(draft.samples / 48000)} · ${size(draft.bytes)} · WAV`
      : tr('没有完整声音样本');
    title.append(detail);
    for (const action of ['recover', 'discard'] as const) {
      const button = document.createElement('button');
      button.textContent = action === 'recover' ? tr('恢复') : tr('丢弃');
      button.className = action === 'discard' ? 'quiet' : '';
      button.disabled = nativeDraftAction || (action === 'recover' && !draft.samples);
      button.onclick = async () => {
        if (nativeDraftAction || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
        if (action === 'discard' && !(await confirmAction(tr('永久丢弃这份录音草稿？')))) return;
        if (nativeDraftAction || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
        nativeDraftAction = true;
        if (state) renderAudioDrafts(state);
        updateStartAvailability();
        let failure: unknown;
        try {
          if (action === 'recover') await api.recoverAudio(draft.id);
          else await api.discardAudioDraft(draft.id);
        } catch (value) {
          failure = value;
        } finally {
          nativeDraftAction = false;
          await refresh();
          if (failure) error(failure);
        }
      };
      actions.append(button);
    }
    row.append(title, actions);
    list.append(row);
  }
}
type AudioChannel = 'system' | 'microphone';
let gainToken = '',
  gainTimer: ReturnType<typeof setTimeout> | undefined,
  gainPending: { token: string; system: number; microphone: number } | undefined,
  gainInFlight: Promise<void> | undefined;
function updateGainCaption(channel: AudioChannel) {
  q(channel + '-gain-value').textContent = q<HTMLInputElement>(channel + '-gain').value + '%';
  q<HTMLInputElement>(channel + '-gain').disabled =
    q(channel + '-mute').getAttribute('aria-pressed') === 'true';
}
function resetGains(next: RecordingState) {
  clearTimeout(gainTimer);
  gainPending = undefined;
  gainToken = next.token;
  for (const channel of ['system', 'microphone'] as const) {
    const gain = next.gains?.[channel] ?? 1;
    q<HTMLInputElement>(channel + '-gain').value = String(Math.round(gain * 100));
    q(channel + '-mute').setAttribute('aria-pressed', 'false');
    updateGainCaption(channel);
  }
}
function flushGains(): Promise<void> {
  clearTimeout(gainTimer);
  if (gainInFlight) return gainInFlight;
  const task = (async () => {
    while (gainPending) {
      const gain = gainPending;
      gainPending = undefined;
      if (state?.token !== gain.token || !['recording', 'paused'].includes(state.phase)) continue;
      try {
        await api.nativeGain(gain.token, gain.system, gain.microphone);
      } catch (value) {
        if (state?.token === gain.token && ['recording', 'paused'].includes(state.phase)) {
          error(value);
          if (!gainPending) resetGains(state);
        }
      }
    }
  })();
  gainInFlight = task;
  void task.finally(() => {
    if (gainInFlight === task) gainInFlight = undefined;
  });
  return task;
}
function queueGains() {
  if (nativeAction || !state?.backend || !['recording', 'paused'].includes(state.phase)) return;
  const value = (channel: AudioChannel) =>
    q(channel + '-mute').getAttribute('aria-pressed') === 'true'
      ? 0
      : Number(q<HTMLInputElement>(channel + '-gain').value) / 100;
  gainPending = { token: state.token, system: value('system'), microphone: value('microphone') };
  clearTimeout(gainTimer);
  gainTimer = setTimeout(() => void flushGains(), 120);
}
for (const channel of ['system', 'microphone'] as const) {
  q(channel + '-gain').oninput = () => {
    updateGainCaption(channel);
    queueGains();
  };
  q(channel + '-mute').onclick = () => {
    const button = q(channel + '-mute');
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    updateGainCaption(channel);
    queueGains();
  };
}
let regionChoice: { token: string; width: number; height: number } | undefined;
function regionLabel() {
  const camera = sourceMode === 'camera';
  q('source-heading').textContent =
    sourceMode === 'window' ? tr('选择窗口') : camera ? tr('摄像头') : tr('选择显示器');
  q('sources').hidden = camera;
  q('refresh').hidden = false;
  q('primary-camera-options').hidden = !camera;
  q('region-controls').hidden = camera || sourceMode === 'window';
  q('region-label').textContent = regionChoice
    ? tr`${regionChoice.width} × ${regionChoice.height} 像素选区`
    : sourceMode === 'region'
      ? tr('未选择区域')
      : '';
  q('clear-region').hidden = !regionChoice;
  q<HTMLButtonElement>('choose-region').disabled =
    choosingRegion || loadingSources || !sourceId.startsWith('screen:');
  q<HTMLButtonElement>('choose-region-menu').disabled =
    q<HTMLButtonElement>('choose-region').disabled;
  q('choose-region').hidden = sourceMode === 'window';
  for (const [id, mode] of [
    ['screens', 'screen'],
    ['windows', 'window'],
    ['camera-source', 'camera'],
  ] as const) {
    const selected =
      recordMode === 'video' &&
      (mode === sourceMode || (mode === 'screen' && sourceMode === 'region'));
    q(id).classList.toggle('selected', selected);
    q(id).setAttribute('aria-pressed', String(selected));
    q(id).setAttribute('aria-selected', String(selected));
  }
}
function clearRegion() {
  regionChoice = undefined;
  regionLabel();
}
function updateStartAvailability() {
  q<HTMLButtonElement>('start').disabled =
    !pageActive || closing || disposed ||
    !!run ||
    nativeStarting ||
    nativeDraftAction ||
    !!state?.projectBusy ||
    (!!state && !['idle', 'ready'].includes(state.phase)) ||
    choosingRegion ||
    loadingSources ||
    (recordMode === 'video' &&
      nativeMode() &&
      (sourceMode === 'camera' || q<HTMLInputElement>('camera-enabled').checked) &&
      (cameraLoading || !q<HTMLSelectElement>('camera-device').value)) ||
    (recordMode === 'video' && sourceMode !== 'camera' && !sourceId) ||
    (recordMode === 'video' && sourceMode === 'region' && !regionChoice) ||
    (recordMode === 'audio' &&
      !q<HTMLInputElement>('system-audio').checked &&
      !q<HTMLInputElement>('microphone').checked);
  soundTests.update(
    nativeStarting ||
      !!run ||
      !!state?.projectBusy ||
      (!!state && !['idle', 'ready'].includes(state.phase)),
  );
  updateSetupSummary();
  if (api.startAvailability)
    void api.startAvailability(!q<HTMLButtonElement>('start').disabled).catch(error);
}
function updateSetupSummary() {
  const sound = [
    q<HTMLInputElement>('system-audio').checked ? tr('系统声音') : '',
    q<HTMLInputElement>('microphone').checked ? tr('麦克风') : '',
  ]
    .filter(Boolean)
    .join(' + ');
  const source =
    sourceMode === 'camera'
      ? q<HTMLSelectElement>('camera-source-device').selectedOptions[0]?.textContent
      : sources.find((source) => source.id === sourceId)?.name;
  const container = q<HTMLSelectElement>('record-container'),
    extension =
      container.value === 'mp4'
        ? recordMode === 'audio'
          ? 'M4A'
          : 'MP4'
        : container.value.toUpperCase();
  q('start-summary').textContent =
    recordMode === 'audio'
      ? sound || tr('选择至少一种声音来源')
      : loadingSources
        ? tr('正在加载来源…')
        : sourceMode === 'region' && !regionChoice
          ? tr('尚未选择录制区域')
          : source
            ? source + (regionChoice ? ` · ${regionChoice.width} × ${regionChoice.height}` : '')
            : tr('选择录制来源');
  const delay = Number(q<HTMLSelectElement>('record-delay').value);
  q('start-hint').textContent =
    recordMode === 'audio' && !sound
      ? tr('开启系统声音或麦克风后即可开始录音。')
      : [
          extension,
          ...(recordMode === 'video'
            ? [q<HTMLSelectElement>('fps').value + ' fps', sound || tr('无声音')]
            : []),
          ...(nativeMode() && delay ? [tr`${delay} 秒后开始`] : []),
        ].join(' · ');
  command('start', recordMode === 'audio' ? Mic : Video, recordMode === 'audio' ? tr('开始录音') : tr('开始录制'), recordMode);
}
const elapsed = (r: Run) =>
  r.started ? ((r.pausedAt || performance.now()) - r.started - r.pausedMs) / 1000 : 0;
function release(r: Run) {
  r.abort.abort();
  r.cropDispose?.();
  clearInterval(r.timer);
  if (r.recorder) {
    r.recorder.ondataavailable = null;
    r.recorder.onstop = null;
    r.recorder.onerror = null;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
  }
  for (const stream of r.streams) for (const track of stream.getTracks()) track.stop();
  const closed=r.context?.close().catch(() => {});
  if (run === r) run = undefined;
  void Promise.resolve(closed).then(()=>r.complete());
}
async function fail(r: Run, value: unknown) {
  if (run !== r) return;
  release(r);
  await api.fail(r.token, errorMessage(value)).catch(() => {});
  error(value);
}
async function accept(r: Run, promise: Promise<MediaStream>) {
  const stream = await promise;
  if (run !== r) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(tr('录制已取消'));
  }
  r.streams.push(stream);
  return stream;
}
function renderSources() {
  const list = q('sources');
  list.replaceChildren();
  const filtered = sources.filter((s) => s.type === sourceType);
  list.setAttribute('aria-busy', String(loadingSources));
  if (!loadingSources && !filtered.some((s) => s.id === sourceId)) {
    sourceId = filtered[0]?.id || '';
    clearRegion();
  }
  regionLabel();
  list.innerHTML = filtered
    .map((source) =>
      sourceCard({
        key: source.id,
        attribute: 'data-id',
        name: source.name,
        thumbnail: source.thumbnail,
        meta: source.width && source.height ? source.width + ' × ' + source.height : undefined,
        selected: source.id === sourceId,
        disabled: loadingSources,
        kind: source.type,
      }),
    )
    .join('');
  bindSourceCardPreviews(list);
  list.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(
    (button) =>
      (button.onclick = () => {
        if (sourceId !== button.dataset.id) clearRegion();
        sourceId = button.dataset.id!;
        renderSources();
      }),
  );
  if (!filtered.length && loadingSources) {
    for (let i = 0; i < 2; i++) {
      const placeholder = document.createElement('div');
      placeholder.className = 'source-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      list.append(placeholder);
    }
  } else if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = tr('没有可用来源，可打开窗口后刷新');
    list.append(p);
  }
  updateStartAvailability();
}
function loadSources():Promise<void>{
  if(sourceTask&&sourceTaskType===sourceType)return sourceTask;
  sourceTaskType=sourceType;
  const task=loadSourcesOnce();sourceTask=task;
  void task.finally(()=>{if(sourceTask===task)sourceTask=undefined;}).catch(()=>{});
  return task;
}
async function loadSourcesOnce() {
  if(!pageActive||closing||disposed)return;
  if (choosingRegion || recordMode === 'audio' || sourceMode === 'camera') return;
  const request = ++sourceRequest;
  loadingSources = true;
  q<HTMLButtonElement>('refresh').disabled = true;
  renderSources();
  try {
    const next = await api.sources(sourceType);
    if (
      request !== sourceRequest ||
      choosingRegion ||
      !['idle', 'ready'].includes(state?.phase || 'idle')
    )
      return;
    sources = next;
  } catch (e) {
    if (request === sourceRequest) error(e);
  } finally {
    if (request === sourceRequest) {
      loadingSources = false;
      renderSources();
      if (!choosingRegion) q<HTMLButtonElement>('refresh').disabled = false;
    }
  }
}

async function refresh() {
  const id = ++refreshId;
  try {
    const next = await api.state();
    if (disposed || id !== refreshId) return;
    const previous = state;
    state = next;
    renderAudioDrafts(next);
    if (next.token !== gainToken) resetGains(next);
    const active = ['arming', 'recording', 'paused', 'stopping'].includes(next.phase);
    page.dataset.recording = String(active);
    page.dataset.recordingPhase = next.phase;
    q('record-kind').textContent =
      next.options?.mode === 'audio'
        ? tr('仅录音')
        : next.options?.videoSource === 'camera'
          ? tr('摄像头素材')
          : tr('录制画面');
    const cameraLive = q<HTMLImageElement>('camera-live');
    cameraLive.hidden = !next.cameraLiveUrl;
    if (next.cameraLiveUrl && cameraLive.getAttribute('src') !== next.cameraLiveUrl)
      cameraLive.src = next.cameraLiveUrl;
    else if (!next.cameraLiveUrl) cameraLive.removeAttribute('src');
    q('record-meter').hidden = !next.options?.systemAudio && !next.options?.microphone;
    q('audio-mixer').hidden =
      !next.backend || !active || (!next.options?.systemAudio && !next.options?.microphone);
    q<HTMLFieldSetElement>('audio-mixer').disabled =
      nativeAction || !['recording', 'paused'].includes(next.phase);
    q('system-channel').hidden = !next.options?.systemAudio;
    q('microphone-channel').hidden = !next.options?.microphone;
    q<HTMLMeterElement>('system-level').value = next.levels?.system || 0;
    q<HTMLMeterElement>('microphone-level').value = next.levels?.microphone || 0;
    q('setup').hidden = !['idle', 'ready', 'saving'].includes(next.phase);
    q('start').hidden = active;
    q('start').title = next.projectBusy ? '正在保存素材工程…' : '开始录制';
    q('active').hidden = !active;
    q('cancel-import').hidden = !next.importing;
    const openedProject = /^已打开录制工程/.test(next.message);
    const processing = /^正在处理(视频|录音)$/.test(next.message);
    const noticeKey = next.message && !processing ? next.token + next.message : '';
    if (noticeKey && noticeKey !== stateNotice)
      notify(openedProject ? '已打开录制工程' : next.message);
    stateNotice = noticeKey;
    q('phase-label').textContent =
      (
        {
          arming: tr('正在准备'),
          recording: tr('正在录制'),
          paused: tr('已暂停'),
          stopping: tr('正在处理'),
        } as Record<string, string>
      )[next.phase] || '';
    q<HTMLButtonElement>('pause').disabled =
      nativeAction || !['recording', 'paused'].includes(next.phase);
    command(
      'pause',
      next.phase === 'paused' ? Play : Pause,
      next.phase === 'paused' ? tr('继续') : tr('暂停'),
      next.phase === 'paused' ? 'resume' : 'pause',
    );
    q<HTMLButtonElement>('stop').disabled =
      nativeAction || (!next.retryAudio && !['recording', 'paused'].includes(next.phase));
    command(
      'stop',
      Square,
      next.retryAudio ? tr('重试处理') : tr('停止并预览'),
      next.retryAudio ? 'retry' : 'stop',
    );
    q('size').textContent = size(next.bytes);
    if (next.phase === 'arming') q('elapsed').textContent = '00:00';
    if (!!next.backend) {
      q('elapsed').textContent = format(next.seconds);
      q<HTMLMeterElement>('level').value = next.levels?.mixed || 0;
      q('level-label').textContent = next.levels?.clipped ? tr('音量过高') : tr('声音');
    }
    if (run && next.token !== run.token && run.token) release(run);
    if (
      !nativeStarting &&
      !choosingRegion &&
      ['idle', 'ready'].includes(next.phase) &&
      next.phase !== previous?.phase
    ) {
      clearRegion();
      void loadSources();
    }
    updateStartAvailability();
    if (next.phase !== previous?.phase) void cameraCardPreview();
  } catch (e) {
    if (run) release(run);
    error(e);
  }
}
function start(){if(startTask)return startTask;return startTask=startOnce().finally(()=>{startTask=undefined;});}
async function startOnce() {
  if (
    closing || disposed || !pageActive ||
    run ||
    nativeStarting ||
    loadingSources ||
    choosingRegion ||
    !['idle', 'ready'].includes(state?.phase || 'idle')
  )
    return;
  nativeStarting = true;
  updateStartAvailability();
  try {
    cameraPreviewRevision++;
    clearTimeout(cameraPreviewTimer);
    await api.cameraSetup?.(null);
    if(closing||disposed)return;
    if (state?.phase === 'ready') {
      await api.prepareNext();
      state = { ...state, phase: 'idle' };
    }
    if (recordMode === 'video' && sourceMode !== 'camera') {
      // Main validates this selected window/monitor again when arming. Building
      // every thumbnail here serially delays Start by the whole catalog scan.
      if (!sources.some((source) => source.id === sourceId)) throw Error(tr('请选择录制来源'));
    }
  } catch (e) {
    nativeStarting = false;
    updateStartAvailability();
    error(e);
    return;
  } finally {
    nativeStarting = false;
  }
  if(closing||disposed)return;
  const options: RecordingOptions = {
    container: q<HTMLSelectElement>('record-container').value as RecordingOptions['container'],
    mode: recordMode,
    sourceId: recordMode === 'video' && sourceMode !== 'camera' ? sourceId : '',
    ...(recordMode === 'video' && sourceMode === 'camera'
      ? { videoSource: 'camera' as const }
      : {}),
    systemAudio: q<HTMLInputElement>('system-audio').checked,
    microphone: q<HTMLInputElement>('microphone').checked,
    microphoneId: q<HTMLSelectElement>('microphone-device').value,
    fps: Number(q<HTMLSelectElement>('fps').value) as 15 | 30 | 60,
    maxWidth: Number(q<HTMLSelectElement>('resolution').value) as 1920 | 2560,
    ...(nativeMode() ? { delay: Number(q<HTMLSelectElement>('record-delay').value) } : {}),
    ...(recordMode === 'video' && sourceMode !== 'camera' && regionChoice
      ? { regionToken: regionChoice.token }
      : {}),
    ...(recordMode === 'video' && nativeMode()
      ? {
          videoBitrate: Number(
            q<HTMLSelectElement>('video-bitrate').value,
          ) as RecordingOptions['videoBitrate'],
          videoEncoder: q<HTMLSelectElement>('video-encoder')
            .value as RecordingOptions['videoEncoder'],
          cursor: sourceMode === 'camera' ? false : q<HTMLInputElement>('record-cursor').checked,
          ...(sourceMode !== 'camera' ? { input: setupInput } : {}),
          ...(sourceMode === 'camera' || q<HTMLInputElement>('camera-enabled').checked
            ? {
                camera: {
                  deviceId: q<HTMLSelectElement>('camera-device').value,
                  style: setupCamera,
                },
              }
            : {}),
        }
      : {}),
    ...(nativeMode()
      ? {
          systemAudioId: q<HTMLSelectElement>('system-device').value,
          audioBitrate: Number(
            q<HTMLSelectElement>('audio-bitrate').value || 128000,
          ) as RecordingOptions['audioBitrate'],
        }
      : {}),
  };
  if (nativeMode()) {
    nativeStarting = true;
    updateStartAvailability();
    try {
      if (options.systemAudio || options.microphone) await loadNativeDevices();
      if(closing||disposed)return;
      if (!['idle', 'ready'].includes(state?.phase || 'idle')) return;
      if (
        (options.systemAudio || options.microphone) &&
        options.container !== 'wav' &&
        !nativeDevices!.bitrates.includes(options.audioBitrate!)
      )
        throw Error(tr('此系统不支持所选 AAC 质量，请选择 WAV 或其他质量'));
      await api.nativeStart(options);
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      nativeStarting = false;
      updateStartAvailability();
    }
    return;
  }
  const mime = recordingMime(
    options.mode,
    options.systemAudio || options.microphone,
    options.container,
  );
  if (!MediaRecorder.isTypeSupported(mime)) {
    error(tr('此系统不支持所选编码器，请选择其他录制格式'));
    updateStartAvailability();
    return;
  }
  let complete!:()=>void;
  const done=new Promise<void>(resolve=>{complete=resolve;});
  const r: Run = {
    done,complete,
    abort: new AbortController(),
    token: '',
    streams: [],
    chain: Promise.resolve(),
    sequence: 0,
    queued: 0,
    written: 0,
    started: 0,
    pausedAt: 0,
    pausedMs: 0,
    ending: false,
    reason: '',
  };
  run = r;
  q<HTMLButtonElement>('start').disabled = true;
  try {
    r.token = await api.arm(options);
    if (run !== r) throw new Error(tr('录制已取消'));
    const region = (await api.state()).region;
    if (run !== r) throw new Error(tr('录制已取消'));
    let desktop: MediaStream | undefined, mic: MediaStream | undefined;
    const mixed = new MediaStream();
    if (options.mode === 'video' || options.systemAudio) {
      desktop = await accept(
        r,
        navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: options.fps, max: options.fps },
            width: { max: region?.screen.width || options.maxWidth },
            height: { max: region?.screen.height || options.maxWidth },
          },
          audio: options.systemAudio,
        }),
      );
      if (options.systemAudio && !desktop.getAudioTracks().length)
        throw new Error(tr('没有取得系统声音轨道'));
      if (options.mode === 'video') {
        const video = desktop.getVideoTracks()[0];
        if (!video) throw new Error(tr('没有取得画面轨道'));
        if (region) {
          const cropped = await cropStream(
            desktop,
            region,
            options.maxWidth,
            options.fps,
            r.abort.signal,
            () => {
              if (r.recorder?.state === 'recording' || r.recorder?.state === 'paused')
                stop(tr('显示器画面尺寸已改变，请重新选择区域'));
              else void fail(r, tr('显示器画面尺寸已改变，请重新选择区域'));
            },
          );
          r.cropDispose = cropped.dispose;
          r.streams.push(cropped.stream);
          if (run !== r) {
            cropped.dispose();
            throw new Error(tr('录制已取消'));
          }
          mixed.addTrack(cropped.stream.getVideoTracks()[0]);
        } else mixed.addTrack(video);
      } else desktop.getVideoTracks().forEach((t) => t.stop());
    }
    if (options.microphone) {
      mic = await accept(
        r,
        navigator.mediaDevices.getUserMedia({
          video: false,
          audio: options.microphoneId
            ? { deviceId: { exact: options.microphoneId }, echoCancellation: true }
            : { echoCancellation: true },
        }),
      );
      if (!mic.getAudioTracks().length) throw new Error(tr('没有取得麦克风轨道'));
    }
    const audio = [desktop, mic].filter(
      (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
    );
    if (audio.length) {
      const context = new AudioContext();
      r.context = context;
      await context.resume();
      if (run !== r) throw new Error(tr('录制已取消'));
      const destination = context.createMediaStreamDestination(),
        analyser = context.createAnalyser();
      analyser.fftSize = 256;
      r.analyser = analyser;
      for (const stream of audio) {
        const input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        const gain = context.createGain();
        gain.gain.value = audio.length > 1 ? 0.5 : 1;
        input.connect(gain);
        gain.connect(destination);
        gain.connect(analyser);
      }
      mixed.addTrack(destination.stream.getAudioTracks()[0]);
      r.streams.push(destination.stream);
    }
    if (run !== r) throw new Error(tr('录制已取消'));
    const recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: options.maxWidth === 2560 ? 12000000 : 6000000,
      audioBitsPerSecond: 128000,
    });
    r.recorder = recorder;
    recorder.ondataavailable = (e: { data: Blob }) => {
      if (run !== r || !e.data.size) return;
      if (r.queued + e.data.size > RECORD_CHUNK * 3) {
        void fail(r, tr('磁盘写入跟不上录制，已停止；请降低帧率后重试'));
        return;
      }
      r.queued += e.data.size;
      r.chain = r.chain
        .then(async () => {
          const data = new Uint8Array(await e.data.arrayBuffer());
          for (let offset = 0; offset < data.byteLength; offset += RECORD_CHUNK) {
            if (run !== r) throw new Error(tr('录制已取消'));
            const part = data.subarray(offset, offset + RECORD_CHUNK);
            await api.chunk(r.token, r.sequence++, part);
            r.written += part.length;
            q('size').textContent = size(r.written);
          }
        })
        .finally(() => (r.queued -= e.data.size));
      void r.chain.catch((e) => fail(r, e));
    };
    recorder.onerror = (e: unknown) => void fail(r, (e as ErrorEvent).error || tr('编码器失败'));
    recorder.onstop = () => {
      if (run !== r) return;
      const duration = Math.min(RECORD_SECONDS + 5, elapsed(r));
      for (const stream of r.streams) stream.getTracks().forEach((t) => t.stop());
      void r.chain
        .then(async () => {
          if (run !== r) return;
          await api.finish(r.token, duration, r.reason, recorder.mimeType);
          release(r);
          await refresh();
        })
        .catch((e) => fail(r, e));
    };
    await api.started(r.token, recorder.mimeType);
    if (run !== r) throw new Error(tr('录制已取消'));
    r.started = performance.now();
    recorder.start(750);
    for (const stream of r.streams)
      for (const track of stream.getTracks())
        track.onended = () => {
          if (run === r && !r.ending) stop(tr('录制来源已结束'));
        };
    r.timer = setInterval(() => {
      if (run !== r) return;
      const seconds = elapsed(r);
      q('elapsed').textContent = format(seconds);
      const samples = new Float32Array(r.analyser?.fftSize || 0);
      r.analyser?.getFloatTimeDomainData(samples);
      q<HTMLMeterElement>('level').value =
        !r.pausedAt && !r.ending && samples.length
          ? Math.min(1, Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length) * 5)
          : 0;
      void api.heartbeat(r.token, Math.min(RECORD_SECONDS + 5, seconds)).catch((e) => fail(r, e));
      if (seconds >= RECORD_SECONDS) stop(tr('已达到 60 分钟上限'));
    }, 500);
    await refresh();
  } catch (e) {
    if (run === r) await fail(r, e);
    else release(r);
  } finally {
    updateStartAvailability();
  }
}
function stop(reason = '') {
  if (!!state?.backend) {
    if (
      nativeAction ||
      (!state.retryAudio && !['recording', 'paused', 'stopping'].includes(state.phase))
    )
      return;
    nativeAction = true;
    q<HTMLButtonElement>('stop').disabled = true;
    q<HTMLButtonElement>('pause').disabled = true;
    q<HTMLFieldSetElement>('audio-mixer').disabled = true;
    const token = state.token;
    void flushGains()
      .then(() => api.nativeStop(token))
      .catch(error)
      .finally(async () => {
        nativeAction = false;
        await refresh();
      });
    return;
  }
  const r = run;
  if (!r || r.ending || !r.recorder || r.recorder.state === 'inactive') return;
  r.ending = true;
  r.reason = reason;
  if (r.pausedAt) {
    r.pausedMs += performance.now() - r.pausedAt;
    r.pausedAt = 0;
  }
  r.recorder.stop();
  q('phase-label').textContent = tr('正在处理');
  page.dataset.recordingPhase = 'stopping';
  q<HTMLMeterElement>('level').value = 0;
  q<HTMLButtonElement>('stop').disabled = true;
  q<HTMLButtonElement>('pause').disabled = true;
}
async function chooseRegion(hideMain = true) {
  if (
    choosingRegion ||
    loadingSources ||
    !sourceId.startsWith('screen:') ||
    !['idle', 'ready'].includes(state?.phase || 'idle')
  )
    return;
  choosingRegion = true;
  sourceRequest++;
  q<HTMLButtonElement>('refresh').disabled = true;
  updateStartAvailability();
  q<HTMLButtonElement>('choose-region').disabled = true;
  await api
    .chooseRegion(sourceId, hideMain)
    .then((result) => {
      if (result) {
        regionChoice = result;
        sourceMode = 'region';
      }
      regionLabel();
    })
    .catch(error)
    .finally(() => {
      choosingRegion = false;
      q<HTMLButtonElement>('refresh').disabled = false;
      updateStartAvailability();
      regionLabel();
    });
}
q('clear-region').onclick = () => {
  sourceMode = 'screen';
  clearRegion();
  updateStartAvailability();
};
q('start').onclick = () => void start();
q('stop').onclick = () => stop();
q('pause').onclick = async () => {
  if (!!state?.backend) {
    if (nativeAction || !['recording', 'paused'].includes(state.phase)) return;
    nativeAction = true;
    q<HTMLButtonElement>('pause').disabled = true;
    q<HTMLButtonElement>('stop').disabled = true;
    q<HTMLFieldSetElement>('audio-mixer').disabled = true;
    const token = state.token,
      paused = state.phase === 'recording';
    try {
      await flushGains();
      await api.nativePause(token, paused);
    } catch (e) {
      error(e);
    } finally {
      nativeAction = false;
      await refresh();
    }
    return;
  }
  const r = run;
  if (!r?.recorder || r.ending) return;
  try {
    const pause = r.recorder.state === 'recording';
    if (pause) {
      r.recorder.pause();
      r.pausedAt = performance.now();
      q<HTMLMeterElement>('level').value = 0;
    } else {
      r.recorder.resume();
      r.pausedMs += performance.now() - r.pausedAt;
      r.pausedAt = 0;
    }
    await api.paused(r.token, pause);
    await refresh();
  } catch (e) {
    void fail(r, e);
  }
};
const discard = async () => {
  if (
    (run ||
      state?.projectBusy ||
      state?.projectDirty ||
      (!state?.projectSaved && (!state?.saved || (state.cameraUrl && !state.cameraSaved)))) &&
    !(await confirmAction(tr('放弃尚未保存的录制？')))
  )
    return;
  if (run) release(run);
  await api.cancel();
  await refresh();
};
q('discard').onclick = () => void discard().catch(error);

q('cancel-import').onclick = () => void api.cancelImport().catch(error);
q('refresh').onclick = () => void (sourceMode === 'camera' ? loadCameras() : loadSources());
let screenContainer = 'mp4';
for (const [id, mode] of [
  ['screens', 'screen'],
  ['windows', 'window'],
  ['camera-source', 'camera'],
] as const)
  q(id).onclick = async () => {
    if (nativeStarting || choosingRegion || !['idle', 'ready'].includes(state?.phase || 'idle'))
      return;
    if (recordMode === 'audio') changeRecordMode('video', false);
    const previousMode = sourceMode;
    if (mode === 'camera' && previousMode !== 'camera')
      screenContainer = q<HTMLSelectElement>('record-container').value;
    sourceMode = mode;
    sourceRequest++;
    loadingSources = false;
    q<HTMLButtonElement>('refresh').disabled = false;
    if (mode === 'camera') q<HTMLSelectElement>('record-container').value = 'mp4';
    else if (previousMode === 'camera')
      q<HTMLSelectElement>('record-container').value = screenContainer;
    const type = mode === 'window' ? 'window' : 'screen';
    clearRegion();
    const changed = sourceType !== type;
    sourceType = type;
    regionLabel();
    audioControls();
    updateStartAvailability();
    if (mode === 'camera') {
      await loadCameras();
      return;
    }
    void cameraCardPreview();
    if (changed || !sourceId || !sources.length) await loadSources();
  };
const modeContainers = { video: 'mp4', audio: 'mp4' };
function changeRecordMode(mode: 'video' | 'audio', reloadSources = true) {
  if (nativeStarting || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
  if (recordMode === mode) return;
  modeContainers[recordMode] = q<HTMLSelectElement>('record-container').value;
  recordMode = mode;
  void cameraCardPreview();
  page.dataset.recordMode = mode;
  for (const value of ['video', 'audio'] as const) {
    const button = q('record-' + value);
    button.classList.toggle('selected', value === mode);
    button.setAttribute('aria-pressed', String(value === mode));
    button.setAttribute('aria-selected', String(value === mode));
  }
  q('video-settings').hidden = mode === 'audio';
  q('video-settings').closest<HTMLElement>('.record-source-pane')!.hidden = mode === 'audio';
  const outputCard = q('output-heading').parentElement!;
  const soundCard = q('sound-heading').closest<HTMLElement>('.record-sound-card')!;
  // Reuse the live controls so switching recording modes retains device and quality choices.
  q('config-basic').insertBefore(mode === 'audio' ? soundCard : outputCard, mode === 'audio' ? outputCard : soundCard);
  (mode === 'audio' ? outputCard : q('config-quality')).append(q('quality-settings'));
  q('quality-title').closest<HTMLElement>('.record-card-heading')!.hidden = mode === 'audio';
  q('output-heading').classList.toggle('sr-only', mode !== 'audio');
  q('output-heading').textContent = mode === 'audio' ? tr('录音设置') : tr('基本设置');
  q('audio-settings').hidden = mode !== 'audio';
  q('mode-description').textContent =
    mode === 'audio'
      ? tr('录制系统声音、麦克风，或同时录制两者。')
      : tr('选择屏幕、窗口、矩形区域或摄像头，可同时录制声音。');
  q('video-quality').hidden = mode === 'audio';
  q('resolution-field').hidden = mode === 'audio';
  if (mode === 'audio') {
    sourceRequest++;
    loadingSources = false;
    q<HTMLButtonElement>('refresh').disabled = false;
    updateStartAvailability();
  } else if (reloadSources) void loadSources();
  q<HTMLSelectElement>('record-container').value = modeContainers[mode];
  const wav =
    q<HTMLSelectElement>('record-container').querySelector<HTMLOptionElement>('[value=wav]')!;
  wav.disabled = mode !== 'audio';
  if (mode !== 'audio' && q<HTMLSelectElement>('record-container').value === 'wav')
    q<HTMLSelectElement>('record-container').value = 'mp4';
  const webm =
    q<HTMLSelectElement>('record-container').querySelector<HTMLOptionElement>('[value=webm]')!;
  webm.disabled = mode === 'audio' || sourceMode === 'camera';
  if (mode === 'audio' && q<HTMLSelectElement>('record-container').value === 'webm')
    q<HTMLSelectElement>('record-container').value = 'mp4';
  regionLabel();
  populateMicrophones();
  audioControls();
  updateStartAvailability();
  if (mode === 'audio') void loadNativeDevices().catch(error);
}
for (const mode of ['video', 'audio'] as const)
  q('record-' + mode).onclick = () => changeRecordMode(mode);
// Device enumeration starts Chromium's audio/video services even for silent video.
// Keep the default microphone usable immediately; enumerate only when requested.
let microphonesLoaded = false,
  microphonesLoading: Promise<void> | undefined,
  chromiumMicrophones: MediaDeviceInfo[] = [];
let nativeDevices: AudioCapabilities | undefined, nativeDevicesLoading: Promise<void> | undefined;
function deviceOptions(select: HTMLSelectElement, devices: { id: string; name: string }[]) {
  const selected = select.value;
  select.querySelectorAll('option:not([value=""])').forEach((option) => option.remove());
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = device.name;
    select.append(option);
  }
  select.value = [...select.options].some((option) => option.value === selected) ? selected : '';
}
function populateMicrophones() {
  deviceOptions(
    q<HTMLSelectElement>('microphone-device'),
    nativeMode()
      ? (nativeDevices?.devices || []).filter((d) => d.kind === 'microphone')
      : chromiumMicrophones.map((d, i) => ({
          id: d.deviceId,
          name: d.label || tr`麦克风 ${i + 1}`,
        })),
  );
}
function nativeMode() {
  return recordMode === 'audio' || q<HTMLSelectElement>('record-container').value !== 'webm';
}
function audioControls() {
  const native = nativeMode(),
    audio = recordMode === 'audio',
    container = q<HTMLSelectElement>('record-container');
  q('system-device-field').hidden = !native;
  q<HTMLSelectElement>('system-device').disabled =
    !native || !q<HTMLInputElement>('system-audio').checked;
  q('record-delay-field').hidden = !native;
  q('native-video-quality').hidden = audio || !native;
  q('input-settings').hidden = audio || !native || sourceMode === 'camera';
  q('camera-settings').hidden = audio || !native || sourceMode === 'camera';
  q('record-cursor').closest<HTMLElement>('label')!.hidden = audio || sourceMode === 'camera';
  container.querySelector<HTMLOptionElement>('[value=webm]')!.disabled =
    audio || sourceMode === 'camera';
  if (!audio && sourceMode === 'camera') container.value = 'mp4';
  const mp4 = container.querySelector<HTMLOptionElement>('[value=mp4]')!;
  mp4.disabled = audio && !!nativeDevices && !nativeDevices.bitrates.length;
  mp4.textContent = audio ? 'M4A' : 'MP4';
  if (mp4.disabled && container.value === 'mp4') container.value = 'wav';
  q('audio-bitrate-field').hidden =
    !native ||
    container.value !== 'mp4' ||
    (!q<HTMLInputElement>('system-audio').checked && !q<HTMLInputElement>('microphone').checked);
  q('quality-settings').hidden = false;
  q('quality-empty').hidden = !audio || !q('audio-bitrate-field').hidden;
  q('quality-empty').textContent =
    container.value === 'wav'
      ? 'WAV 保留原始音质，无需压缩设置。'
      : '开启声音来源后可调整音频质量。';
  q('quality-title').textContent = audio ? tr('音频质量') : tr('画质与编码');
  q('quality-settings').querySelector('.record-caption')!.textContent = audio
    ? tr('音频码率')
    : tr('分辨率、码率与鼠标指针');
  for (const channel of ['system', 'microphone'] as const) {
    const enabled = q<HTMLInputElement>(
      channel === 'system' ? 'system-audio' : 'microphone',
    ).checked;
    q(channel === 'system' ? 'system-sound-source' : 'microphone-sound-source').dataset.enabled =
      String(enabled);
    q(channel === 'system' ? 'system-sound-status' : 'microphone-sound-status').textContent =
      enabled ? tr('已开启') : channel === 'system' ? tr('未录制系统声音') : tr('未录制麦克风');
  }
  selectConfigTab();
  updateSetupSummary();
}
function loadNativeDevices(): Promise<void> {
  if (nativeDevicesLoading) return nativeDevicesLoading;
  if (nativeDevices) return Promise.resolve();
  nativeDevicesLoading = api
    .audioDevices()
    .then((devices) => {
      nativeDevices = devices;
      if(closing||disposed)return;
      if (!nativeMode() || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
      deviceOptions(
        q<HTMLSelectElement>('system-device'),
        devices.devices.filter((d) => d.kind === 'system'),
      );
      populateMicrophones();
      const bitrate = q<HTMLSelectElement>('audio-bitrate'),
        selected = bitrate.value;
      bitrate.replaceChildren(
        ...devices.bitrates.map((value) => {
          const option = document.createElement('option');
          option.value = String(value);
          option.textContent = `${value / 1000} kbps`;
          return option;
        }),
      );
      bitrate.value = devices.bitrates.includes(Number(selected))
        ? selected
        : String(devices.bitrates.includes(128000) ? 128000 : devices.bitrates[0] || '');
      audioControls();
    })
    .finally(() => {
      nativeDevicesLoading = undefined;
    });
  return nativeDevicesLoading;
}
function loadMicrophones(): Promise<void> {
  if (nativeMode()) return loadNativeDevices();
  if (microphonesLoading) return microphonesLoading;
  if (microphonesLoaded) return Promise.resolve();
  microphonesLoading = (async () => {
    const token = await api.beginMicrophoneList();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        navigator.mediaDevices.enumerateDevices(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Device list timed out')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      await api.endMicrophoneList(token).catch(() => {});
    }
  })()
    .then((devices) => {
      if (closing || disposed || run || !['idle', 'ready'].includes(state?.phase || 'idle')) return;
      chromiumMicrophones = devices.filter(
        (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default',
      );
      if (recordMode === 'video') populateMicrophones();
      microphonesLoaded = true;
    })
    .catch(error)
    .finally(() => (microphonesLoading = undefined));
  return microphonesLoading;
}
q('microphone').onchange = () => {
  const enabled = q<HTMLInputElement>('microphone').checked;
  q<HTMLSelectElement>('microphone-device').disabled = !enabled;
  audioControls();
  updateStartAvailability();
};
q('system-audio').onchange = () => {
  audioControls();
  updateStartAvailability();
};
q('record-container').onchange = () => {
  populateMicrophones();
  audioControls();
};
for (const id of ['fps', 'record-delay']) q(id).addEventListener('change', updateSetupSummary);
audioControls();
q<HTMLSelectElement>('microphone-device').disabled = true;
setSelectLoader(q<HTMLSelectElement>('microphone-device'),async()=>{await loadMicrophones();return selectOptions(q<HTMLSelectElement>('microphone-device'));});
setSelectLoader(q<HTMLSelectElement>('system-device'),async()=>{await loadNativeDevices();return selectOptions(q<HTMLSelectElement>('system-device'));});
cleanups.push(api.onChange(()=>{if(!disposed)void refresh();}));
cleanups.push(api.onStop(() => {
  void api
    .state()
    .then((next) => {
      if(disposed)return;
      if (!!next.backend && next.phase === 'stopping') {
        state = next;
        stop(next.message);
        return;
      }
      if (run && next.token === run.token && next.phase === 'stopping') stop(next.message);
      else if (run) release(run);
    })
    .catch(() => {
      if (run) release(run);
    });
}));

cleanups.push(api.onStart(()=>{if(pageActive&&!q<HTMLButtonElement>('start').disabled)void start().catch(error);}));
const segmentRoot=page.closest<HTMLElement>('#app')||page;
const segments=setupSegments(segmentRoot);customControls(page);customControls(heading);
function selectOptions(select:HTMLSelectElement){return [...select.options].map(option=>({label:option.text,value:option.value,disabled:option.disabled}));}
async function activate(value:boolean){
 if(disposed||closing)return;
 const revision=++activationRevision;
 pageActive=value;closeControls();
 await api.pageActive(value);
 if(revision!==activationRevision||disposed||closing)return;
 await soundTests.activate(value&&!document.hidden);
 if(!value){++sourceRequest;sourceTask=undefined;loadingSources=false;clearTimeout(cameraPreviewTimer);++cameraPreviewRevision;await api.cameraSetup(null);}
 else {await refresh();if(revision!==activationRevision||disposed||closing)return;if(['idle','ready'].includes(state?.phase||'idle')){if(sourceMode==='camera')await loadCameras();else await loadSources();}await cameraCardPreview();segments.refresh();}
 updateStartAvailability();
}
async function dispose(){
 if(disposal)return disposal;
 closing=true;pageActive=false;++activationRevision;updateStartAvailability();
 return disposal=(async()=>{
   await api.pageActive(false);
   await soundTests.dispose();++cameraPreviewRevision;clearTimeout(cameraPreviewTimer);await api.cameraSetup(null);
   const cancelledStartup=!!run&&!run.started;
   if(cancelledStartup){release(run!);await api.cancel();}
   await startTask;
   if(cancelledStartup)await api.cancel();
   const current=run;if(current){stop('录制页面已关闭');await current.done;}
   const latest=await api.state();
   if(latest.backend&&['arming','recording','paused','stopping'].includes(latest.phase)){if(latest.phase==='arming')await api.cancel();else {await flushGains();await api.nativeStop(latest.token);}}
   disposed=true;++refreshId;++sourceRequest;events.abort();clearTimeout(gainTimer);closeControls();if(segmentRoot===page)segments.dispose();disposeFeedback(q('toast'));
   for(const cleanup of cleanups.splice(0))cleanup();
   page.replaceChildren();heading.replaceChildren();elements.clear();
 })().catch(value=>{disposal=undefined;error(value);throw value;});
}
window.addEventListener('beforeunload',event=>{if(!disposed&&(run||nativeStarting||['arming','recording','paused','stopping'].includes(state?.phase||''))){event.preventDefault();event.returnValue='';}},{signal:events.signal});
cleanups.push(onRemoval(page,()=>{void dispose().catch(()=>{});}));
return {activate,dispose,refresh,start,scale:(value:100|110|125|150)=>{applyCaptureScale(page,value);applyCaptureScale(heading,value);segments.refresh();}};
}
