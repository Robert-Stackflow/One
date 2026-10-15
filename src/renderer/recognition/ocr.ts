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
import {mountImageTranslation} from './image-translation';
import {mountFormula} from './formula-ui';
import {mountWorkbenchServices,type WorkbenchMode} from './workbench-services';
import {setupSegments} from '../segments';
export function mountOCR() {
const api = window.one.recognition!;
let state: OCRState, disposed = false, requesting = false, polling = false, workflowRead = '', reportedError = '';
let mode:WorkbenchMode='ocr',entryRevision=-1;
let formula:ReturnType<typeof mountFormula>|undefined,services:ReturnType<typeof mountWorkbenchServices>|undefined;
let correction:ReturnType<typeof mountWordCorrection>|undefined;
let picture:ReturnType<typeof mountImageTranslation>|undefined;
const workspace = mountOCRWorkspace();
const workflowBusy = () => ['recognizing', 'translating'].includes(state?.workflow?.status || '');
const message = recognitionNotice(q('message'));
const translation = mountTranslation(api, () => state ? { ...state, running: state.running || requesting || workflowBusy() || !!correction?.busy()||!!picture?.busy() } : undefined, message, () => { if (state) render(); },{configure:()=>void services?.configure().catch(message)});
const selection = mountTextSelection(q<HTMLImageElement>('source'), {
  copy: text => api.copy(text), message,
  rerecognize:value=>{if(mode==='formula'&&'region'in value)void formula?.recognize(value.region);else void recognize(value);},
  selectionChanged:()=>correction?.sync(),
  selected: (start, end) => { if (!requesting && !state?.running) q<HTMLTextAreaElement>('result').setSelectionRange(start, end); },
  translate: text => { if (!requesting && !state.running && !workflowBusy() && !translation.busy()) { setMode('translation');workspace.show(true); translation.translateSelection(text); } },
});
correction=mountWordCorrection(q<HTMLTextAreaElement>('result'),q('result-label').parentElement!,{
  word:()=>selection.wordSelection(),busy:()=>requesting||!!state?.running||workflowBusy()||translation.busy(),message,
  apply:(word,text)=>api.correct(state.token,word.selection,text),
  applied:(result,word)=>{q<HTMLTextAreaElement>('result').value=result.text;selection.setDocument(result.document);selection.selectWord(word.wordId,word.lineId);translation.sourceChanged();},
  stateChanged:()=>{if(state)render();},
});
const tools = document.querySelector('.text-image-tools'); if (tools) q('ocr-image-tools').append(tools);
const loadImage=prepareRecognitionImage(q<HTMLImageElement>('source'),message);
picture=mountImageTranslation(api,{state:()=>state?{...state,running:state.running||requesting||workflowBusy()||!!correction?.busy()||translation.busy()}:undefined,document:()=>selection.document(),layer:()=>selection.imageLayer(),translate:force=>translation.imageResult(force),available:()=>translation.imageReady(),valid:id=>translation.imageValid(id),changed:()=>{if(state)render();},message});
const pictureTools=document.querySelector('.image-translation-tools');if(pictureTools)q('message').after(pictureTools);
const openLocalModels = mountLocalModels(api, async()=>{await refresh();await services?.syncLocal('ocr');});
const formulaAPI=window.one.formulaRecognition!;
formula=mountFormula(formulaAPI,()=>state?{...state,models:state.formulaModels||state.models,modelTitle:state.formulaTitle}:undefined,message,refresh,{rotation:()=>selection.viewState().rotation,busy:()=>{},unified:true,modelsChanged:async()=>{await services?.syncLocal('formula');}});
translation.setMode(false);
services=mountWorkbenchServices(api,formulaAPI,{
  mode:()=>mode,state:()=>state,busy:()=>requesting||!!state?.running||!!state?.translating||!!state?.formulaRecognizing||!!state?.formulaProcessing||workflowBusy()||translation.busy()||!!formula?.busy()||!!picture?.busy()||!!correction?.busy(),
  changed:()=>{if(state)render();},refresh,reconfigure:async()=>{await Promise.all([translation.reloadConfig(),formula!.reloadConfig()]);},
  models:purpose=>purpose==='formula'?formula!.openModels():openLocalModels(),message,
});
function setMode(next:WorkbenchMode){
  mode=next;translation.setMode(next==='translation');formula?.setMode(next==='formula');workspace.show(true);if(state)render();
}
for(const tab of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))tab.onclick=()=>{setMode(tab.dataset.mode as WorkbenchMode);};
const segments=setupSegments(q('app'));
q('local-model-configure').onclick = () => void openLocalModels().catch(message);
q('open-formula').onclick = () => setMode('formula');
q('workflow-back').onclick = () => { if (state.workflow) void api.returnToCapture(state.token, state.workflow.id).catch(message); };
function inference(value: OCRResult['inference']) {
  q('local-model-configure').title = value ? `${value.model} · ${value.device}${value.fallbackReason ? ' · 已回退 CPU：' + value.fallbackReason : ''}` : 'OCR 模型';
  if (value?.fallbackReason) message(Error('已回退 CPU：' + value.fallbackReason));
}
function render() {
  const root = q('app'); if (root.dataset.captureScale !== String(state.uiScale)) applyCaptureScale(root, state.uiScale);
  const busy = requesting || state.running || state.formulaRecognizing||!!state.formulaProcessing||workflowBusy() || !!correction?.busy()||!!picture?.busy()||!!formula?.busy()||!!services?.busy();
  q<HTMLButtonElement>('run').disabled = busy || translation.busy() || (!services?.ocrAI()&&(state.models.downloading || !state.models.ready));
  q('run').title=state.models.downloading?'模型下载中':!state.models.ready?`${state.modelTitle||'所选模型'} 尚未就绪，请打开 OCR 模型`:'';
  q<HTMLSelectElement>('language').disabled = busy;
  q<HTMLTextAreaElement>('result').readOnly = busy || translation.busy();
  q<HTMLButtonElement>('copy').disabled = !q<HTMLTextAreaElement>('result').value.trim();
  q('workflow-back').hidden = !state.workflow?.returnToCapture;
  const loading = requesting || state.running || state.formulaRecognizing||!!state.formulaProcessing||workflowBusy() || translation.busy()||!!picture?.busy();
  q('image-loading').hidden = !loading; q('source').parentElement!.ariaBusy = String(loading);
  q('image-loading-label').textContent = state.waitingForInference ? '等待其他本地任务' : picture?.busy()?'生成译图':translation.busy() || state.workflow?.status === 'translating' ? '翻译中' : '识别中';
  q<HTMLButtonElement>('overlay-cancel').disabled = false;
  selection.setEnabled(!busy&&!translation.busy()&&!picture?.visible()); translation.render();formula?.render();picture?.render();
  q('ocr-tools').hidden=mode!=='ocr';q('text-result').hidden=mode!=='ocr';q('translation-result').hidden=mode!=='translation';q('formula-panel').hidden=mode!=='formula';
  q('copy').hidden=mode!=='ocr';q('translation-copy').hidden=mode!=='translation';for(const id of ['formula-copy','formula-copy-image','formula-export'])q(id).hidden=mode!=='formula';
  const imageTools=document.querySelector<HTMLElement>('.image-translation-tools');if(imageTools)imageTools.hidden=mode!=='translation';
  for(const tab of document.querySelectorAll<HTMLButtonElement>('[data-mode]')){const active=tab.dataset.mode===mode;tab.classList.toggle('selected',active);tab.setAttribute('aria-selected',String(active));tab.disabled=busy||translation.busy();}
  q('app').dataset.recognitionMode=mode;
  const action=q<HTMLButtonElement>('task-run');action.textContent=mode==='formula'?'识别公式':mode==='translation'?(q<HTMLTextAreaElement>('result').value.trim()?'翻译':'识别并翻译'):'识别文字';
  action.disabled=busy||translation.busy()||!services?.ready()||(mode==='formula'?q<HTMLButtonElement>('formula-recognize').disabled:mode==='translation'?!translation.ready():q<HTMLButtonElement>('run').disabled);
  if(mode==='formula'&&loading)q('image-loading-label').textContent=q('formula-loading-label').textContent;
  services?.render();
  const error = state.error || state.models.error || '';
  if (error && error !== reportedError) message(Error(error)); reportedError = error;
}
async function syncWorkflow() {
  const workflow = state.workflow; if (!workflow || workflow.id === workflowRead) return;
  workspace.show(true);if(mode!=='translation')setMode('translation'); if (workflowBusy()) return;
  workflowRead = workflow.id; const token = state.token, result = await api.workflowResult(token, workflow.id);
  if (disposed || state.token !== token) return;
  q<HTMLTextAreaElement>('result').value = result.source; selection.setDocument(result.document); inference(result.inference);
  await translation.workflowResult(result.translation, workflow.target, workflow.error);
}
async function refresh() {
  if (polling || disposed) return; polling = true;
  try { state = await api.state();if(entryRevision!==(state.entryRevision||0)){entryRevision=state.entryRevision||0;setMode(state.mode||'ocr');}await syncWorkflow(); if (!disposed) render(); } catch (error) { if (!disposed) message(error); }
  finally { polling = false; }
}
async function recognize(region?:import('../../shared/recognition/text-area').OCRLocalSelection,override?:import('../../shared/ai-task').AITaskReference){
  if (requesting || state.running || state.formulaRecognizing||workflowBusy() || translation.busy() || correction?.busy()||picture?.busy()) return false;
  requesting = true; render(); message('');
  try {
    const language=q<HTMLSelectElement>('language').value as OCRLanguage;
    const reference=override||services?.ocrAI();if(reference)await services!.verify(reference);
    const result = await (reference?api.runAI(state.token,reference,language,region):region?api.region(state.token,language,region):api.run(state.token,language));
    q<HTMLTextAreaElement>('result').value = result.text; selection.setDocument(result.document,!!reference||!!result.document||!result.text.trim()); inference(result.inference); translation.sourceChanged();
    if (!result.text.trim()) message('未识别到文字');
    return !!result.text.trim();
  } catch (error) { message(error);return false; } finally { requesting = false; await refresh(); }
}
q('run').onclick=()=>void recognize();
q('task-run').onclick=()=>void(async()=>{if(mode==='formula')await formula?.recognize();else if(mode==='translation'){if(!q<HTMLTextAreaElement>('result').value.trim()&&!await recognize(undefined,services?.ocrAI()||(!state.models.ready?services?.ai():undefined)))return;await translation.translateAll();}else await recognize();})().catch(message);
q('overlay-cancel').onclick = () => {if(picture?.busy()){picture.cancel();return;}void api.cancelServiceCheck().catch(message);void (formula?.busy()?formulaAPI.cancelFormula():translation.busy() ? api.cancelTranslation() : api.cancel()).catch(message);};
q('copy').onclick = () => void api.copy(q<HTMLTextAreaElement>('result').value).then(() => message('已复制原文')).catch(message);
q('result').oninput = () => { selection.setDocument(undefined,false); translation.sourceChanged(); if (state) render(); };
registerIcons({ 'scan-text': ScanText }); q('brand').innerHTML = icon('lucide:scan-text'); customControls(document.body);
void api.state().then(async value => { state = value;entryRevision=value.entryRevision||0;setMode(value.mode||'ocr');q('source-name').textContent = state.name;loadImage(needsImagePreview(value)?selection.setImagePreview(value,region=>api.imagePreview(value.token,region)):value.image);await services!.load();await syncWorkflow(); render(); }).catch(message);
void recognitionReady(()=>api.ready()).catch(message);
const timer = setInterval(() => void refresh(), 400);
window.addEventListener('beforeunload', () => { disposed = true;segments.dispose();picture?.dispose(); correction?.dispose(); selection.dispose(); clearInterval(timer); }, { once: true });
}
