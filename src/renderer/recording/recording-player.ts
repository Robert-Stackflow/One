import {RECORDING_PROJECT_FORMAT} from '../../shared/media-project';
import { editorMoreActions } from '../editor/editor-actions';
import { setupFloatingFeedback, transientNotice } from '../feedback';
import { playerToolbar } from './player-toolbar';
import './recording-player.css';
import {
  createElement,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Video,
  AudioLines,
  Volume2,
  VolumeX,
} from 'lucide';
import {
  defaultPlayback,
  playbackSettings,
  playbackTime,
  type PlaybackSettings,
  type RecordingPlayerAPI,
  type PlaybackState,
} from '../../shared/recording/recording-playback';
import { recordingPreview } from './recording-preview';
import { recordingAudio } from './recording-audio';
import { defaultCursorStyle, type CursorStyle } from '../../shared/recording/recording-cursor';
import { recordingExportPlan, type RecordingExportOptions } from '../../shared/recording/recording-export';
import { seekMedia } from './recording-media';
import { recordingGifEditor } from './recording-gif-editor';
const api = window.one!.recordingPlayer!,
  q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T,
  video = q<HTMLVideoElement>('preview');
function fitCanvas() {
  const space = document.querySelector<HTMLElement>('.player-canvas-space')!,
    stage = document.querySelector<HTMLElement>('.media-stage')!,
    ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
    width = Math.max(1, Math.min(space.clientWidth, space.clientHeight * ratio));
  stage.style.width = width + 'px';
  stage.style.height = width / ratio + 'px';
}
new ResizeObserver(fitCanvas).observe(document.querySelector('.player-canvas-space')!);
video.addEventListener('loadedmetadata', fitCanvas);
let state: PlaybackState | undefined,
  settings = defaultPlayback(),
  request = 0,
  editTask: Promise<boolean> | undefined,
  pending: PlaybackSettings | undefined;
const remembered = { left: 1, right: 1, system: 1, microphone: 1 };
let localError = '';
let lastFeedback = '';
setupFloatingFeedback(q('toast'), true);
const notify = transientNotice(q('toast'), 3500);
let previewEnd: number | undefined;
let previewRequest = 0;
function exportOptions(keepRange = false): RecordingExportOptions {
  const format = q<HTMLSelectElement>('export-format').value as RecordingExportOptions['format'];
  return {
    format,
    quality: q<HTMLSelectElement>('export-quality').value as RecordingExportOptions['quality'],
    range:
      settings.gif && format === 'gif' && !keepRange
        ? undefined
        : {
            start: q<HTMLInputElement>('export-from').valueAsNumber,
            end:
              q<HTMLInputElement>('export-to').valueAsNumber ===
              Number((state?.seconds || 0).toFixed(3))
                ? state?.seconds || 0
                : q<HTMLInputElement>('export-to').valueAsNumber,
          },
  };
}
function exportFields() {
  const busy = !!state?.export?.busy;
  gifEditor.update(
    state?.token || '',
    busy || state?.phase !== 'ready' || !!state?.projectBusy,
    !!state?.video && exportOptions().format === 'gif',
  );
  q('export-settings').hidden = !state?.video;
  q<HTMLButtonElement>('export-start').disabled =
    busy || state?.phase !== 'ready' || !!state?.projectBusy;
  q('export-start').textContent = state?.export?.phase === 'failed' ? '重试合成导出' : '合成导出';
  q('export-cancel').hidden = !busy;
  q<HTMLButtonElement>('export-cancel').disabled = state?.export?.phase === 'cancelled';
  for (const id of [
    'export-format',
    'export-quality',
    'export-from',
    'export-to',
    'export-preview',
    'export-whole',
  ])
    q<HTMLInputElement>(id).disabled = busy;
  q<HTMLButtonElement>('export-preview').disabled =
    busy || video.readyState < 2 || !!state?.projectBusy;
  const progress = q<HTMLProgressElement>('export-progress');
  progress.hidden = !busy;
  progress.value = state?.export?.progress || 0;
  q('export-status').textContent = state?.export
    ? state.export.path
      ? '已保存：' +
        state.export.path +
        (state.export.bytes !== undefined
          ? ` · 实际大小 ${(state.export.bytes / 1024).toFixed(1)} KB`
          : '')
      : state.export.message + (busy ? ' · ' + Math.floor(state.export.progress * 100) + '%' : '')
    : '';
  if (state?.video && state.options) {
    try {
      const plan = recordingExportPlan(
        {
          format: RECORDING_PROJECT_FORMAT.id,
          version: RECORDING_PROJECT_FORMAT.version,
          seconds: state.seconds,
          options: state.options,
          video: state.video,
          playback: settings,
          inputs: [],
          annotations: [],
          layouts: [],
        },
        exportOptions(),
      );
      q('export-parameters').textContent =
        `${plan.width} × ${plan.height} · ${plan.timeline ? plan.frames + ' 帧 / 逐帧延时' : Number(plan.fps.toFixed(3)) + ' fps'} · ${plan.seconds.toFixed(2)} 秒 · ` +
        (plan.format === 'gif'
          ? `${plan.colors} 色 / 每帧调色板`
          : plan.format === 'webp'
            ? `WebP 质量 ${plan.webpQuality}`
            : `H.264 CRF ${plan.crf} · AAC ${plan.audioBitrate / 1000} kbps`) +
        (settings.speed !== 1 ? ` · ${settings.speed}× 速度` : '') +
        (plan.timeline ? ' · 使用逐帧编辑序列，起止时间仅用于再次抽帧' : '');
    } catch (e) {
      q('export-parameters').textContent = e instanceof Error ? e.message : '请选择有效的导出范围';
      q<HTMLButtonElement>('export-start').disabled = true;
      q<HTMLButtonElement>('export-preview').disabled = true;
    }
  }
}
for (const id of ['export-format', 'export-quality', 'export-from', 'export-to'])
  q(id).addEventListener('change', () => {
    if (id === 'export-from' || id === 'export-to') {
      previewRequest++;
      previewEnd = undefined;
    }
    exportFields();
  });
