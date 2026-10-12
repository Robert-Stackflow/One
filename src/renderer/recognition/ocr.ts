import {applyCaptureScale} from '../capture/appearance';
import './ocr.css';
import { q, icon, registerIcons } from '../ui';
import { ScanText } from 'lucide';
import { customControls } from '../controls';
import type { OCRAPI, OCRLanguage, OCRState } from '../../shared/recognition/ocr';
import { mountTranslation } from './translation-ui';
import { mountTable } from './table-ui';
import { mountFormula } from './formula-ui';
const api = window.one.recognition!;
const back = document.createElement('button');
back.id = 'workflow-back';
back.type = 'button';
back.textContent = '返回截图';
back.hidden = true;
q('message').after(back);
back.onclick = () => {
  if (state.workflow) void api.returnToCapture(state.token, state.workflow.id).catch(message);
};
let state: OCRState,
  disposed = false,
  requesting = false,
  polling = false;
let mode: 'text' | 'translation' | 'table' | 'formula' = 'text',
  ocrSummary = q('summary').textContent || '';
let workflowRead = '';
const workflowBusy = () => ['recognizing', 'translating'].includes(state?.workflow?.status || '');
const message = (value: unknown) => {
  q('message').textContent = value instanceof Error ? value.message : String(value);
};
const translation = mountTranslation(
  api,
  () => (state ? { ...state, running: state.running || requesting || workflowBusy() } : undefined),
  message,
  () => {
    if (state) render();
  },
);
const table = mountTable(
  api,
  () => (state ? { ...state, running: state.running || requesting || workflowBusy() } : undefined),
  message,
  () => {
    if (state) render();
  },
);
const formula = mountFormula(
  api,
  () => (state ? { ...state, running: state.running || requesting || workflowBusy() } : undefined),
  message,
  () => {
    if (state) render();
  },
);
for (const next of ['text', 'translation', 'table', 'formula'] as const)
  q(next + '-tab').onclick = () => {
    if (
      requesting ||
      state?.running ||
      workflowBusy() ||
      translation.busy() ||
      table.busy() ||
      formula.busy()
    )
      return;
    mode = next;
    translation.setMode(next === 'translation');
    table.setMode(next === 'table');
    formula.setMode(next === 'formula');
    if (next === 'table') message('可校正文字与行列，按住 Shift 选择合并区域');
    else if (next === 'text') message('识别结果可修正或复制');
    if (state) render();
  };
