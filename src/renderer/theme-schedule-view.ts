import {api,button,errorMessage,q,switchControl} from './ui';
import {customControls} from './controls';
import {setupShortcut} from './shortcut';
import {timePickerMarkup,setupTimePicker} from './time-picker';
import {validateThemeSchedule,type ThemeSchedulePreferences,type ThemeAutomationStatus} from '../shared/theme-schedule';
import './theme-schedule.css';
import {solarSchedulePreview} from '../shared/theme-solar-preview';

const row=(title:string,description:string,control:string,source='')=>`<div class="setting-row"${source?` data-theme-source="${source}"`:''}><div class="setting-copy"><h2>${title}</h2><p>${description}</p></div>${control}</div>`;
export function themeSchedulePage(){return `<div class="theme-schedule" id="theme-schedule">
 <div class="settings-card theme-current"><div class="theme-state-heading"><h3>当前状态</h3><span id="theme-phase" class="theme-phase">正在读取</span></div><p id="theme-status" role="status" aria-live="polite">正在读取主题状态…</p><p id="theme-next" class="muted" hidden></p><p id="theme-error" role="alert" hidden></p><div class="theme-actions">${button('theme-light','切换浅色')}${button('theme-dark','切换深色')}${button('theme-resume','恢复计划')}${button('theme-sync','刷新状态')}</div></div>
 <fieldset id="theme-fields" disabled><div class="settings-card"><h3 class="theme-section-title">切换计划</h3>
 ${row('自动切换','修改后自动生效；关闭后保留当前 Windows 主题。',switchControl('theme-enabled','启用自动主题切换'))}
 ${row('切换依据','手动切换会保持到下一次计划切换。',`<select id="theme-source" aria-label="主题切换依据"><option value="fixed">固定时间</option><option value="sun">日出日落</option><option value="night-light">Windows 夜间模式</option></select>`)}
 ${row('切换时间','按当前系统时区使用当地时间。',`<div class="theme-pair"><label>浅色${timePickerMarkup('theme-lightAt','浅色切换时间','07:00')}</label><label>深色${timePickerMarkup('theme-darkAt','深色切换时间','19:00')}</label></div>`,'fixed')}
 <div class="setting-row theme-location-row" data-theme-source="sun"><div class="theme-location-heading"><div class="setting-copy"><h2>所在位置</h2><p>进入日出日落模式时自动定位；无法获取时可手动填写。</p></div>${button('theme-locate','获取当前位置')}</div><p id="theme-location-status" role="status" aria-live="polite"></p><div class="theme-coordinate-grid"><label>纬度<input type="number" id="theme-latitude" min="-90" max="90" step="any" placeholder="-90 至 90" aria-label="纬度"></label><label>经度<input type="number" id="theme-longitude" min="-180" max="180" step="any" placeholder="-180 至 180" aria-label="经度"></label></div><div class="theme-solar-preview" id="theme-solar-preview" role="status" aria-live="polite"></div></div>
 ${row('时间偏移','分钟；负数提前，正数延后，最多前后 180 分钟。',`<div class="theme-pair"><label>日出<input type="number" id="theme-sunriseOffset" min="-180" max="180" step="1"></label><label>日落<input type="number" id="theme-sunsetOffset" min="-180" max="180" step="1"></label></div>`,'sun')}
 ${row('夜间模式','夜间模式开启时用深色，关闭时用浅色。无法读取时保留主题，并显示原因。','<span class="muted">跟随 Windows 当前状态</span>','night-light')}
 </div><div class="settings-card"><h3 class="theme-section-title">应用范围与快捷键</h3>
 ${row('应用范围','在“外观”页选择 One 模式会退出 One 的自动管理，其余范围继续生效。',`<div class="theme-targets"><label><input type="checkbox" id="theme-one">One</label><label><input type="checkbox" id="theme-windowsApps">Windows 应用</label><label><input type="checkbox" id="theme-windowsSystem">系统界面</label></div>`)}
 ${row('切换快捷键','切换所选范围的深浅色；自动切换关闭时也可使用。','<div class="theme-shortcut"><input id="theme-shortcut" aria-label="主题切换快捷键"></div>')}
 </div></fieldset></div>`;}