q('export-whole').onclick = () => {
  previewRequest++;
  q<HTMLInputElement>('export-from').value = '0';
  q<HTMLInputElement>('export-to').value = String(Number((state?.seconds || 0).toFixed(3)));
  previewEnd = undefined;
  exportFields();
};
q('export-preview').onclick = async () => {
  if (exportOptions().format === 'gif' && settings.gif) {
    gifEditor.preview();
    return;
  }
  const id = ++previewRequest,
    token = state?.token;
  try {
    const range = exportOptions().range!;
    if (!state) return;
    recordingExportPlan(
      {
        format: RECORDING_PROJECT_FORMAT.id,
        version: RECORDING_PROJECT_FORMAT.version,
        seconds: state.seconds,
        options: state.options,
        video: state.video,
        playback: settings,
        inputs: [],
        annotations: [],
        layouts: [],
      },
      exportOptions(),
    );
    video.pause();
    previewEnd = undefined;
    await seekMedia(video, range.start);
    if (id !== previewRequest || token !== state?.token) return;
    previewEnd = range.end;
    await toggle();
  } catch (e) {
    error(e);
  }
};
q('export-start').onclick = async () => {
  if (!state) return;
  gifEditor.stop();
  localError = '';
  q<HTMLButtonElement>('export-start').disabled = true;
  try {
    gifEditor.applyPending();
    if (await commit()) await api.export(state.token, exportOptions());
  } catch (e) {
    error(e);
  } finally {
    void refresh();
  }
};
q('export-cancel').onclick = async () => {
  if (!state?.export) return;
  try {
    await api.cancelExport(state.token, state.export.id);
  } catch (e) {
    error(e);
  } finally {
    void refresh();
  }
};
function error(value: unknown) {
  localError = String(value instanceof Error ? value.message : value).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
  notify(localError);
  lastFeedback = localError;
}
function commit(): Promise<boolean> {
  if (editTask) return editTask;
  if (!state) return Promise.resolve(false);
  const token = state.token;
  editTask = (async () => {
    try {
      while (pending) {
        const value = pending;
        pending = undefined;
        await api.edit(token, value);
      }
      return true;
    } catch (e) {
      pending = undefined;
      error(e);
      return false;
    }
  })().finally(() => {
    editTask = undefined;
  });
  return editTask;
}
function edit(patch: Partial<PlaybackSettings>) {
  gifEditor.stop();
  settings = playbackSettings({ ...settings, ...patch });
  timeFields();
  video.defaultPlaybackRate = video.playbackRate = settings.speed;
  sound.apply();
  preview.redraw();
  pending = structuredClone(settings);
  void commit();
  exportFields();
}
const preview = recordingPreview(api, error, () => settings, edit);
const sound = recordingAudio(video, () => settings, error);
const gifEditor = recordingGifEditor({
  settings: () => settings,
  options: () => exportOptions(true),
  seconds: () => state?.seconds || 0,
  size: () => state?.video || { width: video.videoWidth, height: video.videoHeight },
  quality: qualityPreview,
  edit,
  error,
  pause() {
    previewRequest++;
    previewEnd = undefined;
    video.pause();
  },
  redraw: () => preview.redraw(),
});
let gifPreviewUrl = '',
  qualityBusy = false;
