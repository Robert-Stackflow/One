import { applyCaptureScale } from '../capture/appearance';
import './ocr.css';
import { q, icon, registerIcons } from '../ui';
import { ScanText } from 'lucide';
import { customControls } from '../controls';
import type { OCRLanguage, OCRState, OCRResult } from '../../shared/recognition/ocr';
import { mountTranslation } from './translation-ui';
import { mountTextSelection } from './text-selection';
import { mountLocalModels } from './local-models-ui';
import { mountOCRWorkspace } from './workspace';
import './workbench.css';
import { recognitionNotice } from './notice';
const api = window.one.recognition!;
let state: OCRState, disposed = false, requesting = false, polling = false, workflowRead = '', reportedError = '';
const workspace = mountOCRWorkspace();
const workflowBusy = () => ['recognizing', 'translating'].includes(state?.workflow?.status || '');
const message = recognitionNotice(q('message'));
const translation = mountTranslation(api, () => state ? { ...state, running: state.running || requesting || workflowBusy() } : undefined, message, () => { if (state) render(); });
const selection = mountTextSelection(q<HTMLImageElement>('source'), {
  copy: text => api.copy(text), message,
  selected: (start, end) => { if (!requesting && !state?.running) q<HTMLTextAreaElement>('result').setSelectionRange(start, end); },
  translate: text => { if (!requesting && !state.running && !workflowBusy() && !translation.busy()) { workspace.show(true); translation.translateSelection(text); } },
});
const tools = document.querySelector('.text-image-tools'); if (tools) q('ocr-image-tools').append(tools);
const openLocalModels = mountLocalModels(api, refresh);
q('local-model-configure').onclick = () => void openLocalModels().catch(message);
q('open-formula').onclick = () => void api.openFormula(state.token).catch(message);
q('workflow-back').onclick = () => { if (state.workflow) void api.returnToCapture(state.token, state.workflow.id).catch(message); };
function inference(value: OCRResult['inference']) {
  q('local-model-configure').title = value ? `${value.model} · ${value.device}${value.fallbackReason ? ' · 已回退 CPU：' + value.fallbackReason : ''}` : 'OCR 模型';
  if (value?.fallbackReason) message(Error('已回退 CPU：' + value.fallbackReason));
}
function render() {
  const root = q('app'); if (root.dataset.captureScale !== String(state.uiScale)) applyCaptureScale(root, state.uiScale);
  const busy = requesting || state.running || workflowBusy();
  q('model-download-note').textContent = `${state.modelTitle || 'Tesseract fast'} 模型尚未就绪。下载后在本机识别图片。`;
  q('models').hidden = state.models.ready && !state.models.downloading && !state.models.error;
  q<HTMLButtonElement>('run').disabled = busy || translation.busy() || state.models.downloading || !state.models.ready;
  q<HTMLSelectElement>('language').disabled = busy;
  q<HTMLTextAreaElement>('result').readOnly = busy || translation.busy();
  q<HTMLButtonElement>('install').disabled = state.models.downloading || busy;
  q('cancel-install').hidden = !state.models.downloading;
  q<HTMLButtonElement>('copy').disabled = !q<HTMLTextAreaElement>('result').value.trim();
  q('workflow-back').hidden = !state.workflow?.returnToCapture;
  const loading = busy || state.models.downloading || translation.busy();
  q('image-loading').hidden = !loading; q('source').parentElement!.ariaBusy = String(loading);
  q('image-loading-label').textContent = state.models.downloading ? '下载模型中' : state.waitingForInference ? '等待其他本地任务' : translation.busy() || state.workflow?.status === 'translating' ? '翻译中' : '识别中';
  q<HTMLButtonElement>('overlay-cancel').disabled = requesting && !state.running;
  selection.setEnabled(!busy); translation.render();
  const error = state.error || state.models.error || '';
  if (error && error !== reportedError) message(Error(error)); reportedError = error;
}
async function syncWorkflow() {
  const workflow = state.workflow; if (!workflow || workflow.id === workflowRead) return;
  workspace.show(true); if (workflowBusy()) return;
  workflowRead = workflow.id; const token = state.token, result = await api.workflowResult(token, workflow.id);
  if (disposed || state.token !== token) return;
  q<HTMLTextAreaElement>('result').value = result.source; selection.setDocument(result.document); inference(result.inference);
  await translation.workflowResult(result.translation, workflow.target, workflow.error);
}
async function refresh() {
  if (polling || disposed) return; polling = true;
  try { state = await api.state(); await syncWorkflow(); if (!disposed) render(); } catch (error) { if (!disposed) message(error); }
  finally { polling = false; }
}
q('run').onclick = async () => {
  if (requesting || state.running || workflowBusy() || translation.busy()) return;
  requesting = true; render(); message('');
  try {
    const result = await api.run(state.token, q<HTMLSelectElement>('language').value as OCRLanguage);
    q<HTMLTextAreaElement>('result').value = result.text; selection.setDocument(result.document); inference(result.inference); translation.sourceChanged();
    if (!result.text.trim()) message('未识别到文字');
  } catch (error) { message(error); } finally { requesting = false; await refresh(); }
};
q('overlay-cancel').onclick = () => void (state.models.downloading ? api.cancelInstall() : translation.busy() ? api.cancelTranslation() : api.cancel()).catch(message);
q('install').onclick = () => { void api.install().then(refresh).catch(message); void refresh(); };
q('cancel-install').onclick = () => void api.cancelInstall().catch(message);
q('copy').onclick = () => void api.copy(q<HTMLTextAreaElement>('result').value).then(() => message('已复制原文')).catch(message);
q('result').oninput = () => { selection.setDocument(undefined); translation.sourceChanged(); if (state) render(); };
registerIcons({ 'scan-text': ScanText }); q('brand').innerHTML = icon('lucide:scan-text'); customControls(document.body);
void api.state().then(async value => { state = value; q('source-name').textContent = state.name; q<HTMLImageElement>('source').src = state.image; await syncWorkflow(); render(); }).catch(message);
const timer = setInterval(() => void refresh(), 400);
window.addEventListener('beforeunload', () => { disposed = true; selection.dispose(); clearInterval(timer); }, { once: true });
