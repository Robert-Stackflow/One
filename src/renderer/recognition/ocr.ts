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
import { recognitionReady, prepareRecognitionImage } from './ready';
import { needsImagePreview } from '../../shared/recognition/image-preview';
import { mountWordCorrection } from './word-correction';
export function mountOCR() {
const api = window.one.recognition!;
let state: OCRState, disposed = false, requesting = false, polling = false, workflowRead = '', reportedError = '';
let correction:ReturnType<typeof mountWordCorrection>|undefined;
const workspace = mountOCRWorkspace();
const workflowBusy = () => ['recognizing', 'translating'].includes(state?.workflow?.status || '');
const message = recognitionNotice(q('message'));
const translation = mountTranslation(api, () => state ? { ...state, running: state.running || requesting || workflowBusy() || !!correction?.busy() } : undefined, message, () => { if (state) render(); });
const selection = mountTextSelection(q<HTMLImageElement>('source'), {
  copy: text => api.copy(text), message,
  rerecognize:value=>void recognize(value),
  selectionChanged:()=>correction?.sync(),
  selected: (start, end) => { if (!requesting && !state?.running) q<HTMLTextAreaElement>('result').setSelectionRange(start, end); },
  translate: text => { if (!requesting && !state.running && !workflowBusy() && !translation.busy()) { workspace.show(true); translation.translateSelection(text); } },
});
correction=mountWordCorrection(q<HTMLTextAreaElement>('result'),q('result-label').parentElement!,{
  word:()=>selection.wordSelection(),busy:()=>requesting||!!state?.running||workflowBusy()||translation.busy(),message,
  apply:(word,text)=>api.correct(state.token,word.selection,text),
  applied:(result,word)=>{q<HTMLTextAreaElement>('result').value=result.text;selection.setDocument(result.document);selection.selectWord(word.wordId,word.lineId);translation.sourceChanged();},
  stateChanged:()=>{if(state)render();},
});
const tools = document.querySelector('.text-image-tools'); if (tools) q('ocr-image-tools').append(tools);
const loadImage=prepareRecognitionImage(q<HTMLImageElement>('source'),message);
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
  const busy = requesting || state.running || workflowBusy() || !!correction?.busy();
  q<HTMLButtonElement>('run').disabled = busy || translation.busy() || state.models.downloading || !state.models.ready;
  q('run').title=state.models.downloading?'模型下载中':!state.models.ready?`${state.modelTitle||'所选模型'} 尚未就绪，请打开 OCR 模型`:'';
  q<HTMLSelectElement>('language').disabled = busy;
  q<HTMLTextAreaElement>('result').readOnly = busy || translation.busy();
  q<HTMLButtonElement>('copy').disabled = !q<HTMLTextAreaElement>('result').value.trim();
  q('workflow-back').hidden = !state.workflow?.returnToCapture;
  const loading = requesting || state.running || workflowBusy() || translation.busy();
  q('image-loading').hidden = !loading; q('source').parentElement!.ariaBusy = String(loading);
  q('image-loading-label').textContent = state.waitingForInference ? '等待其他本地任务' : translation.busy() || state.workflow?.status === 'translating' ? '翻译中' : '识别中';
  q<HTMLButtonElement>('overlay-cancel').disabled = false;
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
async function recognize(region?:import('../../shared/recognition/text-area').OCRLocalSelection){
  if (requesting || state.running || workflowBusy() || translation.busy() || correction?.busy()) return;
  requesting = true; render(); message('');
  try {
    const language=q<HTMLSelectElement>('language').value as OCRLanguage;
    const result = await (region?api.region(state.token,language,region):api.run(state.token,language));
    q<HTMLTextAreaElement>('result').value = result.text; selection.setDocument(result.document,!!result.document||!result.text.trim()); inference(result.inference); translation.sourceChanged();
    if (!result.text.trim()) message('未识别到文字');
  } catch (error) { message(error); } finally { requesting = false; await refresh(); }
}
q('run').onclick=()=>void recognize();
q('overlay-cancel').onclick = () => void (translation.busy() ? api.cancelTranslation() : api.cancel()).catch(message);
q('copy').onclick = () => void api.copy(q<HTMLTextAreaElement>('result').value).then(() => message('已复制原文')).catch(message);
q('result').oninput = () => { selection.setDocument(undefined,false); translation.sourceChanged(); if (state) render(); };
registerIcons({ 'scan-text': ScanText }); q('brand').innerHTML = icon('lucide:scan-text'); customControls(document.body);
void api.state().then(async value => { state = value; q('source-name').textContent = state.name;loadImage(needsImagePreview(value)?selection.setImagePreview(value,region=>api.imagePreview(value.token,region)):value.image);await syncWorkflow(); render(); }).catch(message);
void recognitionReady(()=>api.ready()).catch(message);
const timer = setInterval(() => void refresh(), 400);
window.addEventListener('beforeunload', () => { disposed = true; correction?.dispose(); selection.dispose(); clearInterval(timer); }, { once: true });
}
