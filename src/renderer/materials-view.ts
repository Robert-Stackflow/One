import {AudioLines,Images,Video} from 'lucide';
import {api,esc,icon,registerIcons,toast,errorMessage} from './ui';
import {confirmDialog} from './dialog';
import {onRemoval} from './dom-lifecycle';
import {searchField,setupSearchField} from './search-field';
import {applyCaptureScale} from './capture/appearance';
import type {ImageMaterialView,RecordingMaterialView,MaterialsState} from '../shared/materials';
import {collectionCheck,collectionSelectButton,collectionSelectionBar,syncCollectionSelection,toggleCollectionRange,collectionShortcut} from './collection-selection';
import {collectionCardActions} from './collection-card-actions';
import './materials-view.css';

registerIcons({images:Images,video:Video,'audio-lines':AudioLines});
/** Operations supplied by the recognition, pin and recording service controllers. */
export interface MaterialsCommands {
  recognize?(id:string):Promise<unknown>;
  pin?(id:string):Promise<unknown>;
  openRecording?(id:string):Promise<unknown>;
  importRecording?(kind:'project'|'video'):Promise<unknown>;
}
type Kind='images'|'recordings';
const actionButton=(action:string,id:string,label:string,glyph:string)=>`<button type="button" class="icon-button quiet" data-material-action="${action}" data-material-id="${esc(id)}" title="${label}" aria-label="${label}">${icon(glyph)}</button>`;
const titleButton=(action:string,label:string,glyph:string,primary=false)=>`<button type="button" class="${primary?'primary':'quiet'}" data-material-action="${action}">${icon(glyph)}${label}</button>`;
function imageCard(item:ImageMaterialView,checked=false){
  return `<article class="asset-card collection-card" data-material-card="${item.id}" data-collection-card="${item.id}"><button class="asset-preview" type="button" data-material-action="edit" data-material-id="${item.id}" aria-label="编辑 ${esc(item.title)}"><img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" loading="lazy"></button><div class="asset-body"><div class="asset-caption"><h3 class="asset-title" title="${esc(item.title)}">${esc(item.title)}</h3><div class="asset-meta"><span>${item.width} × ${item.height}</span><span>${item.bytes<1048576?Math.round(item.bytes/1024)+' KB':(item.bytes/1048576).toFixed(1)+' MB'}</span><span>${new Date(item.created).toLocaleDateString('zh-CN')}</span></div></div>${collectionCheck('data-material-select',item.id,item.title,checked)}</div>${collectionCardActions({className:'asset-actions',pin:{attributes:{'data-material-action':'pin','data-material-id':item.id}},copy:{attributes:{'data-material-action':'copy','data-material-id':item.id}},save:{attributes:{'data-material-action':'export','data-material-id':item.id}},remove:{attributes:{'data-material-action':'remove','data-material-id':item.id},label:'删除素材'},recognize:{attributes:{'data-material-action':'recognize','data-material-id':item.id}}})}</article>`;
}
function recordingCard(item:RecordingMaterialView,checked=false){
  const duration=Math.floor(item.seconds/60).toString().padStart(2,'0')+':'+Math.floor(item.seconds%60).toString().padStart(2,'0');
  return `<article class="asset-card collection-card recording-card" data-material-card="${item.id}" data-collection-card="${item.id}"><button class="asset-preview recording-preview" type="button" data-material-action="recording" data-material-id="${item.id}" aria-label="编辑 ${esc(item.title)}">${icon(item.mode==='audio'?'lucide:audio-lines':'lucide:video')}${item.mode==='video'&&item.thumbnail?`<img src="${esc(item.thumbnail)}" alt="" loading="lazy">`:''}<span class="recording-duration">${duration}</span></button><div class="asset-body"><div class="asset-caption"><h3 class="asset-title" title="${esc(item.title)}">${esc(item.title)}</h3><div class="asset-meta"><span>${item.mode==='audio'?'录音':'录屏'}</span><span>${(item.bytes/1048576).toFixed(1)} MB</span><time>${new Date(item.created).toLocaleDateString('zh-CN')}</time></div></div>${collectionCheck('data-material-select',item.id,item.title,checked)}</div>${collectionCardActions({className:'asset-actions',save:{attributes:{'data-material-action':'export-recording','data-material-id':item.id},label:'导出录制工程'},remove:{attributes:{'data-material-action':'remove-recording','data-material-id':item.id},label:'删除录制素材'},extra:actionButton('recording',item.id,'编辑录制','rename')})}</article>`;
}
const empty=(title:string,description:string,glyph:string)=>`<div class="empty-state">${icon(glyph)}<h2>${title}</h2><p>${description}</p></div>`;
export function materialsPage(){
  return `<div class="materials-page"><div class="collection-toolbar"><div id="material-tabs" class="tabs" role="tablist" aria-label="素材类型"><button id="material-images" type="button" role="tab" aria-selected="true" aria-controls="material-results" class="selected">图片 <small>0</small></button><button id="material-recordings" type="button" role="tab" aria-selected="false" aria-controls="material-results">录制 <small>0</small></button></div><div class="collection-toolbar-actions">${searchField('material-search','搜索素材','搜索素材名称')}${collectionSelectButton()}</div></div><div class="materials-error" role="alert" hidden><span></span><button type="button" data-material-action="refresh">重试</button></div><div id="material-results" class="collection-scroll" role="tabpanel" aria-labelledby="material-images">${empty('正在读取素材','', 'lucide:images')}</div></div>`;
}
export function setupMaterials(root:HTMLElement,heading:HTMLElement,commands:MaterialsCommands={}){
  const page=root.querySelector<HTMLElement>('.materials-page')!,results=page.querySelector<HTMLElement>('#material-results')!,search=page.querySelector<HTMLInputElement>('#material-search')!;
  const error=page.querySelector<HTMLElement>('.materials-error')!,tabs=Array.from(page.querySelectorAll<HTMLButtonElement>('[role=tab]'));
  let kind:Kind='images',state:MaterialsState|undefined,active=false,disposed=false,dirty=true,refreshing:Promise<void>|undefined,scaleRevision=0;
  const pending=new Set<string>(),selected=new Set<string>();let batchBusy=false,selecting=false,anchor:string|undefined;
  const selection=document.createElement('div');selection.className='materials-selection';selection.setAttribute('aria-label','素材选择与批量操作');selection.innerHTML=collectionSelectionBar('materials-select-all','素材选择与批量操作',`<button type="button" class="quiet" data-material-batch="pin">${icon('pin')}贴出所选</button><button type="button" class="quiet" data-material-batch="export">${icon('download')}导出所选</button><button type="button" class="quiet danger" data-material-batch="remove">${icon('trash')}删除所选</button>`);results.after(selection);
  const handlers:Record<string,((id:string)=>Promise<unknown>)|undefined>={
    directory:()=>api.materialsOpenDirectory(),'open-project':()=>api.materialsOpenImageProject(),'import-images':()=>api.materialsImportImages(),
    'import-project':commands.importRecording?()=>commands.importRecording!('project'):undefined,'import-video':commands.importRecording?()=>commands.importRecording!('video'):undefined,
    edit:id=>api.materialsEditImage(id),recognize:commands.recognize,pin:commands.pin,copy:async id=>{await api.materialsCopyImage(id);toast('已复制图片');},
    'export-recording':async id=>{const result=await api.materialsExportBatch('recordings',[id]);if(result.failed.length)throw Error(result.failed[0].error);if(!result.canceled)toast('已导出录制工程');},
    export:id=>api.materialsExportImage(id),remove:id=>api.materialsRemoveImage(id),recording:commands.openRecording,
    'remove-recording':async id=>{if(await confirmDialog({title:'删除录制素材',message:'删除这份录制素材工程？',confirm:'删除',danger:true}))await api.materialsRemoveRecording(id);},
    refresh:async()=>{dirty=true;await refresh();},
  };
  const key=(button:HTMLButtonElement)=>button.dataset.materialAction+':'+(button.dataset.materialId||'');
  function syncActions(){
    for(const container of [page,heading])for(const button of container.querySelectorAll<HTMLButtonElement>('[data-material-action]')){
      button.disabled=batchBusy||!handlers[button.dataset.materialAction!]||pending.has(key(button));
    }
    tabs.forEach(tab=>tab.disabled=batchBusy);search.disabled=batchBusy;
    page.querySelectorAll<HTMLInputElement>('[data-material-select],#materials-select-all').forEach(input=>input.disabled=batchBusy);
    page.querySelectorAll<HTMLButtonElement>('[data-material-batch]').forEach(button=>button.disabled=batchBusy||!!pending.size||!selected.size||(button.dataset.materialBatch==='pin'&&!commands.pin));
  }
  const visible=()=>state?.[kind].filter(item=>item.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))||[];
  function renderSelection(){
    syncCollectionSelection(page,selected,visible().map(item=>item.id),selecting,batchBusy);
    selection.querySelector<HTMLButtonElement>('[data-material-batch=pin]')!.hidden=kind!=='images';syncActions();
  }
  function selectable(item:ImageMaterialView|RecordingMaterialView){return kind==='images'?imageCard(item as ImageMaterialView,selected.has(item.id)):recordingCard(item as RecordingMaterialView,selected.has(item.id));}
  function toggle(id:string,checked:boolean,shift=false){if(batchBusy)return;selecting=true;anchor=toggleCollectionRange(selected,visible().map(item=>item.id),id,checked,shift,anchor);renderSelection();}
  function clearSelection(){selected.clear();anchor=undefined;selecting=false;renderSelection();page.querySelector<HTMLButtonElement>('[data-collection-toggle]')?.focus({preventScroll:true});}
  const keys=(event:KeyboardEvent)=>{if(batchBusy)return;const key=collectionShortcut(event);if(!key||key==='clear'&&!selecting)return;event.preventDefault();event.stopPropagation();if(key==='all'){selecting=true;for(const item of visible())selected.add(item.id);renderSelection();}else if(key==='clear')clearSelection();else toggle(key,!selected.has(key),event.shiftKey);};
  async function batch(action:string){
    if(batchBusy||pending.size)return;
    const ids=visible().filter(item=>selected.has(item.id)).map(item=>item.id),batchKind=kind;if(!ids.length)return;
    batchBusy=true;renderSelection();
    try{
      if(action==='remove'&&!await confirmDialog({title:'删除所选素材',message:`删除这 ${ids.length} 份素材工程？此操作无法撤销。`,confirm:'删除',danger:true}))return;
      let completed:string[]=[],failed:{id:string;error:string}[]=[];
      if(action==='export'){
        const answer=await api.materialsExportBatch(batchKind,ids);if(answer.canceled)return;({completed,failed}=answer);
      }else{
        for(const id of ids){
          try{if(action==='pin'){if(!commands.pin)throw Error('贴图服务不可用');await commands.pin(id);}else if(batchKind==='images')await api.materialsRemoveImage(id);else await api.materialsRemoveRecording(id);completed.push(id);}
          catch(error){failed.push({id,error:errorMessage(error)});}
        }
      }
      for(const id of completed)selected.delete(id);
      toast(failed.length?`已完成 ${completed.length} 项，${failed.length} 项未完成：${failed[0].error}`:`已${action==='remove'?'删除':action==='pin'?'贴出':'导出'} ${completed.length} 项`);
      dirty=true;await refresh();
    }finally{batchBusy=false;if(!disposed){renderSelection();syncActions();}}
  }
  function renderHeading(){
    heading.innerHTML=titleButton('directory','素材目录','folder')+(kind==='images'?titleButton('open-project','打开工程','folder')+titleButton('import-images','导入图片','plus',true):titleButton('import-project','导入工程','folder')+titleButton('import-video','导入视频','plus',true));syncActions();
  }
  function renderResults(){
    if(!state||disposed)return;
    for(const id of selected)if(!state[kind].some(item=>item.id===id))selected.delete(id);
    const focused=document.activeElement instanceof HTMLButtonElement&&results.contains(document.activeElement)?key(document.activeElement):undefined;
    const query=search.value.toLocaleLowerCase(),items=state[kind].filter(item=>item.title.toLocaleLowerCase().includes(query));
    results.innerHTML=items.length?`<div class="asset-grid">${items.map(selectable).join('')}</div>`:state.error?'':empty(query?'没有匹配的素材':kind==='images'?'还没有图片':'还没有录制',query?'尝试换个名称搜索。':kind==='images'?'截图或导入图片后，会自动保存在这里。':'完成录制或导入工程后，可在这里继续编辑。',kind==='images'?'lucide:images':'lucide:video');
    renderSelection();
    // A missing poster keeps the original video glyph visible.
    results.querySelectorAll<HTMLImageElement>('.recording-preview img').forEach(img=>{img.onerror=()=>{img.hidden=true;};});
    tabs[0].querySelector('small')!.textContent=String(state.images.length);tabs[1].querySelector('small')!.textContent=String(state.recordings.length);
    error.hidden=!state.error;error.querySelector('span')!.textContent=state.error;syncActions();
    if(focused)Array.from(results.querySelectorAll<HTMLButtonElement>('[data-material-action]')).find(button=>key(button)===focused)?.focus({preventScroll:true});
  }
  function refresh():Promise<void>{
    if(refreshing)return refreshing;
    if(!active||disposed||!dirty)return Promise.resolve();
    const task=(async()=>{
      while(active&&!disposed&&dirty){
        dirty=false;
        try{const next=await api.materialsState();if(disposed)return;state=next;if(active)renderResults();}
        catch(reason){if(disposed)return;if(!state)results.replaceChildren();error.hidden=false;error.querySelector('span')!.textContent=errorMessage(reason);break;}
      }
    })().finally(()=>{if(refreshing===task)refreshing=undefined;});
    refreshing=task;return task;
  }
  function choose(value:Kind){
    if(kind===value||batchBusy)return;kind=value;selected.clear();anchor=undefined;
    tabs.forEach((tab,index)=>{const selected=(index===0)===(kind==='images');tab.classList.toggle('selected',selected);tab.setAttribute('aria-selected',String(selected));});
    results.setAttribute('aria-labelledby',kind==='images'?'material-images':'material-recordings');renderHeading();renderResults();
  }
  const tabClick=(event:Event)=>choose((event.currentTarget as HTMLElement).id==='material-images'?'images':'recordings');
  const input=()=>{selected.clear();anchor=undefined;renderResults();};
  const changed=(event:Event)=>{
    const input=event.target as HTMLInputElement;if(batchBusy||input.tagName!=='INPUT')return;
    if(input.id==='materials-select-all'){for(const item of visible())if(input.checked)selected.add(item.id);else selected.delete(item.id);renderSelection();}
  };
  const clicked=(event:Event)=>{
    const target=event.target as HTMLElement,choice=target.closest<HTMLInputElement>('[data-material-select]');
    if(choice){toggle(choice.dataset.materialSelect!,choice.checked,(event as MouseEvent).shiftKey);return;}
    if(target.closest('.collection-check'))return;
    if(target.closest('[data-collection-clear]')){if(!batchBusy)clearSelection();return;}
    if(target.closest('[data-collection-toggle]')){if(batchBusy)return;if(selecting)clearSelection();else{selecting=true;renderSelection();}return;}
    const card=target.closest<HTMLElement>('[data-collection-card]'),action=target.closest<HTMLButtonElement>('[data-material-action]');
    if(card&&(!target.closest('button,input,select,a')||(action&&['edit','recording'].includes(action.dataset.materialAction!)&&(selecting||(event as MouseEvent).ctrlKey||(event as MouseEvent).metaKey||(event as MouseEvent).shiftKey)))){toggle(card.dataset.collectionCard!,!selected.has(card.dataset.collectionCard!),(event as MouseEvent).shiftKey);return;}

    const batchButton=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-material-batch]');if(batchButton){if(!batchButton.disabled)void batch(batchButton.dataset.materialBatch!).catch(toast);return;}
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-material-action]');if(!button||button.disabled)return;
    const handler=handlers[button.dataset.materialAction!],id=button.dataset.materialId||'',name=key(button);if(!handler||pending.has(name)||disposed)return;
    pending.add(name);syncActions();void handler(id).catch(reason=>{if(!disposed)toast(reason);}).finally(()=>{pending.delete(name);if(!disposed)syncActions();});
  };
  tabs.forEach(tab=>tab.addEventListener('click',tabClick));search.addEventListener('input',input);page.addEventListener('change',changed);page.addEventListener('click',clicked);heading.addEventListener('click',clicked);page.addEventListener('keydown',keys);
  const stopSearch=setupSearchField(search),stopChanged=api.onMaterialsChanged(()=>{dirty=true;void refresh();});
  const applyScale=(scale:100|110|125|150)=>{applyCaptureScale(page,scale);applyCaptureScale(heading,scale);};
  const stopPreferences=api.onCapturePreferences(value=>{++scaleRevision;if(!disposed)applyScale(value.uiScale);});
  const stopRemoval=onRemoval(root,dispose);renderHeading();
  function dispose(){if(disposed)return;disposed=true;active=false;stopChanged();stopPreferences();stopSearch();stopRemoval();tabs.forEach(tab=>tab.removeEventListener('click',tabClick));search.removeEventListener('input',input);page.removeEventListener('change',changed);page.removeEventListener('click',clicked);heading.removeEventListener('click',clicked);page.removeEventListener('keydown',keys);heading.replaceChildren();}
  return {activate(value:boolean){active=value;if(value){dirty=true;const revision=scaleRevision;void api.settings().then(settings=>{if(!disposed&&revision===scaleRevision)applyScale(settings.capture.uiScale);}).catch(toast);void refresh();}},dispose};
}
