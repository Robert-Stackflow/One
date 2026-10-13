import {api,button,q,switchControl} from './ui';
import {selectSource} from './controls';
import {confirmDialog} from './dialog';
import {captureScales,defaultCapturePreferences,type CapturePreferences} from '../shared/capture/settings';
import type {SettingsPatch} from '../shared/types';
import {openCustomCapture} from './capture/custom-dialog';
import {mountWorkflowSettings} from './capture/workflow-settings';

export function captureSettingsPage(){return `<div class="capture-settings">
  <h2 class="settings-title">截图与录制</h2>
  <div class="settings-card">
    <div class="setting-row"><div class="setting-copy"><h2>界面缩放</h2><p>作用于截图、录制、素材、贴图及对应功能窗口。</p></div><select id="capture-pref-scale" aria-label="截图与录制界面缩放">${captureScales.map(scale=>`<option value="${scale}">${scale}%</option>`).join('')}</select></div>
    <div class="setting-row"><div class="setting-copy"><h2>远程控制兼容</h2><p>让远程控制软件能看到截图图层。刷新画面或长截图采集时，重叠的浮层会短暂收起。</p></div>${switchControl('capture-pref-remote','远程控制兼容')}</div>
    <div class="setting-row"><div class="setting-copy"><h2>自定义截屏</h2><p>设置位置、预设尺寸与延迟。</p></div>${button('capture-pref-custom','设置','settings')}</div>
    <div class="setting-row"><div class="setting-copy"><h2>素材文件夹</h2></div>${button('capture-pref-directory','打开','folder')}</div>
  </div>
  <h3 class="settings-section-title">输出流程</h3><div class="settings-card"><div id="capture-pref-workflows"></div></div>
  <div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>恢复截图设置</h2><p>恢复输出流程、水印、自定义截屏、远程控制和功能缩放的默认值。素材、草稿、贴图及服务密钥会保留。</p></div>${button('capture-pref-reset','恢复默认','refresh')}</div></div>
  <p id="capture-pref-message" class="muted" role="status" aria-live="polite"></p>
</div>`;}

export function setupCaptureSettings(){
  const root=q('capture-pref-workflows'),panel=root.closest<HTMLElement>('.capture-settings')!;
  const scale=selectSource(q('capture-pref-scale'))!,remote=q<HTMLInputElement>('capture-pref-remote');
  let preferences:CapturePreferences|undefined,workflows:ReturnType<typeof mountWorkflowSettings>|undefined;
  let pending:Promise<unknown>=Promise.resolve(),revision=0,active=false;
  let closeCustom:(()=>void)|undefined;
  const message=q('capture-pref-message');
  panel.inert=true;
  const report=(error:unknown)=>{message.textContent=String(error instanceof Error?error.message:error).replace(/^Error invoking remote method '[^']+': Error: /,'');};
  function fill(value:CapturePreferences){
    preferences=value;scale.value=String(value.uiScale);remote.checked=value.remoteCompatible;
    if(workflows)workflows.update(value);
    else workflows=mountWorkflowSettings(root,value,async patch=>{await save({capture:patch});},report);
    panel.inert=false;
  }
  function save(patch:SettingsPatch){
    ++revision;
    // Send immediately; the main process owns serialization, including backup snapshots.
    const task=api.patchSettings(patch).then(value=>{preferences=value.capture;return value;});
    pending=Promise.allSettled([pending,task]);return task;
  }
  async function refresh(){
    const current=++revision;
    await pending.catch(()=>{});
    const settings=await api.settings();
    if(current===revision&&panel.isConnected)fill(settings.capture);
  }
  async function preference(patch:SettingsPatch){
    message.textContent='';
    try{await save(patch);}catch(error){await refresh().catch(report);report(error);}
  }
  scale.onchange=()=>void preference({capture:{uiScale:Number(scale.value) as CapturePreferences['uiScale']}});
  remote.onchange=()=>void preference({capture:{remoteCompatible:remote.checked}});
  q('capture-pref-directory').onclick=()=>void api.materialsOpenDirectory().catch(report);
  q('capture-pref-custom').onclick=()=>void (async()=>{
    const current=revision;
    const state=await api.captureState();
    if(!active||current!==revision||!preferences)return;
    closeCustom=openCustomCapture({patchSettings:save,captureCustom:(...args)=>api.captureCustom(...args)},
      ()=>({screens:state.screens,displayId:state.screens[0]?.id||0,custom:preferences!.custom,uiScale:preferences!.uiScale}),report);
  })().catch(report);
  q('capture-pref-reset').onclick=()=>void (async()=>{
    if(!await confirmDialog({title:'恢复截图设置',message:'恢复输出流程、水印、自定义截屏、远程控制和功能缩放的默认值？素材、草稿、贴图及服务密钥会保留。',confirm:'恢复默认'}))return;
    panel.inert=true;
    try{const settings=await save({capture:defaultCapturePreferences()});fill(settings.capture);message.textContent='已恢复默认设置。';}
    finally{panel.inert=false;}
  })().catch(report);
  void refresh().catch(report);
  return {refresh,activate(value:boolean){active=value;if(value)void refresh().catch(report);else {closeCustom?.();closeCustom=undefined;}}};
}