function render() {
  const root=q('app');if(root.dataset.captureScale!==String(state.uiScale))applyCaptureScale(root,state.uiScale);
  back.hidden = !state.workflow?.returnToCapture;
  q<HTMLTextAreaElement>('result').readOnly = state.running || workflowBusy();
  q<HTMLTextAreaElement>('translated').readOnly = workflowBusy();
  q('models').hidden = state.models.ready && !state.models.downloading && !state.models.error;
  q<HTMLButtonElement>('run').disabled =
    requesting ||
    workflowBusy() ||
    state.running ||
    translation.busy() ||
    table.busy() ||
    formula.busy() ||
    state.models.downloading ||
    !state.models.ready;
  q('cancel').hidden = !state.running && !workflowBusy();
  q<HTMLSelectElement>('language').disabled = state.running || requesting || workflowBusy();
  q<HTMLButtonElement>('install').disabled =
    state.models.downloading || state.running || workflowBusy();
  q('cancel-install').hidden = !state.models.downloading;
  q<HTMLButtonElement>('copy').disabled = !q<HTMLTextAreaElement>('result').value.trim();
  const active = state.running || state.models.downloading;
  q('progress').hidden = !active;
  q<HTMLProgressElement>('progress').value = state.models.downloading
    ? state.models.progress
    : state.progress;
  translation.render();
  table.render();
  formula.render();
  document.body.classList.toggle('table-mode', mode === 'table');
  document.body.classList.toggle('formula-mode', mode === 'formula');
  q('text-result').hidden = mode === 'table' || mode === 'formula';
  q('copy').hidden = mode === 'table' || mode === 'formula';
  if (mode === 'formula') q('ocr-tools').hidden = true;
  q('run').textContent = mode === 'table' ? '识别表格' : '识别文字';
  for (const next of ['text', 'translation', 'table', 'formula']) {
    const tab = q<HTMLButtonElement>(next + '-tab');
    tab.disabled =
      requesting ||
      state.running ||
      workflowBusy() ||
      translation.busy() ||
      table.busy() ||
      formula.busy();
    tab.ariaSelected = String(mode === next);
    tab.classList.toggle('selected', mode === next);
  }
  if (mode !== 'table')
    q('summary').textContent =
      mode === 'translation'
        ? '译文请核对后使用'
        : mode === 'formula'
          ? '公式请对照原图核对，预览不验证识别准确率'
          : ocrSummary;
  if (workflowBusy()) {
    message(
      state.workflow?.status === 'translating'
        ? '流程正在翻译文字，图片留在本机…'
        : '流程正在本机识别文字…',
    );
    return;
  }
  if (translation.isTranslation() || mode === 'formula') return;
  if (active) message(state.models.downloading ? '正在下载语言包…' : '正在本机识别文字…');
  else if (state.error || state.models.error) message(state.error || state.models.error);
}
async function refresh() {
  if (polling || disposed) return;
  polling = true;
  try {
    state = await api.state();
    await syncWorkflow();
    if (!disposed) render();
  } catch (error) {
    if (!disposed) message(error);
  } finally {
    polling = false;
  }
}
async function syncWorkflow() {
  const workflow = state.workflow;
  if (!workflow || workflow.id === workflowRead) return;
  mode = 'translation';
  translation.setMode(true);
  table.setMode(false);
  formula.setMode(false);
  if (workflowBusy()) return;
  workflowRead = workflow.id;
  const token = state.token;
  const result = await api.workflowResult(token, workflow.id);
  if (disposed || token !== state.token || workflow.id !== state.workflow?.id) return;
  q<HTMLTextAreaElement>('result').value = result.source;
  ocrSummary = `${result.words} 个词块 · 可信度 ${Math.round(result.confidence)}% · 请核对结果`;
  await translation.workflowResult(result.translation, workflow.target, workflow.error);
}
q('run').onclick = async () => {
  if (requesting || state.running) return;
  requesting = true;
  render();
  message('正在本机识别文字…');
  try {
    const result = await api.run(
      state.token,
      q<HTMLSelectElement>('language').value as OCRLanguage,
      mode === 'table' ? 'table' : 'text',
    );
    q<HTMLTextAreaElement>('result').value = result.text;
    translation.sourceChanged();
    ocrSummary = result.text.trim()
      ? `${result.words.length} 个词块 · 可信度 ${Math.round(result.confidence)}% · 请核对结果`
      : '未识别到文字，可裁剪图片或更换语言后重试';
    message(result.text.trim() ? '识别完成，可修正或复制文字' : '未识别到文字');
    await table.recognized();
  } catch (error) {
    message(error);
  } finally {
    requesting = false;
    await refresh();
  }
};
q('cancel').onclick = () => void api.cancel().catch(message);
q('install').onclick = () => {
  void api
    .install()
    .then(() => {
      message('语言包已就绪，可以开始识别');
      return refresh();
    })
    .catch(message);
  void refresh();
};
q('cancel-install').onclick = () => void api.cancelInstall().catch(message);
q('copy').onclick = () =>
  void api
    .copy(q<HTMLTextAreaElement>('result').value)
    .then(() => message('已复制文字'))
    .catch(message);
q('result').oninput = () => {
  q<HTMLButtonElement>('copy').disabled = !q<HTMLTextAreaElement>('result').value.trim();
  translation.sourceChanged();
};
registerIcons({ 'scan-text': ScanText });
q('brand').innerHTML = icon('lucide:scan-text');
customControls(document.body);
void api
  .state()
  .then(async (value) => {
    state = value;
    q('source-name').textContent = state.name;
    q<HTMLImageElement>('source').src = state.image;
    await syncWorkflow();
    render();
  })
  .catch(message);
const timer = setInterval(() => void refresh(), 400);
window.addEventListener('beforeunload', () => {
  disposed = true;
  clearInterval(timer);
});
