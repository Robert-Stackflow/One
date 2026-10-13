import {Camera,RefreshCw,Layers,ArrowDown,ArrowUp,Pencil,Trash2,Plus,Settings2} from 'lucide';
import {api,icon,registerIcons,errorMessage,toast} from './ui';
import {onRemoval} from './dom-lifecycle';
import {closeControls} from './controls';
import {applyCaptureScale} from './capture/appearance';
import {sourceCard,bindSourceCardPreviews} from './capture/source-card';
import {splitAction,bindSplitAction} from './capture/split-action';
import {windowCompositionPicker} from './capture/window-picker';
import {openCustomCapture} from './capture/custom-dialog';
import type {CaptureCommands,CaptureOptions} from '../shared/capture/api';
import type {CapturePreferences} from '../shared/capture/settings';
import './capture-view.css';

registerIcons({camera:Camera,'refresh-cw':RefreshCw,layers:Layers,'arrow-down':ArrowDown,'arrow-up':ArrowUp,pencil:Pencil,trash:Trash2,plus:Plus,settings:Settings2});
const modes=[['region','区域'],['screen','显示器'],['window','窗口'],['windows','多窗口'],['desktop','全屏'],['scroll','长截图'],['free','自由'],['polygon','折线']] as const;
type Mode=typeof modes[number][0];
const labels:Record<Mode,string>={region:'选择区域',free:'绘制选区',polygon:'绘制选区',screen:'截取显示器',desktop:'截取所有屏幕',window:'截取窗口',windows:'组合截图',scroll:'开始长截图'};
const notes:Record<Mode,string>={region:'拖动选择区域，截图后继续编辑。',free:'自由绘制选区，保留轮廓内的画面。',polygon:'逐点绘制选区，按 Enter 完成。',screen:'选择一个显示器，截取完整画面。',desktop:'将所有显示器按桌面位置合成一张图片。',window:'选择窗口，双击即可截图。',windows:'选择多个窗口，按桌面位置组合，可调整上下层级。',scroll:'选择内容区域，滚动拼接成长图。'};
export interface CapturePageCommands {scroll?(displayId:number|undefined,options:CaptureOptions):Promise<unknown>}
export function capturePage(){
  return `<div class="capture-page"><div id="capture-modes" class="capture-mode tabs" role="tablist" aria-label="截图方式">${modes.map(([id,label])=>`<button type="button" data-capture-mode="${id}" role="tab" aria-selected="${id==='region'}" aria-controls="capture-sources" class="${id==='region'?'selected':''}">${label}</button>`).join('')}</div><div class="capture-error" role="alert" hidden><span></span><button type="button" class="quiet" data-capture-retry>重试</button></div><div id="capture-sources" role="tabpanel" class="capture-sources"><p class="page-note">正在读取显示器…</p></div><footer class="capture-quick-actions"><span></span><div><button type="button" class="quiet" data-capture-action="clipboard">${icon('clipboard')}剪贴板图片</button><button type="button" class="quiet" data-capture-action="import">${icon('plus')}导入图片</button></div></footer></div>`;
}
export function setupCapture(root:HTMLElement,heading:HTMLElement,commands:CapturePageCommands={}){
  const page=root.querySelector<HTMLElement>('.capture-page')!,sources=page.querySelector<HTMLElement>('#capture-sources')!,error=page.querySelector<HTMLElement>('.capture-error')!;
  let mode:Mode='region',displayId=0,active=false,disposed=false,busy=false,revision=0,scaleRevision=0,ready=false;
  let state:Awaited<ReturnType<CaptureCommands['captureState']>>|undefined,preferences:CapturePreferences|undefined;
  let take:((options:CaptureOptions)=>Promise<unknown>)|undefined,closeCustom:(()=>void)|undefined,closeMenus:()=>void=()=>{};
  const report=(value:unknown)=>{if(disposed)return;error.hidden=false;error.querySelector('span')!.textContent=errorMessage(value);};
  const clearError=()=>{error.hidden=true;error.querySelector('span')!.textContent='';};
  const applyScale=(scale:CapturePreferences['uiScale'])=>{applyCaptureScale(page,scale);applyCaptureScale(heading,scale);if(preferences)preferences.uiScale=scale;};
  function sync(){
    page.inert=busy;
    for(const button of heading.querySelectorAll<HTMLButtonElement>('button'))button.disabled=busy||!ready||button.id.startsWith('take-capture')&&!take;
  }
  async function run(work:()=>Promise<unknown>){
    if(busy||disposed)return;busy=true;clearError();sync();
    try{await work();}catch(value){report(value);}finally{busy=false;if(!disposed)sync();}
  }
  function showCustom(hideMainWindow:boolean){
    if(busy||!ready||!state||!preferences)return;
    closeCustom?.();
    closeCustom=openCustomCapture({patchSettings:async value=>{const settings=await api.patchSettings(value);preferences=settings.capture;return settings;},captureCustom:(...args)=>run(()=>api.captureCustom(...args))},()=>({screens:state!.screens,displayId,custom:preferences!.custom,uiScale:preferences!.uiScale}),report,displayId,{hideMainWindow});
  }
  function drawActions(){
    closeMenus();heading.innerHTML=splitAction('custom-capture','自定义','lucide:settings')+splitAction('take-capture',labels[mode],'lucide:camera',true);
    const custom=bindSplitAction(heading,'custom-capture',showCustom);
    const capture=bindSplitAction(heading,'take-capture',hideMainWindow=>{if(take)void run(()=>take!({hideMainWindow}));});
    closeMenus=()=>{custom();capture();};sync();
  }
  async function loadSources(){
    if(!active||disposed||!state)return;
    const request=++revision,kind=mode,current=()=>!disposed&&active&&request===revision;
    take=undefined;clearError();
    const windowMode=kind==='window'||kind==='windows';
    sources.innerHTML=`${kind==='windows'?'':`<div class="capture-source-heading"><div><h2>${windowMode?'选择窗口':kind==='desktop'?'全部显示器':'选择显示器'}</h2><p>${notes[kind]}</p></div><button type="button" id="refresh-capture-sources" class="quiet icon-button" title="刷新来源" aria-label="刷新来源">${icon('lucide:refresh-cw')}</button></div>`}<div class="capture-source-scroll"><div id="capture-windows" class="${windowMode?'window-grid':'display-grid'}">${windowMode?'<p class="page-note">正在读取窗口…</p>':state.screens.map(item=>sourceCard({key:item.id,attribute:'data-display',name:item.name,meta:item.width+' × '+item.height,selected:displayId===item.id||kind==='desktop',disabled:kind==='desktop',kind:'screen',previewKey:item.id})).join('')}</div></div>`;
    drawActions();
    const refresh=sources.querySelector<HTMLButtonElement>('#refresh-capture-sources');if(refresh)refresh.onclick=()=>void refreshState();
    const grid=sources.querySelector<HTMLElement>('#capture-windows')!;
    try{
      if(windowMode){
        const choices=await api.captureWindows();if(!current())return;
        if(kind==='windows'){
          const picker=windowCompositionPicker(grid,choices,valid=>{take=valid?options=>api.captureWindowSet(picker.tokens(),options,picker.placements()):undefined;sync();},()=>void refreshState());
        }else{
          grid.innerHTML=choices.length?choices.map(item=>sourceCard({key:item.token,attribute:'data-capture-window',name:item.name,thumbnail:item.thumbnail,meta:item.bounds.width+' × '+item.bounds.height,kind:'window'})).join(''):'<p class="page-note">没有可捕获的窗口，打开或还原窗口后刷新。</p>';
          bindSourceCardPreviews(grid);
          for(const button of grid.querySelectorAll<HTMLButtonElement>('[data-capture-window]')){
            const select=()=>{for(const item of grid.querySelectorAll('[data-capture-window]')){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));}take=options=>api.captureWindow(button.dataset.captureWindow!,options);sync();};
            button.onclick=select;button.ondblclick=()=>{select();void run(()=>take!({hideMainWindow:false}));};
          }
        }
      }else{
        take=kind==='scroll'?(commands.scroll?options=>commands.scroll!(displayId,options):undefined):options=>api.captureTake(kind,kind==='desktop'?undefined:displayId,options);sync();
        for(const button of grid.querySelectorAll<HTMLButtonElement>('[data-display]'))button.onclick=()=>{displayId=Number(button.dataset.display);for(const item of grid.querySelectorAll('[data-display]')){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));}};
        const thumbnails=await api.captureDisplays();if(!current())return;
        for(const item of thumbnails){const box=grid.querySelector<HTMLElement>(`[data-display-preview="${item.id}"]`);if(box&&item.thumbnail){const image=new Image();image.src=item.thumbnail;image.alt='';box.replaceChildren(image);}}
      }
    }catch(value){if(current())report(value);}
  }
  async function refreshState(){
    if(!active||disposed||busy)return;
    const request=++revision,scale=scaleRevision;
    try{
      const [next,settings]=await Promise.all([api.captureState(),api.settings()]);if(disposed||!active||request!==revision)return;
      state=next;preferences=settings.capture;
      if(!next.screens.some(item=>item.id===displayId))displayId=next.displayId;
      if(scale===scaleRevision)applyScale(preferences.uiScale);
      else preferences.uiScale=Number(page.dataset.captureScale) as CapturePreferences['uiScale'];
      ready=true;await loadSources();
    }catch(value){if(!disposed&&active&&request===revision)report(value);}
  }
  page.querySelector<HTMLButtonElement>('[data-capture-retry]')!.onclick=()=>void refreshState();
  drawActions();
  for(const button of page.querySelectorAll<HTMLButtonElement>('[data-capture-mode]'))button.onclick=()=>{
    if(busy)return;mode=button.dataset.captureMode as Mode;
    for(const tab of page.querySelectorAll('[data-capture-mode]')){tab.classList.toggle('selected',tab===button);tab.setAttribute('aria-selected',String(tab===button));}
    void loadSources();
  };
  page.querySelector<HTMLButtonElement>('[data-capture-action=clipboard]')!.onclick=()=>void run(async()=>{const id=await api.materialsImportClipboard();await api.materialsEditImage(id);});
  page.querySelector<HTMLButtonElement>('[data-capture-action=import]')!.onclick=()=>void run(async()=>{const ids=await api.materialsImportImages();if(ids.length===1)await api.materialsEditImage(ids[0]);else if(ids.length)toast(`已导入 ${ids.length} 张图片`);});
  const stopPreferences=api.onCapturePreferences(value=>{++scaleRevision;if(!disposed)applyScale(value.uiScale);});
  const dispose=()=>{if(disposed)return;disposed=true;active=false;++revision;closeMenus();closeCustom?.();stopPreferences();sources.replaceChildren();};
  onRemoval(root,dispose);
  return {activate(value:boolean){active=value;if(value)void refreshState();else{++revision;closeMenus();closeCustom?.();closeControls();}},async custom(){await refreshState();if(active&&!disposed)showCustom(true);},dispose};
}
