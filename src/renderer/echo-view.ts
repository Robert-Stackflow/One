import {api,q,button,icon,switchControl,toast} from './ui';
import {bindPreference} from './preferences';
import {updateSelectOptions} from './controls';
import {echoNames,type EchoChannel,type EchoSettings,defaultEcho} from '../shared/echo';
import './hud.css';
import './echo.css';

export function echoPage(){return `<div data-enhancement-panel="echo" hidden>
 <div class="settings-card echo-master"><div class="setting-row"><div class="setting-copy"><h2>按键与状态提示</h2></div>${switchControl('keyEcho','开启按键回显')}</div><div class="echo-shared-position"><label for="echo-display">提示位置</label><select id="echo-display" aria-label="提示显示器"><option value="cursor">跟随鼠标所在屏幕</option></select>${button('echo-position-live','拖动调整位置','move')}</div></div>
 <div class="echo-layout"><div class="echo-channels" role="tablist" aria-label="提示类型">${Object.entries(echoNames).map(([id,name])=>`<div class="echo-channel"><button class="quiet" role="tab" aria-selected="${id==='keys'}" data-echo-channel="${id}">${icon(id==='keys'?'keyboard':id==='ime'?'text':'toggle')}<span>${name}</span></button>${switchControl('echo-enable-'+id,'显示'+name)}</div>`).join('')}</div>
 <div class="echo-config"><div class="echo-preview" aria-label="提示样式预览"><div id="echo-marker">Ctrl + Shift + A</div></div><div class="echo-config-fields"><div class="preference-row"><label for="echo-duration">显示时长</label><div class="field-group"><input id="echo-duration" type="number" min="300" max="10000" step="100" aria-label="回显显示时长"><span>毫秒</span></div></div><div class="preference-row" id="echo-combinations-row"><label><input id="onlyCombinations" type="checkbox">仅显示组合键</label></div></div>
 <div id="echo-caps-options" hidden><div class="preference-row"><div class="setting-copy"><h2>大写锁定提示</h2><p>开启大写锁定时持续显示，关闭后自动消失。</p></div>${switchControl('caps-persistent','持续显示大写锁定提示')}</div><div class="preference-row"><div class="setting-copy"><h2>自动关闭大写锁定</h2><p>到达指定时间后恢复小写输入。</p></div>${switchControl('caps-auto-off','自动关闭大写锁定')}</div><div class="preference-row"><label for="caps-seconds">等待时间</label><div class="field-group"><input id="caps-seconds" type="number" min="1" max="3600" aria-label="自动关闭大写锁定秒数"><span>秒</span></div></div></div></div></div>
 </div>`;}
export function setupEcho(){
 let settings:EchoSettings=defaultEcho(),channel:EchoChannel='keys';
 const draw=()=>{
  for(const key of Object.keys(echoNames) as EchoChannel[])q<HTMLInputElement>('echo-enable-'+key).checked=settings[key].enabled;
  document.querySelectorAll<HTMLElement>('[data-echo-channel]').forEach(b=>{const active=b.dataset.echoChannel===channel;b.setAttribute('aria-selected',String(active));b.closest('.echo-channel')!.classList.toggle('selected',active);});
  q<HTMLInputElement>('echo-duration').value=String(settings[channel].duration);q<HTMLSelectElement>('echo-display').value=settings.keys.display;q('echo-combinations-row').hidden=channel!=='keys';q('echo-caps-options').hidden=channel!=='caps';
  q('echo-marker').textContent=channel==='keys'?'Ctrl + Shift + A':channel==='ime'?'中 · 中文输入法':echoNames[channel]+' · 开启';
 };
 const load=async()=>{const s=await api.settings();settings=s.echo;q<HTMLInputElement>('caps-persistent').checked=s.capsLock.persistent;q<HTMLInputElement>('caps-auto-off').checked=s.capsLock.autoOff;q<HTMLInputElement>('caps-seconds').value=String(s.capsLock.seconds);q<HTMLInputElement>('caps-seconds').disabled=!s.capsLock.autoOff;q<HTMLInputElement>('keyEcho').checked=s.keyEcho;q<HTMLInputElement>('onlyCombinations').checked=s.onlyCombinations;draw();};
 void api.echoDisplays().then(displays=>{updateSelectOptions(q('echo-display'),[{label:'跟随鼠标所在屏幕',value:'cursor'},...displays.map(d=>({value:d.id,label:d.name}))]);return load();}).catch(toast);api.onEchoPosition(()=>void load().catch(toast));
 for(const key of Object.keys(echoNames) as EchoChannel[])bindPreference(q('echo-enable-'+key),()=>{settings[key].enabled=q<HTMLInputElement>('echo-enable-'+key).checked;return {echo:{[key]:{enabled:settings[key].enabled}}};},load);
 for(const id of ['keyEcho','onlyCombinations'] as const)bindPreference(q(id),()=>({[id]:q<HTMLInputElement>(id).checked}),load);
 document.querySelectorAll<HTMLButtonElement>('[data-echo-channel]').forEach(b=>b.onclick=()=>{channel=b.dataset.echoChannel as EchoChannel;draw();});
 bindPreference(q('echo-display'),()=>{settings.keys.display=q<HTMLSelectElement>('echo-display').value;return {echo:{keys:{display:settings.keys.display}}};},load);
 bindPreference(q('echo-duration'),()=>{settings[channel].duration=Number(q<HTMLInputElement>('echo-duration').value);return {echo:{[channel]:{duration:settings[channel].duration}}};},load);
 for(const [id,key] of [['caps-persistent','persistent'],['caps-auto-off','autoOff']] as const)bindPreference(q(id),()=>{if(key==='autoOff')q<HTMLInputElement>('caps-seconds').disabled=!q<HTMLInputElement>(id).checked;return {capsLock:{[key]:q<HTMLInputElement>(id).checked}};},load);
 bindPreference(q('caps-seconds'),()=>({capsLock:{seconds:Number(q<HTMLInputElement>('caps-seconds').value)}}),load);
 q('echo-position-live').onclick=()=>void api.positionEcho().catch(toast);
}
