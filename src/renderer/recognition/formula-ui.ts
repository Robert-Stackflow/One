import { q } from '../ui';
import 'katex/dist/katex.min.css';
import { mountServiceSettings } from './service-settings';
import {mountLocalModels} from './local-models-ui';
import { formulaText, FORMULA_TEXT, FORMULA_IMAGE } from '../../shared/recognition/formula';
import type { TranslationConfig } from '../../shared/recognition/translation';
import type { FormulaRecognitionAPI, OCRState } from '../../shared/recognition/ocr';
import type {FormulaCrop,FormulaImageOutput} from '../../shared/recognition/formula-image';
import type {TextRotation} from '../../shared/recognition/text-geometry';
import {openAnchoredPopover,closeAnchoredPopover} from '../anchored-popover';
export function mountFormula(
  api: FormulaRecognitionAPI,
  state: () => OCRState | undefined,
  message: (value: unknown) => void,
  changed: () => void|Promise<void>,
  options:{rotation:()=>TextRotation;busy:(value:boolean)=>void}={rotation:()=>0,busy:()=>{}},
) {
  let processing=false,switching=false,operation='',previewReady=false;
  let mode = false,
    requesting = false,
    config: TranslationConfig | undefined,
    notice = '',
    worker: Worker | undefined,
    previewTimer: ReturnType<typeof setTimeout> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined,
    serial = 0;
  const editor = q<HTMLTextAreaElement>('formula-text'),
    preview = q('formula-preview'),
    previewState = q('formula-preview-status');
  let confidence:{token:string;text:string;revision:string;native:boolean;value:number}|undefined;
  editor.maxLength = FORMULA_TEXT;
  const busy = () => switching||requesting||processing || !!state()?.formulaRecognizing||!!state()?.formulaProcessing;
  const local=()=>!!state()?.formulaLocal&&state()!.formulaLocal!.choice.modelId!=='service';
  const source=q<HTMLSelectElement>('formula-source');
  const models=mountLocalModels(api,async()=>{await changed();render();},'formula');
  q('formula-model-configure').onclick=()=>void models().catch(message);
  async function imageOperation(work:()=>Promise<unknown>,label:string){
    if(busy()||!state())return;processing=true;operation=label;message('');render();
    try{await work();await changed();}catch(error){message(error);}finally{processing=false;operation='';render();await changed();}
  }
  const crop=(value?:FormulaCrop)=>imageOperation(()=>api.cropFormula(state()!.token,value),'裁剪中');
  q('formula-image-reset').onclick=()=>void crop();
  const output=(mode:FormulaImageOutput)=>imageOperation(async()=>{const result=await api.outputFormula(state()!.token,editor.value,mode);if(result)message(mode==='copy'?result:'已导出 '+result);},'生成公式图片');
  q('formula-copy-image').onclick=()=>void output('copy');
  const exportButton=q<HTMLButtonElement>('formula-export'),menu=document.createElement('div');menu.className='formula-export-menu';menu.role='menu';menu.hidden=true;document.body.append(menu);let menuOpen=false;
  const closeMenu=(focus=false)=>{menuOpen=false;exportButton.ariaExpanded='false';void closeAnchoredPopover(menu,{immediate:true});menu.hidden=true;if(focus)exportButton.focus();};
  for(const [mode,label] of [['png','导出 PNG'],['svg','导出 SVG']] as const){const button=document.createElement('button');button.type='button';button.role='menuitem';button.textContent=label;button.onclick=()=>{closeMenu();void output(mode);};menu.append(button);}
  exportButton.onclick=()=>{if(menuOpen){closeMenu();return;}menu.hidden=false;menuOpen=openAnchoredPopover(exportButton,menu,{preferred:'above',gap:6,width:160,mode:'manual',onDetach:()=>closeMenu()});exportButton.ariaExpanded=String(menuOpen);if(menuOpen)menu.querySelector('button')?.focus();else menu.hidden=true;};
  document.addEventListener('pointerdown',event=>{if(menuOpen&&!menu.contains(event.target as Node)&&!exportButton.contains(event.target as Node))closeMenu();});
  menu.onkeydown=event=>{const buttons=[...menu.querySelectorAll('button')];if(event.key==='Escape'){event.preventDefault();closeMenu(true);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement)+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}else if(event.key==='Tab')closeMenu();};
  source.onchange=async()=>{
    if(busy()){render();return;}const requested=source.value;switching=true;render();try{
      if(requested==='local'&&!local()){
        const snapshot=await api.localModels(),previous=snapshot.choices.formulaPrevious;
        if(previous&&snapshot.entries.find(entry=>entry.id===previous.modelId)?.ready){await api.saveLocalModel('formula',previous,snapshot.revision);await changed();}else await models();
      }
      else if(requested==='service'&&local()){await api.saveLocalModel('formula',{modelId:'service',device:{mode:'auto'}},state()!.formulaLocal!.revision);await changed();}
    }catch(error){message(error);}finally{switching=false;render();}
  };
  function render() {
    const active = busy(),
      other = !!state()?.running || !!state()?.translating,
      large = (state()?.imageBytes || 0) > FORMULA_IMAGE;
    q('formula-panel').hidden = !mode;
    q('formula-tools').hidden = !mode;
    q('formula-destination').hidden = true;
    q('formula-copy').hidden = !mode;
    const score=q('formula-confidence'),revision=local()?state()?.formulaLocal?.revision:config?.revision;score.hidden=!confidence||confidence.token!==state()?.token||confidence.text!==editor.value||confidence.revision!==revision||confidence.native!==local();score.textContent=score.hidden?'':`置信度 ${Math.round(confidence!.value*100)}%`;
    const native=local(),ready=native?state()?.models.ready:config?.ready;
    options.busy(active||other);if(active&&menuOpen)closeMenu();
    q<HTMLButtonElement>('formula-copy-image').disabled=exportButton.disabled=active||other||!previewReady;
    q('formula-image-reset').hidden=!state()?.formulaHasOriginal;q<HTMLButtonElement>('formula-image-reset').disabled=active||other;
    source.value=native?'local':'service';source.disabled=active||other;
    source.options[1].textContent=native?state()?.modelTitle||'本地模型':'本地模型';
    q<HTMLButtonElement>('formula-model-configure').disabled=active||other;
    q<HTMLButtonElement>('formula-recognize').disabled = active || other || large || !ready;
    q('formula-recognize').textContent=native?'识别公式':'识别公式（发送图片）';
    q<HTMLButtonElement>('formula-configure').disabled = active || other;
    editor.readOnly = active || other;
    q<HTMLButtonElement>('formula-copy').disabled =
      active || !editor.value.trim() || editor.value.length > FORMULA_TEXT;
    q('formula-configure').title = config?.ready ? [config.serviceName||config.endpoint,config.model].filter(Boolean).join(' · ') : '配置公式服务';
    if(!native)source.title=q('formula-configure').title;
    q('formula-recognize').title = large ? '图片超过 8 MiB，请先裁剪' : native?(state()?.models.ready?'在本机识别当前图片':'请先在“公式模型”中下载并使用模型'):'发送当前图片并识别公式';
    q('formula-configure').hidden=native;
    q('image-loading').hidden = !active||switching;
    q('formula-loading-label').textContent=state()?.waitingForInference?'等待本地任务':operation||'识别中';
    q('source').parentElement!.ariaBusy = String(active);
    if (notice) { message(notice); notice = ''; }
  }
  const settings = mountServiceSettings('formula', {
    services:()=>api.dedicatedServices(),
    profiles:()=>api.taskProfiles(),verify:ref=>api.verifyServiceImage(ref),cancelCheck:()=>api.cancelServiceCheck(),migrate:rev=>api.migrateService(rev),restore:rev=>api.restoreService(rev),manage:()=>api.manageServices(),
    load: () => api.formulaConfig(),
    save: (value) => api.saveFormula(value),
    clear: (revision) => api.clearFormula(revision),
    available: () => mode && !busy() && !state()?.running && !state()?.translating,
    updated: (value, text) => {
      config = value;
      if (text) notice = text;
      render();
    },
    error: message,
  });
  q('formula-configure').onclick = () => void settings.open();
  function stopPreview() {
    serial++;
    if (previewTimer) clearTimeout(previewTimer);
    if (deadline) clearTimeout(deadline);
    worker?.terminate();
    worker = undefined;
  }
  function updatePreview() {
    previewReady=false;
    stopPreview();
    preview.replaceChildren();
    preview.removeAttribute('aria-busy');
    const text = editor.value,
      id = serial;
    if (!text.trim()) {
      previewState.textContent = '';
      preview.removeAttribute('aria-busy');
      return;
    }
    try {
      formulaText(text);
    } catch (error) {
      previewState.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    previewState.textContent = '正在生成本机预览…';
    preview.ariaBusy = 'true';
    previewTimer = setTimeout(() => {
      try {
        const current = (worker = new Worker(new URL('./formula-preview.ts',import.meta.url),{type:'module'}));
        const finish = (error: string, html = '') => {
          if (id !== serial) return;
          if (deadline) clearTimeout(deadline);
          current.terminate();
          if (worker === current) worker = undefined;
          preview.removeAttribute('aria-busy');
          previewState.textContent = error
            ? '预览不可用：' + error
            : '';
          if (html) preview.innerHTML = html;
          previewReady=!error&&!!html;render();
        };
        current.onmessage = (event: MessageEvent<{ id: number; html: string; error: string }>) => {
          if (event.data.id === id) finish(event.data.error, event.data.html);
        };
        current.onerror = () => finish('预览组件无法加载，可继续编辑和复制 LaTeX');
        deadline = setTimeout(() => finish('公式过于复杂，请分段处理'), 2000);
        current.postMessage({ id, text });
      } catch {
        preview.removeAttribute('aria-busy');
        previewState.textContent = '预览组件无法加载，可继续编辑和复制 LaTeX';
      }
    }, 180);
  }
  editor.oninput = () => {
    confidence=undefined;
    notice = '';
    updatePreview();
    render();
  };
  q('formula-recognize').onclick = async () => {
    if (busy() || !(local()?state()?.models.ready:config?.ready) || !state()) return;
    requesting = true;
    notice = '';
    message('');
    render();
    changed();
    try {
      const result = await api.recognizeFormula(state()!.token, local()?state()!.formulaLocal!.revision:config!.revision,options.rotation());
      editor.value = result.text;
      confidence=result.confidence!==undefined?{token:state()!.token,text:result.text,revision:result.revision,native:local(),value:result.confidence}:undefined;
      updatePreview();
      notice = '';
      if(result.inference)source.title=(state()?.modelTitle||result.model)+' · '+result.inference.device;
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      requesting = false;
      render();
      changed();
    }
  };
  q('overlay-cancel').onclick = () => void api.cancelFormula().catch(message);
  q('formula-copy').onclick = () =>
    void api
      .copyFormula(editor.value)
      .then(() => {
        notice = '已复制当前 LaTeX';
        render();
      })
      .catch(message);
  window.addEventListener('beforeunload', stopPreview);
  return {
    crop,
    render,
    busy,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
  };
}