const qualityDialog = q<HTMLDialogElement>('gif-quality-dialog');
function releaseQualityPreview() {
  q<HTMLImageElement>('gif-quality-image').onerror = null;
  q<HTMLImageElement>('gif-quality-image').removeAttribute('src');
  if (gifPreviewUrl) URL.revokeObjectURL(gifPreviewUrl);
  gifPreviewUrl = '';
}
qualityDialog.addEventListener('close', releaseQualityPreview);
q('gif-quality-close').onclick = () => {
  releaseQualityPreview();
  qualityDialog.close();
};
q<HTMLSelectElement>('gif-quality-zoom').onchange = () => {
  const image = q<HTMLImageElement>('gif-quality-image'),
    zoom = Number(q<HTMLSelectElement>('gif-quality-zoom').value);
  image.style.width = image.naturalWidth * zoom + 'px';
  image.style.imageRendering = zoom > 1 ? 'pixelated' : 'auto';
};
window.addEventListener('beforeunload', releaseQualityPreview);
async function qualityPreview() {
  if (!state || qualityBusy) return;
  qualityBusy = true;
  localError = '';
  const token = state.token,
    button = q<HTMLButtonElement>('gif-quality');
  button.disabled = true;
  gifEditor.stop();
  video.pause();
  try {
    if (!(await commit())) return;
    const result = await api.previewGif(
      token,
      exportOptions(),
      q<HTMLInputElement>('gif-quality-full').checked,
    );
    if (!result || state?.token !== token) return;
    releaseQualityPreview();
    const bytes = new Uint8Array(result.bytes.length);
    bytes.set(result.bytes);
    gifPreviewUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: 'image/gif' }));
    const image = q<HTMLImageElement>('gif-quality-image');
    image.onerror = () => {
      qualityDialog.close();
      error(Error('无法显示 GIF 编码预览，请降低输出尺寸后重试'));
    };
    image.src = gifPreviewUrl;
    image.style.width = result.width + 'px';
    image.style.imageRendering = 'auto';
    q<HTMLSelectElement>('gif-quality-zoom').value = '1';
    q('gif-quality-summary').textContent =
      `${result.width} × ${result.height} · 最多 ${result.colors} 色 · 采样 ${result.sampleFrames}/${result.totalFrames} 帧 · 编辑序列平均 ${(result.totalFrames / result.seconds).toFixed(2)} fps · ${result.seconds.toFixed(2)} 秒 · 相同帧合并${result.optimized ? '开启' : '关闭'}`;
    q('gif-quality-estimate').textContent =
      `预计导出体积${result.complete ? '：' : '约：'}${(result.estimatedBytes / 1024).toFixed(1)} KB`;
    q('gif-quality-note').textContent = result.complete
      ? '已完整编码所有帧；预览循环设置与最终导出可能不同，估算已计入该差异。'
      : '抽样画面不连续，预览时长与整片不同；预计体积按平均帧大小推算。复杂画面和连续相同帧的分布可能造成较大偏差，可选择完整预览。';
    qualityDialog.showModal();
  } finally {
    qualityBusy = false;
    button.disabled = false;
    void refresh();
  }
}
q('export-preview').prepend(createElement(Play, { 'aria-hidden': 'true' }));
function glyph(id: string, node: Parameters<typeof createElement>[0]) {
  q(id).replaceChildren(createElement(node, { 'aria-hidden': 'true' }));
}
glyph('brand', Video);
glyph('audio-picture', AudioLines);
glyph('back', SkipBack);
glyph('forward', SkipForward);
function duration() {
  return Math.max(0, state?.seconds || (Number.isFinite(video.duration) ? video.duration : 0));
}
function transport() {
  video.closest<HTMLElement>('.media-stage')!.dataset.playing = String(
    !video.paused && !video.ended,
  );
  const paused = video.paused || video.ended;
  glyph('play', paused ? Play : Pause);
  q('play').title = q('play').ariaLabel = paused ? '播放 · 空格' : '暂停 · 空格';
  q<HTMLButtonElement>('play').disabled = video.paused && video.readyState < 2;
  const seek = q<HTMLInputElement>('seek');
  seek.max = String(duration());
  seek.disabled = !duration();
  if (document.activeElement !== seek) seek.value = String(video.currentTime);
  seek.setAttribute(
    'aria-valuetext',
    playbackTime(video.currentTime) + ' / ' + playbackTime(duration()),
  );
  q('play-time').textContent = playbackTime(video.currentTime) + ' / ' + playbackTime(duration());
}
async function toggle() {
  gifEditor.stop();
  if (!video.paused) {
    video.pause();
    return;
  }
  if (video.readyState < 2) return;
  try {
    const token = state?.token;
    if (state?.options?.systemAudio || state?.options?.microphone) await sound.prepare();
    if (token !== state?.token) return;
    if (video.ended) video.currentTime = 0;
    await video.play();
  } catch (e) {
    error(e);
  }
}
function seek(seconds: number) {
  gifEditor.stop();
  previewRequest++;
  previewEnd = undefined;
  video.currentTime = Math.min(duration(), Math.max(0, seconds));
  transport();
}
q('play').onclick = () => {
  previewRequest++;
  previewEnd = undefined;
  void toggle();
};
video.closest('.media-stage')!.addEventListener('click', (event) => {
  if (event.target === video || event.target === video.parentElement) q('play').click();
});
q('back').onclick = () => seek(video.currentTime - 5);
q('forward').onclick = () => seek(video.currentTime + 5);
q<HTMLInputElement>('seek').oninput = () => seek(Number(q<HTMLInputElement>('seek').value));
q<HTMLSelectElement>('speed').onchange = () =>
  edit({ speed: Number(q<HTMLSelectElement>('speed').value) });
