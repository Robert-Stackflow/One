import {api,icon,toast,errorMessage} from './ui';
import {mountPinsPage} from './pins/pins-page';
import {ActionScope} from './action-scope';
import {onRemoval} from './dom-lifecycle';
import {applyCaptureScale} from './capture/appearance';
import type {PinWorkspace} from '../shared/pins';
import './pins-view.css';
export function pinsPage(){return '<p class="pins-loading" role="status">正在读取贴图</p>';}
export function setupPins(root:HTMLElement,heading:HTMLElement){
  root.classList.add('pins-page');
  heading.innerHTML=`<button id="pins-file-add" type="button" class="quiet">${icon('folder')}添加文件</button><button id="pins-clipboard-add" type="button" class="primary">${icon('plus')}贴图</button>`;
  const actions=new ActionScope();actions.bind(heading.querySelector('#pins-file-add'),()=>api.pinsFiles(),toast);actions.bind(heading.querySelector('#pins-clipboard-add'),()=>api.pinsClipboard(),toast);
  let active=false,disposed=false,dirty=true,refreshing:Promise<void>|undefined,state:PinWorkspace,view:ReturnType<typeof mountPinsPage>|undefined,scaleRevision=0;
  function refresh():Promise<void>{
    if(refreshing)return refreshing;if(!active||disposed||!dirty)return Promise.resolve();
    const task=(async()=>{while(active&&!disposed&&dirty){dirty=false;try{
      const next=await api.pinsState();if(disposed)return;state=next;
      if(active){if(view)view.update();else view=mountPinsPage(root,api,()=>state);}
    }catch(error){if(disposed)return;if(view)toast(error);else{root.innerHTML='<p class="pins-load-error" role="alert"></p><button type="button" class="pins-retry">重试</button>';root.querySelector('.pins-load-error')!.textContent=errorMessage(error);root.querySelector<HTMLButtonElement>('.pins-retry')!.onclick=()=>{dirty=true;void refresh();};}break;}}})().finally(()=>{if(refreshing===task)refreshing=undefined;});
    refreshing=task;return task;
  }
  const scale=(value:100|110|125|150)=>{applyCaptureScale(root,value);applyCaptureScale(heading,value);};
  const stopChanged=api.onPinsChanged(()=>{dirty=true;void refresh();}),stopPreferences=api.onCapturePreferences(value=>{++scaleRevision;if(!disposed)scale(value.uiScale);});
  const stopRemoval=onRemoval(root,dispose);
  function dispose(){if(disposed)return;disposed=true;active=false;view?.dispose();stopChanged();stopPreferences();stopRemoval();heading.replaceChildren();}
  return {activate(value:boolean){active=value;view?.activate(value);if(value){dirty=true;const revision=scaleRevision;void api.settings().then(settings=>{if(!disposed&&revision===scaleRevision)scale(settings.capture.uiScale);}).catch(toast);void refresh();}},dispose};
}