let panelActive=false,activatePanel:()=>void=()=>{};
export function setThemeScheduleActive(active:boolean){panelActive=active;activatePanel();}
export function setupThemeSchedule(){
 const root=q('theme-schedule');customControls(root);
 const fields=q<HTMLFieldSetElement>('theme-fields'),source=q<HTMLSelectElement>('theme-source'),shortcut=q<HTMLInputElement>('theme-shortcut');
 for(const id of ['theme-lightAt','theme-darkAt'])setupTimePicker(q<HTMLButtonElement>(id));
 let preferences:ThemeSchedulePreferences|undefined,revision=0,busy=false,timer:ReturnType<typeof setTimeout>|undefined,saving:Promise<void>|undefined;
 const changes=new Map<string,number>(),notice=q('theme-error');
 const locateButton=q<HTMLButtonElement>('theme-locate'),locationNotice=q('theme-location-status');
 let locationRevision=0,locating=false,autoLocated=false;
 const cancelLocation=()=>{locationRevision++;if(locating){locating=false;locateButton.disabled=false;locateButton.textContent='获取当前位置';locationNotice.textContent='';void api.themeLocationCancel().catch(()=>{});}};
 const locate=async()=>{
  if(locating||source.value!=='sun')return;
  const request=++locationRevision;locating=true;autoLocated=true;locateButton.disabled=true;locateButton.textContent='定位中…';locationNotice.textContent='正在获取位置，请在 Windows 提示中允许定位。';
  try{
   const result=await api.themeLocate();if(request!==locationRevision||source.value!=='sun'||!panelActive||!root.checkVisibility())return;
   if(result.state==='success'){
    input('latitude').value=String(Number(result.latitude.toFixed(6)));input('longitude').value=String(Number(result.longitude.toFixed(6)));
    changes.set('latitude',++revision);changes.set('longitude',++revision);
    locationNotice.textContent='已获取当前位置';preview();await flush();
   }else locationNotice.textContent=result.detail;
  }catch(reason){if(request===locationRevision)locationNotice.textContent=errorMessage(reason);}
  finally{if(request===locationRevision){locating=false;locateButton.disabled=false;locateButton.textContent='获取当前位置';}}
 };
 activatePanel=()=>{if(!panelActive)cancelLocation();else if(preferences&&source.value==='sun'&&!autoLocated)void locate();};
 locateButton.onclick=()=>void locate();
 const error=(value:unknown)=>{notice.textContent=errorMessage(value);notice.hidden=!value;};
 const input=(key:string)=>q<HTMLInputElement>('theme-'+key);
 const sources=()=>{
  if(source.value!=='sun')cancelLocation();
  root.querySelectorAll<HTMLElement>('[data-theme-source]').forEach(node=>node.hidden=node.dataset.themeSource!==source.value);
  for(const card of root.querySelectorAll('.settings-card')){
   const rows=[...card.querySelectorAll<HTMLElement>(':scope > .setting-row')],visible=rows.filter(row=>!row.hidden);
   rows.forEach(row=>row.classList.toggle('theme-last-row',row===visible.at(-1)));
  }
 };
 const fill=(p:ThemeSchedulePreferences)=>{
  if(!changes.has('enabled'))input('enabled').checked=p.enabled;if(!changes.has('source')){if(source.value!==p.source)autoLocated=false;source.value=p.source;}
  for(const key of ['lightAt','darkAt','latitude','longitude','sunriseOffset','sunsetOffset'] as const)if(!changes.has(key))input(key).value=p[key]===null?'':String(p[key]);
  for(const key of ['one','windowsApps','windowsSystem'] as const)if(!changes.has(key))input(key).checked=p.targets[key];
  if(!changes.has('shortcut'))shortcut.value=p.shortcut;sources();
 };
 const shortcutControl=setupShortcut(shortcut,error,{onRetry:()=>void run(()=>api.themeShortcutRetry())});
 const status=(value:ThemeAutomationStatus)=>{
  preferences=value.preferences;fill(value.preferences);
  q('theme-status').textContent=value.detail+(value.mode?` · ${value.mode==='dark'?'深色':'浅色'}`:'');
  const next=q('theme-next');next.hidden=!value.next;next.textContent=value.next?`下次切换：${new Date(value.next.at).toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${value.next.mode==='dark'?'深色':'浅色'}`:'';
  const phase=q('theme-phase');phase.textContent=({off:'已关闭',automatic:'自动运行',unavailable:'暂不可用',manual:'手动保持',error:'切换失败'})[value.phase];phase.dataset.phase=value.phase;
  shortcutControl.setStatus({active:shortcut.value===value.preferences.shortcut&&value.shortcutActive,error:shortcut.value===value.preferences.shortcut?value.shortcutError:''});
  fields.disabled=false;preview();activatePanel();
 };
 const read=()=>{
  const number=(key:string)=>input(key).value.trim()===''?null:Number(input(key).value);
  return {enabled:input('enabled').checked,source:source.value,lightAt:input('lightAt').value,darkAt:input('darkAt').value,latitude:number('latitude'),longitude:number('longitude'),sunriseOffset:number('sunriseOffset'),sunsetOffset:number('sunsetOffset'),one:input('one').checked,windowsApps:input('windowsApps').checked,windowsSystem:input('windowsSystem').checked,shortcut:shortcut.value};
 };
 const preview=()=>{
  const output=q('theme-solar-preview');
  if(source.value!=='sun'){output.replaceChildren();return;}
  const p=read(),now=new Date(),time=(stamp:number|undefined)=>stamp===undefined?'当日无此事件':new Date(stamp).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false});
  const adjusted=(stamp:number|undefined)=>stamp===undefined?'—':(new Date(stamp).toDateString()===now.toDateString()?'':new Date(stamp).toLocaleDateString(undefined,{month:'numeric',day:'numeric'})+' ')+time(stamp);
  try{
   const day=solarSchedulePreview(p.latitude,p.longitude,p.sunriseOffset!,p.sunsetOffset!,now);
   if(!day){output.textContent='填写完整经纬度后显示今日预估时间。';return;}
   const heading=document.createElement('p');heading.className='theme-solar-caption';heading.textContent='今日预估 · '+now.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})+' · 系统时区';
   const grid=document.createElement('div');grid.className='theme-solar-grid';
   for(const [label,value,detail] of [['日出',time(day.sunrise),'切换浅色 '+adjusted(day.lightAt)],['日落',time(day.sunset),'切换深色 '+adjusted(day.darkAt)]]){const card=document.createElement('div'),title=document.createElement('span'),strong=document.createElement('strong'),note=document.createElement('span');title.textContent=label;strong.textContent=value;note.textContent=detail;card.append(title,strong,note);grid.append(card);}
   output.replaceChildren(heading,grid);if(day.kind!=='normal'){const note=document.createElement('p');note.textContent=day.kind==='polar-day'?'当地处于极昼，今日没有日出日落切换。':'当地处于极夜，今日没有日出日落切换。';output.append(note);}
  }catch{output.textContent='请填写有效经纬度和时间偏移，以计算预估时间。';}
 };
 const persist=async()=>{
  const p=read(),snapshot=new Map(changes),patch:Record<string,unknown>={},accepted=new Set<string>();let invalid:unknown,base=preferences!;
  // Always allow stopping automation, even while another field is incomplete.
  if(snapshot.has('enabled')&&!p.enabled){await api.patchSettings({themeSchedule:{enabled:false}});if(changes.get('enabled')===snapshot.get('enabled'))changes.delete('enabled');snapshot.delete('enabled');status(await api.themeStatus());base=preferences!;}
  const groups=[['latitude','longitude'],['lightAt','darkAt'],['one','windowsApps','windowsSystem'],['enabled'],['source'],['sunriseOffset'],['sunsetOffset'],['shortcut']];
  for(const group of groups){
   if(!group.some(key=>snapshot.has(key)))continue;
   const values=Object.fromEntries(group.map(key=>[key,p[key as keyof typeof p]])),delta=group.includes('one')?{targets:values}:values;
   try{base=validateThemeSchedule({...base,...delta});Object.assign(patch,delta);group.filter(key=>snapshot.has(key)).forEach(key=>accepted.add(key));}catch(reason){invalid??=reason;}
  }
  if(accepted.size){
   await api.patchSettings({themeSchedule:patch});
   for(const key of accepted)if(changes.get(key)===snapshot.get(key))changes.delete(key);
   status(await api.themeStatus());
  }
  if(invalid)throw invalid;error('');
 };
 const flush=async():Promise<void>=>{
  clearTimeout(timer);while(saving)await saving;
  if(!changes.size)return;
  const task=persist();saving=task;root.setAttribute('aria-busy','true');
  try{await task;}finally{if(saving===task)saving=undefined;root.setAttribute('aria-busy',String(busy));}
  if(changes.size)await flush();
 };
 const schedule=(event:Event)=>{
  const target=event.target as HTMLElement;if(!target.closest('fieldset')||!target.id.startsWith('theme-'))return;
  if(['theme-latitude','theme-longitude'].includes(target.id)){cancelLocation();locationNotice.textContent='使用手动填写的位置';}
  if(target.id==='theme-source'){cancelLocation();autoLocated=false;if(source.value==='sun'&&panelActive)void locate();}
  changes.set(target.id.slice(6),++revision);error('');sources();preview();clearTimeout(timer);
  const delay=event.type==='input'||['theme-lightAt','theme-darkAt','theme-latitude','theme-longitude','theme-sunriseOffset','theme-sunsetOffset'].includes(target.id)?350:0;
  timer=setTimeout(()=>void flush().catch(error),delay);
 };
 const actions=['theme-light','theme-dark','theme-resume','theme-sync'].map(id=>q(id) as HTMLButtonElement);
 const run=async(work:()=>Promise<ThemeAutomationStatus>)=>{
  if(busy)return;busy=true;root.setAttribute('aria-busy','true');actions.forEach(action=>{action.disabled=true;});error('');
  try{await flush();status(await work());}catch(reason){error(reason);}finally{busy=false;actions.forEach(action=>{action.disabled=false;});root.setAttribute('aria-busy',String(!!saving));}
 };
 window.addEventListener('focus',()=>{if(panelActive&&preferences)preview();});
 setInterval(()=>{if(panelActive&&preferences&&root.checkVisibility())preview();},60000);
 root.addEventListener('change',schedule);root.addEventListener('input',schedule);
 for(const mode of ['light','dark'] as const)q('theme-'+mode).onclick=()=>void run(()=>api.themeManual(mode));
 q('theme-resume').onclick=()=>void run(()=>api.themeResume());q('theme-sync').onclick=()=>void run(()=>preferences?api.themeSync():api.themeStatus());
 api.onThemeStatus(status);void run(()=>api.themeStatus());
}