function channelFields(channel: keyof typeof remembered) {
  const value = settings[channel];
  q<HTMLInputElement>('channel-' + channel).value = String(value * 100);
  q('channel-' + channel + '-value').textContent = Math.round(value * 100) + '%';
  glyph('mute-' + channel, value ? Volume2 : VolumeX);
  q('mute-' + channel).setAttribute('aria-pressed', String(!value));
  q('mute-' + channel).ariaLabel =
    (value ? '静音' : '取消静音') +
    { left: '左声道', right: '右声道', system: '系统声', microphone: '麦克风' }[channel];
}
for (const channel of ['system', 'microphone', 'left', 'right'] as const) {
  const field = q<HTMLInputElement>('channel-' + channel);
  field.oninput = () => {
    const value = Number(field.value) / 100;
    edit({ [channel]: value });
    if (value) remembered[channel] = value;
    channelFields(channel);
  };
  q('mute-' + channel).onclick = () => {
    edit({ [channel]: settings[channel] ? 0 : remembered[channel] });
    channelFields(channel);
  };
  channelFields(channel);
}
function timeFields() {
  for (const [key, value] of Object.entries(settings.time)) {
    const field = q<HTMLInputElement | HTMLSelectElement>('time-' + key);
    if (!field) continue;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = !!value;
    else field.value = String(typeof value === 'number' && key !== 'size' ? value * 100 : value);
    const output = document.getElementById('time-' + key + '-value');
    if (output) output.textContent = field.value + (key === 'size' ? ' px' : '%');
  }
  q<HTMLInputElement>('time-width').disabled = !settings.time.progress;
  q<HTMLSelectElement>('time-shape').disabled = !settings.time.progress;
}
function cursorFields() {
  const style = settings.cursor || defaultCursorStyle();
  for (const key of [
    'visible',
    'size',
    'clicks',
    'animation',
    'color',
    'trail',
    'clickStyle',
  ] as const) {
    const field = q<HTMLInputElement>('cursor-' + key);
    if (typeof style[key] === 'boolean') field.checked = style[key] as boolean;
    else
      field.value = String(
        typeof style[key] === 'number' ? (style[key] as number) * 100 : style[key],
      );
  }
  q('cursor-size-value').textContent = Math.round(style.size * 100) + '%';
  q('cursor-animation-value').textContent = style.animation + '×';
}
for (const key of [
  'visible',
  'size',
  'clicks',
  'animation',
  'color',
  'trail',
  'clickStyle',
] as const) {
  const field = q<HTMLInputElement>('cursor-' + key);
  field.addEventListener(['range', 'color'].includes(field.type) ? 'input' : 'change', () => {
    const value =
      field.type === 'checkbox'
        ? field.checked
        : field.type === 'range'
          ? Number(field.value) / 100
          : field.value;
    edit({ cursor: { ...(settings.cursor || defaultCursorStyle()), [key]: value } as CursorStyle });
    cursorFields();
  });
}
for (const key of [
  'visible',
  'position',
  'size',
  'color',
  'background',
  'opacity',
  'backgroundOpacity',
  'width',
  'progress',
  'shape',
] as const) {
  const field = q<HTMLInputElement | HTMLSelectElement>('time-' + key);
  field.addEventListener(
    field instanceof HTMLInputElement && ['range', 'color'].includes(field.type)
      ? 'input'
      : 'change',
    () => {
      const value =
        field instanceof HTMLInputElement && field.type === 'checkbox'
          ? field.checked
          : ['size', 'width', 'opacity', 'backgroundOpacity'].includes(key)
            ? Number(field.value) / (key === 'size' ? 1 : 100)
            : field.value;
      edit({
        time: {
          ...settings.time,
          ...(key === 'position' && value === 'custom'
            ? { x: settings.time.x ?? 0.05, y: settings.time.y ?? 0.85 }
            : {}),
          [key]: value,
        },
      });
      timeFields();
    },
  );
}
for (const event of [
  'loadedmetadata',
  'loadeddata',
  'play',
  'pause',
  'timeupdate',
  'seeking',
  'seeked',
  'ratechange',
  'ended',
  'durationchange',
])
  video.addEventListener(event, transport);
