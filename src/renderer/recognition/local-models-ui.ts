import { dialogMarkup, openDialog, closeDialog } from '../dialog';
import { customControls } from '../controls';
import { esc, iconButton, registerIcons } from '../ui';
import { Trash2 } from 'lucide';
import type { RecognitionModelAPI } from '../../shared/recognition/ocr';
import type { LocalModelManagerState } from '../../shared/local-models';
import { supportsCUDAInference,type InferencePreference } from '../../shared/inference-devices';
import './local-models.css';
import { nativeRuntimeLicenses } from '../../shared/recognition/model-sources';
import {recognitionMessage} from './notice';
const size = (bytes:number) => bytes>=1024**3?(bytes/1024**3).toFixed(1)+' GiB':(bytes / 1024 ** 2).toFixed(1) + ' MiB';
const resourceLink=(url:string|undefined,title:string)=>url?.startsWith('https://')?`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(title)}</a>`:esc(title);
export function mountLocalModels(api:RecognitionModelAPI, updated:()=>Promise<void>,purpose:'ocr'|'formula'='ocr',embedded?:{host:HTMLElement;actions:HTMLElement;dialog:HTMLDialogElement;selected?:string;active():boolean}) {
  registerIcons({ 'ocr-model-delete': Trash2 });
  const template = document.createElement('template');
  template.innerHTML = dialogMarkup({id:'local-model-settings',title:purpose==='formula'?'公式模型':'OCR 模型',className:'one-form-dialog local-model-settings',
    body:`<div id="local-model-loading" class="model-dialog-loading" role="status" aria-label="读取模型"><span class="model-action-spinner" aria-hidden="true"></span></div><div class="model-browser" hidden><div id="local-model-list" class="model-list" aria-label="OCR 模型列表"></div><section class="model-detail"><div class="model-detail-heading"><span id="local-model-title"></span><span id="local-model-status"></span>${iconButton('local-model-delete','删除模型','lucide:ocr-model-delete')}</div><section class="model-device-settings"><h3>推理设置</h3>
      <label class="model-device-row">推理设备<select id="local-model-device"><option value="auto">自动</option><option value="cpu">CPU</option><option value="gpu">GPU · DirectML</option></select></label>
      <label class="model-device-row" id="local-model-gpu-field">显卡<select id="local-model-gpu"></select></label><div class="model-device-hint"><span id="local-model-gpu-info"></span><button id="local-model-devices" class="quiet">刷新显卡</button></div></section>
      <section class="model-resource-settings"><h3>模型资源</h3><dl id="local-model-metadata"></dl></section></section></div><p id="local-model-error" class="model-error" role="alert" hidden></p>`,
    actions:'<button id="local-model-save" class="primary"><span class="model-action-spinner" aria-hidden="true" hidden></span><span id="local-model-action-label" aria-live="polite">使用此模型</span></button>'});
  const markup=template.content.firstElementChild as HTMLDialogElement;
  if(purpose==='formula'){markup.id='formula-local-model-settings';markup.innerHTML=markup.innerHTML.replaceAll('local-model-','formula-local-model-');markup.setAttribute('aria-labelledby','formula-local-model-settings-title');}
  const dialog:HTMLElement=embedded?.host||markup,owner=embedded?.dialog||markup;
  if(embedded){dialog.append(...markup.querySelector('.one-dialog-body')!.childNodes);embedded.actions.append(...markup.querySelector('.one-dialog-actions')!.childNodes);}
  else (document.getElementById('app')||document.body).append(markup);
  const field=<T extends HTMLElement>(id:string)=>{const selector=(purpose==='formula'?'#formula-local-model-':'#local-model-')+id;return (dialog.querySelector<T>(selector)||embedded?.actions.querySelector<T>(selector))!;};
  const device = field<HTMLSelectElement>('device'), gpu = field<HTMLSelectElement>('gpu');
  field('list').setAttribute('aria-label',purpose==='formula'?'公式模型列表':'OCR 模型列表');
  let state:LocalModelManagerState|undefined,modelId='',polling=false,saving=false,disposed=false,listKey='',devicesRequested=false;
  let installing:string|undefined;
  const cancelled=new Set<string>(),cancelling=new Set<string>();
  const entry = ()=>state?.entries.find(value=>value.id===modelId);
  const savedChoice=()=>purpose==='formula'&&state?.choices.formula?.modelId==='service'?state.choices.formulaPrevious:state?.choices[purpose];
  const savedModel=()=>{const id=savedChoice()?.modelId;return state?.entries.find(value=>value.id===id&&value.purpose===purpose)?.id||state?.entries.find(value=>value.purpose===purpose)?.id||'';};
  const ready=()=>{
    const value=entry();if(!value?.ready)return false;
    const cuda=value.backends.includes('cuda')&&device.value!=='cpu'&&(device.value==='gpu'||state?.devices.gpus.some(supportsCUDAInference));
    return !cuda||!!value.runtimeReady?.cuda;
  };
  const error = (value:unknown)=>{const node=field('error'),text=recognitionMessage(value);node.textContent=text;node.hidden=!text;};
  function syncDeviceOptions() {
    const previous=gpu.value, backends=entry()?.backends||[],cuda=backends.includes('cuda'),gpuBackend=cuda?'CUDA':'DirectML';
    const available=(state?.devices.gpus||[]).filter(value=>cuda?supportsCUDAInference(value):value.d3d12);
    const preferred=[...available].sort((a,b)=>b.dedicatedMemory-a.dedicatedMemory||(cuda?a.cudaDeviceId!-b.cudaDeviceId!:a.deviceId-b.deviceId))[0];
    const options=[`<option value="">${esc(preferred?'自动 · '+preferred.name:devicesRequested?'没有可用的 '+gpuBackend+' 显卡':'正在读取显卡…')}</option>`];
    for(const value of available)options.push(`<option value="${esc(value.id)}">${esc(value.name)} · ${cuda?'CUDA '+value.cudaDeviceId:value.deviceId}</option>`);
    gpu.innerHTML=options.join('');if(previous&&![...gpu.options].some(value=>value.value===previous))gpu.add(new Option('已保存的显卡；请刷新确认',previous));gpu.value=previous;
    const supportsGPU=cuda||backends.includes('dml');
    const option=[...device.options].find(value=>value.value==='gpu')!;option.disabled=!supportsGPU;option.textContent='GPU · '+gpuBackend;
    if(option.disabled&&device.value==='gpu')device.value='cpu';
    const showGPU=supportsGPU&&(purpose==='formula'?device.value==='gpu':device.value!=='cpu');
    field('gpu-field').hidden=!showGPU;
    field('devices').hidden=purpose==='formula'?!showGPU:!supportsGPU;
    const selected=available.find(value=>value.id===gpu.value)||(!gpu.value?preferred:undefined);
    const info=field('gpu-info');info.hidden=!showGPU;
    info.textContent=state?.devices.error||(!selected?(devicesRequested?'未找到兼容的 '+gpuBackend+' 显卡或驱动':'读取中…'):`${(selected.dedicatedMemory/1024**3).toFixed(1)} GiB 独立显存 · ${cuda?'CUDA '+selected.cudaDeviceId:'DXGI '+selected.deviceId}`);
    field('gpu').title=selected?.name||state?.devices.error||'';
  }
  function choose(id:string,loadSaved=false) {
    modelId=id;const saved=savedChoice();device.value=loadSaved&&saved?saved.device.mode:'auto';gpu.value='';
    if(loadSaved&&saved?.device.gpu){if(![...gpu.options].some(option=>option.value===saved.device.gpu))gpu.add(new Option('已保存的显卡；请刷新确认',saved.device.gpu));gpu.value=saved.device.gpu;}syncDeviceOptions();
    error('');render();field('list').querySelector<HTMLElement>('.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});
    dialog.querySelector<HTMLElement>('.model-detail')!.scrollTop=0;
    if(entry()?.backends.some(backend=>backend==='dml'||backend==='cuda')&&!devicesRequested&&(purpose==='ocr'||device.value==='gpu'))loadDevices();
  }
  function render() {
    if(disposed||!state)return;const entries=state.entries.filter(value=>value.purpose===purpose),key=entries.map(value=>value.id).join('|');
    field('loading').hidden=true;dialog.querySelector<HTMLElement>('.model-browser')!.hidden=false;
    if(listKey!==key){listKey=key;field('list').innerHTML=entries.map(value=>`<button class="model-option" data-select-model="${esc(value.id)}" type="button"><span class="model-option-heading"><span class="model-option-name">${esc(value.title)}</span><span class="model-current" hidden>使用中</span></span><span class="model-option-meta"><span class="model-size">${esc(value.size)}</span><span>${size(value.totalBytes)}</span></span><span class="model-option-state" data-model-state></span></button>`).join('');}
    for(const value of entries){
      const card=dialog.querySelector<HTMLButtonElement>(`[data-select-model="${value.id}"]`)!,current=state.choices[purpose]?.modelId===value.id;
      card.classList.toggle('selected',modelId===value.id);card.classList.toggle('current',current);card.ariaPressed=String(modelId===value.id);
      if(current)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
      card.querySelector<HTMLElement>('.model-current')!.hidden=!current;
      card.querySelector('[data-model-state]')!.textContent=value.downloading?(value.phase==='verifying'?'准备中':`下载中 · ${Math.round(value.progress*100)}%`):value.inUse?'处理中':value.ready?'已安装':value.downloadedBytes?'可继续下载':'未安装';
    }
    const value=entry();if(!value)return;
    const downloading=value.downloading||installing===value.id;
    const applying=saving&&!downloading;
    field('title').textContent=value.title+' · '+value.size;field('status').textContent=downloading?(value.phase==='verifying'?'准备中':'下载中'):value.inUse?'使用中':ready()?'已安装':value.ready?'待准备 CUDA':'未安装';
    const native=value.backends.includes('cuda');
    field('metadata').innerHTML=`<dt>模型大小</dt><dd>${size(value.totalBytes)}</dd><dt>磁盘占用</dt><dd>${size(value.diskBytes)}</dd><dt>兼容设备</dt><dd>${native?'CPU / NVIDIA CUDA':value.backends.includes('dml')?'CPU / DirectML GPU':'CPU'}</dd><dt>实测内存</dt><dd title="合成图片的 CPU 进程峰值；实际占用随图片大小变化">${value.measuredMemoryMiB===undefined?'未知':'CPU 峰值 · '+size(value.measuredMemoryMiB*1024**2)}</dd><dt>实测显存</dt><dd>${value.measuredVRAMMiB===undefined?'未知':size(value.measuredVRAMMiB*1024**2)}</dd><dt>许可 / 精度</dt><dd>${resourceLink(value.weightLicenseSource,value.weightLicense)} · ${esc(value.precision)}</dd><dt>版本</dt><dd>${esc(value.revision)}</dd>${native?`<dt>转换权重</dt><dd>${resourceLink(value.source,'社区 GGUF 转换')}</dd><dt>运行包</dt><dd>llama.cpp b11588 · Windows x64</dd><dt>运行许可</dt><dd>${nativeRuntimeLicenses.map(link=>resourceLink(link.url,link.title)).join(' · ')}</dd>`:''}<dt>图上选字</dt><dd>${value.selection==='ctc'?'近似字级（CTC）':value.selection==='glyph'?'字形 / 词框':value.selection==='region'?'近似区域（整段）':native?'暂不支持':'行框'}</dd>${value.orientationModel===undefined?'':`<dt>行方向模型</dt><dd>${value.orientationModel?'0° / 180°':'未配置'}</dd>`}`;
    field<HTMLButtonElement>('delete').disabled=downloading||value.inUse||!value.diskBytes;
    if(purpose==='formula'){for(const label of field('metadata').querySelectorAll('dt'))if(label.textContent==='图上选字'||label.textContent==='行方向模型'){label.nextElementSibling?.remove();label.remove();}const label=document.createElement('dt'),backend=document.createElement('dd');label.textContent='自动设备';backend.textContent='CPU';field('metadata').append(label,backend);if(value.preparationBytes){const label=document.createElement('dt'),bytes=document.createElement('dd');label.textContent='首次准备运行包';bytes.textContent=size(value.preparationBytes)+'（共享）';field('metadata').append(label,bytes);}}
    field<HTMLButtonElement>('save').disabled=cancelling.has(value.id)||applying;
    field('save').querySelector<HTMLElement>('.model-action-spinner')!.hidden=!downloading&&!applying;
    field('action-label').textContent=cancelling.has(value.id)?'正在取消…':downloading?(value.phase==='verifying'?'取消准备':`取消下载 · ${Math.round(value.progress*100)}%`):applying?'应用中…':ready()?'使用此模型':purpose==='formula'&&value.sourceReady?'准备并使用':value.downloadedBytes?'继续下载并使用':'下载并使用';
    if(value.error&&!cancelled.has(value.id))error(Error(value.error));
  }
  async function refresh(force=false){if(polling||disposed)return;polling=true;try{const next=await api.localModels(force);if(!disposed){state=next;render();}}catch(value){if(!disposed){error(value);if(!state){field('loading').hidden=true;field<HTMLButtonElement>('save').disabled=false;field('action-label').textContent='重试';}}}finally{polling=false;}}
  field('list').onclick=event=>{const card=(event.target as HTMLElement).closest<HTMLElement>('[data-select-model]');if(card&&card.dataset.selectModel!==modelId)choose(card.dataset.selectModel!);};
  device.onchange=()=>{syncDeviceOptions();render();if(purpose==='formula'&&device.value==='gpu'&&!devicesRequested)loadDevices();};
  gpu.onchange=()=>{syncDeviceOptions();render();};
  function loadDevices(){devicesRequested=true;const button=field<HTMLButtonElement>('devices');button.disabled=true;button.textContent='刷新中…';error('');void api.refreshInferenceDevices().then(value=>{if(disposed)return;if(state)state.devices=value;syncDeviceOptions();render();}).catch(error).finally(()=>{button.disabled=false;button.textContent='刷新显卡';});}
  field('devices').onclick=()=>loadDevices();
  field('delete').onclick=()=>{error('');void api.deleteLocalModel(modelId).then(()=>refresh(true)).then(updated).catch(error);};
  field('save').onclick=()=>{
    if(!state){field('loading').hidden=false;field<HTMLButtonElement>('save').disabled=true;error('');void refresh().then(()=>{if(state)choose(savedModel(),true);});return;}
    if(entry()?.downloading||installing===modelId){
      const selected=modelId;if(cancelling.has(selected))return;
      cancelled.add(selected);cancelling.add(selected);error('');render();
      void api.cancelLocalModelInstall(selected).catch(value=>{cancelled.delete(selected);error(value);}).finally(async()=>{cancelling.delete(selected);await refresh(true);render();});return;
    }
    if(!state||saving)return;const selected=modelId,feature=purpose,revision=state.revision;
    const preference:InferencePreference={mode:device.value as InferencePreference['mode'],...(gpu.value&&device.value!=='cpu'?{gpu:gpu.value}:{})};
    const installed=ready(),native=entry()!.backends.includes('cuda');saving=true;cancelled.delete(selected);if(!installed)installing=selected;render();error('');
    void (async()=>{
      if(!installed||native)await api.installLocalModel(selected,preference);installing=undefined;if(cancelled.has(selected))return;
      const nextRevision=await api.saveLocalModel(feature,{modelId:selected,device:preference},revision);
      if(!disposed&&state){state.choices[purpose]={modelId:selected,device:preference};if(typeof nextRevision==='string')state.revision=nextRevision;render();}
      if(!disposed&&(!embedded||embedded.active()))await closeDialog(owner);await updated();
    })().catch(value=>{if(!cancelled.has(selected))error(value);}).finally(async()=>{installing=undefined;saving=false;await refresh(true);render();});
  };
  if(!embedded)owner.querySelector<HTMLButtonElement>('[data-dialog-dismiss]')!.onclick=()=>void closeDialog(owner);
  const timer=setInterval(()=>{if(owner.open&&(!embedded||embedded.active()))void refresh();},800);
  const dispose=()=>{disposed=true;clearInterval(timer);window.removeEventListener('beforeunload',dispose);};
  window.addEventListener('beforeunload',dispose,{once:true});if(embedded)owner.addEventListener('close',dispose,{once:true});
  const initialChoice=()=>embedded&&(modelId||state?.entries.some(value=>value.id===embedded.selected&&value.purpose===purpose))?modelId||embedded.selected!:savedModel();
  const open=async()=>{if(disposed)return;error('');if(state){const id=initialChoice();choose(id,id===savedModel());}else{field('loading').hidden=false;field<HTMLButtonElement>('save').disabled=true;field('action-label').textContent='读取中…';}if(!embedded)openDialog(owner);customControls(dialog);await refresh();if(state&&!disposed&&owner.open&&!modelId){const id=initialChoice();choose(id,id===savedModel());}};
  return Object.assign(open,{dispose});
}