video.onerror = () => error('无法播放录制文件，原始素材仍已保留。');
const finishRange = () => {
  if (previewEnd !== undefined && video.currentTime >= previewEnd) {
    video.pause();
    seek(previewEnd);
  }
};
video.addEventListener('timeupdate', finishRange);
video.addEventListener('ended', finishRange);
video.addEventListener('play', () => {
  const limit = () => {
    if (previewEnd === undefined || video.paused) return;
    finishRange();
    if (previewEnd !== undefined) requestAnimationFrame(limit);
  };
  requestAnimationFrame(limit);
});
async function save(camera = false) {
  if (!state) return;
  try {
    await api.save(state.token, camera);
    localError = '';
    void refresh();
  } catch (e) {
    error(e);
  }
}
q('save').onclick = () => void save();
q('save-camera').onclick = () => void save(true);
q('save-project').onclick = async () => {
  if (!state) return;
  try {
    gifEditor.applyPending();
    if (!(await commit())) return;
    await api.saveProject(state.token);
    localError = '';
    void refresh();
  } catch (e) {
    error(e);
  }
};
document.addEventListener('keydown', (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.closest('button,[role="button"],summary'))) ||
    document.querySelector('dialog[open]')
  )
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    void toggle();
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault();
    seek(video.currentTime + (event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 5));
  } else if (event.code === 'Home') {
    event.preventDefault();
    seek(0);
  } else if (event.code === 'End') {
    event.preventDefault();
    seek(duration());
  }
});
async function refresh() {
  const id = ++request;
  try {
    const next = await api.state();
    if (id !== request) return;
    const fresh = state?.token !== next.token;
    state = next;
    if (fresh) {
      q<HTMLInputElement>('gif-quality-full').checked = false;
      if (qualityDialog.open) qualityDialog.close();
      previewRequest++;
      previewEnd = undefined;
      q<HTMLInputElement>('export-from').value = '0';
      q<HTMLInputElement>('export-to').value = String(Number(next.seconds.toFixed(3)));
      q<HTMLInputElement>('export-from').max = q<HTMLInputElement>('export-to').max = String(
        next.seconds,
      );
      if (next.importedVideo || next.options?.videoSource === 'camera')
        q<HTMLSelectElement>('export-format').value = 'gif';
      localError = '';
      settings = playbackSettings(next.playback || defaultPlayback());
      video.defaultPlaybackRate = video.playbackRate = settings.speed;
      q<HTMLSelectElement>('speed').value = String(settings.speed);
      timeFields();
      for (const channel of ['system', 'microphone', 'left', 'right'] as const) {
        if (settings[channel]) remembered[channel] = settings[channel];
        channelFields(channel);
      }
    }
    preview.update(next);
    sound.update(next);
    const audioOnly = next.options?.mode === 'audio';
    const title = next.importedVideo
      ? '视频素材'
      : next.options?.videoSource === 'camera'
        ? '摄像头素材'
        : '录制结果';
    document.title = 'One · ' + title;
    document.querySelector('header strong')!.textContent = title;
    document.querySelector('.player-meta h1')!.textContent = title;
    document.body.classList.toggle('audio-only', audioOnly);
    q('audio-picture').hidden = !audioOnly;
    q('summary').textContent =
      playbackTime(next.seconds) +
      ' · ' +
      (next.bytes / 1048576).toFixed(1) +
      ' MB' +
      (next.video
        ? ' · ' +
          next.video.width +
          ' × ' +
          next.video.height +
          ' · ' +
          Number(next.video.fps.toFixed(3)) +
          ' fps'
        : '');
    q('saved').textContent = next.saved ? '原片已保存' : '';
    q('saved').title = next.saved || '';
    q('camera-saved').textContent = next.cameraSaved ? '已保存：' + next.cameraSaved : '';
    const exporting = !!next.export?.busy;
    q<HTMLButtonElement>('save').disabled = next.phase !== 'ready' || exporting;
    q<HTMLButtonElement>('save-camera').disabled = next.phase !== 'ready' || exporting;
    q<HTMLButtonElement>('save-project').disabled =
      next.phase !== 'ready' || !!next.projectBusy || exporting;
    q('project-saved').textContent = next.projectDirty
      ? '有未保存修改'
      : next.projectSaved
        ? '工程已保存'
        : '未保存工程';
    q('project-saved').title = next.projectSaved || '';
    q('channel-settings').hidden = !next.options?.systemAudio && !next.options?.microphone;
    q('source-settings').hidden = !Object.keys(next.audioSources || {}).length;
    for (const source of ['system', 'microphone'] as const)
      q('channel-' + source).closest<HTMLElement>('label')!.hidden = !next.audioSources?.[source];
    q('time-settings').hidden = audioOnly;
    q('cursor-settings').hidden = !next.cursorCount || audioOnly;
    exportFields();
    const feedback =
      localError || (/^(已打开录制工程|已导入 )/.test(next.message) ? '' : next.message);
    if (feedback && feedback !== lastFeedback)
      notify(!localError && /^已保存[：:]/.test(feedback) ? '已保存' : feedback);
    lastFeedback = feedback;
    fitCanvas();
    transport();
  } catch (e) {
    error(e);
  }
}
api.onChange(() => void refresh());
window.addEventListener('pagehide', () => {
  previewRequest++;
  previewEnd = undefined;
  video.pause();
  sound.dispose();
});
void refresh();

playerToolbar();
editorMoreActions(document.querySelector('.player-actions')!, ['save-project']);
