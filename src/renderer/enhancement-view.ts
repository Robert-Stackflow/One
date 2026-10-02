import {echoPage,setupEcho} from './echo-view';
import {utilitiesPage,setupUtilities} from './utilities-view';
import type { Settings, Edge } from '../shared/types';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
import { defaultSettings } from '../shared/settings';
import { api, q, esc, icon, button, switchControl, action, toast } from './ui';
const edgeNames: [Edge,string][] = [['top','上边缘'],['right','右边缘'],['bottom','下边缘'],['left','左边缘']];
const row = (title: string, description: string, control: string, glyph: string) => `<div class="setting-row"><span class="setting-icon">${icon(glyph)}</span><div class="setting-copy"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${control}</div>`;
export function inputPage() {
  const actions = '<option value="off">关闭</option><option value="desktop">显示桌面</option><option value="tasks">任务视图</option><option value="lock">锁屏</option><option value="one">打开 One</option><option value="start">Windows 开始菜单</option><option value="explorer">文件资源管理器</option><option value="screenshot">屏幕截图</option><option value="color">屏幕取色</option><option value="hotkey">自定义快捷键</option><option value="command">执行命令</option>';
  return `<div class="toolbar module-toolbar"><div class="tabs enhancement-tabs" role="tablist" aria-label="操作增强">${[['edges','边缘'],['echo','按键回显'],['awake','唤醒'],['topmost','始终置顶']].map(([id,name])=>`<button id="enhancement-tab-${id}" data-enhancement-tab="${id}" role="tab" aria-selected="${id==='edges'}" class="${id==='edges'?'selected':''}">${name}</button>`).join('')}</div></div><div data-enhancement-panel="edges"><div class="input-layout"><div class="settings-card edge-card">${row('边缘滚动','屏幕外侧边缘',switchControl('edgeScroll','开启边缘滚动'),'mouse')}
    <div class="edge-config"><div class="monitor-diagram" aria-hidden="true"><div class="monitor-screen"><span>屏幕</span><i class="edge-indicator top" data-edge="top"></i><i class="edge-indicator right" data-edge="right"></i><i class="edge-indicator bottom" data-edge="bottom"></i><i class="edge-indicator left" data-edge="left"></i></div><div class="monitor-stand"></div><div class="diagram-legend"><span><i class="volume-dot"></i>音量</span><span><i class="brightness-dot"></i>亮度</span></div></div>
    <div class="edge-rows">${edgeNames.map(([key,name]) => `<div class="edge-row"><label for="edge-${key}">${name}</label><select id="edge-${key}" aria-label="${name}动作"><option value="off">关闭</option><option value="volume">调节音量</option><option value="brightness">调节亮度</option></select><label class="edge-step"><input type="number" id="edge-step-${key}" aria-label="${name}步长" min="1" max="20"> %</label></div>`).join('')}</div></div>
    <div class="edge-bottom"><label>触发宽度 <input type="number" id="edgePixels" min="2" max="50" aria-label="边缘触发宽度"> 像素</label>${button('check-brightness','检测屏幕亮度','brightness')}</div><div id="brightness-status" class="brightness-status" hidden role="status"></div></div>
    <div class="settings-card">${row('边缘角触发','在角落停留后执行动作。','','expand')}<div class="corner-grid">${(['TL','TR','BL','BR'] as const).map((id,index) => `<div class="corner-item"><label>${['左上角','右上角','左下角','右下角'][index]}<select id="corner-${id}" aria-label="${['左上角','右上角','左下角','右下角'][index]}动作">${actions}</select></label><div class="corner-binding" id="binding-${id}" hidden><label class="binding-hotkey">快捷键<input id="shortcut-${id}" placeholder="Ctrl+Shift+S" aria-label="${id} 快捷键"></label><div class="binding-command"><label>程序<input id="command-${id}" placeholder="notepad.exe" aria-label="${id} 程序"></label><label>参数<input id="args-${id}" placeholder='["D:\\\\notes.txt"]' aria-label="${id} 参数"></label><label>工作目录<input id="cwd-${id}" placeholder="可选" aria-label="${id} 工作目录"></label><small>参数使用 JSON 数组，例如 ["/c", "命令"]。</small></div></div></div>`).join('')}</div><div class="sub-options corner-timing"><label>停留 <input type="number" id="dwellMs" min="150" max="5000"> 毫秒</label><label>热区 <input type="number" id="cornerPixels" min="2" max="100"> 像素</label><label>冷却 <input type="number" id="cooldownMs" min="200" max="10000"> 毫秒</label></div></div>
    <div class="settings-card">${row('全屏时暂停','',switchControl('pauseFullscreen','全屏时暂停'),'expand')}<div class="setting-row"><div class="setting-copy"><h2>排除应用</h2><p>程序名，用逗号分隔。</p></div><input id="excludedApps" aria-label="排除应用" placeholder="game.exe, app.exe" maxlength="2000"></div></div></div>
    <div class="settings-footer"><span id="input-status" role="status"></span></div></div>${echoPage()}${utilitiesPage()}`;
}
export function setupInput() {
  setupEcho();setupUtilities();document.querySelectorAll<HTMLButtonElement>('[data-enhancement-tab]').forEach(b=>b.onclick=()=>{const id=b.dataset.enhancementTab;document.querySelectorAll<HTMLElement>('[data-enhancement-panel]').forEach(p=>p.hidden=p.dataset.enhancementPanel!==id);document.querySelectorAll<HTMLElement>('[data-enhancement-tab]').forEach(t=>{t.classList.toggle('selected',t===b);t.setAttribute('aria-selected',String(t===b));});});
  let settings = defaultSettings();
  for(const id of ['TL','TR','BL','BR'])setupShortcut(q<HTMLInputElement>('shortcut-'+id));
  const diagram = () => { for (const [key] of edgeNames) { const action = q<HTMLSelectElement>('edge-'+key).value; document.querySelector(`[data-edge=${key}]`)!.setAttribute('data-action',action); q<HTMLInputElement>('edge-step-'+key).disabled = action === 'off'; } };
  const cornerFields=()=>{for(const id of ['TL','TR','BL','BR']){const action=q<HTMLSelectElement>('corner-'+id).value;const panel=q('binding-'+id);panel.hidden=!['hotkey','command'].includes(action);(panel.querySelector('.binding-hotkey') as HTMLElement).hidden=action!=='hotkey';(panel.querySelector('.binding-command') as HTMLElement).hidden=action!=='command';}};
  const fill = () => {
    for (const [key,value] of Object.entries(settings)) {
      if (key === 'corners') for (const [id,action] of Object.entries(settings.corners)) q<HTMLSelectElement>('corner-'+id).value = action;
      else if (key === 'edges') for (const [id,edge] of Object.entries(settings.edges)) { q<HTMLSelectElement>('edge-'+id).value = edge.action; q<HTMLInputElement>('edge-step-'+id).value = String(edge.step); }
      else { const control = q<HTMLInputElement>(key); if (!control) continue; if (typeof value === 'boolean') control.checked = value; else control.value = String(value); }
    }
    diagram(); for(const [id,b] of Object.entries(settings.cornerBindings)){q<HTMLInputElement>('shortcut-'+id).value=b.shortcut;q<HTMLInputElement>('command-'+id).value=b.command;q<HTMLInputElement>('args-'+id).value=JSON.stringify(b.args);q<HTMLInputElement>('cwd-'+id).value=b.cwd;}cornerFields();
  };
  const status = async () => { const state = await api.inputStatus(); q('input-status').textContent = state.error ? state.error : state.hook ? '' : ''; };
  void api.settings().then(value => { settings = value; fill(); return status(); }).catch(toast);
  const root=q('page-input');
  for(const key of ['edgeScroll','pauseFullscreen','excludedApps','dwellMs','cornerPixels','cooldownMs','edgePixels'] as const){const control=q<HTMLInputElement>(key);bindPreference(control,()=>({[key]:control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value}),async()=>{settings=await api.settings();const value=settings[key];if(typeof value==='boolean')control.checked=value;else control.value=String(value);});}
  for(const [edge] of edgeNames){q('edge-'+edge).addEventListener('change',diagram);for(const field of ['edge-'+edge,'edge-step-'+edge])bindPreference(q(field),()=>({edges:{[edge]:{action:q<HTMLSelectElement>('edge-'+edge).value as Settings['edges']['top']['action'],step:Number(q<HTMLInputElement>('edge-step-'+edge).value)}}}));}
  for(const id of ['TL','TR','BL','BR'] as const){
    const commit=()=>{cornerFields();const kind=q<HTMLSelectElement>('corner-'+id).value as Settings['corners']['TL'];let args:string[];try{args=JSON.parse(q<HTMLInputElement>('args-'+id).value||'[]');}catch{return;}
      const binding={shortcut:q<HTMLInputElement>('shortcut-'+id).value.trim(),command:q<HTMLInputElement>('command-'+id).value.trim(),cwd:q<HTMLInputElement>('cwd-'+id).value.trim(),args};
      if(kind==='command'&&!binding.command||kind==='hotkey'&&!binding.shortcut){q('binding-'+id).dataset.pending='true';return;}delete q('binding-'+id).dataset.pending;
      void api.patchSettings({corners:{[id]:kind},cornerBindings:{[id]:binding}}).catch(toast);
    };
    let timer:ReturnType<typeof setTimeout>;
    for(const prefix of ['corner-','shortcut-','command-','args-','cwd-']){const control=q(prefix+id);control.addEventListener('change',()=>{clearTimeout(timer);commit();});if(prefix!=='corner-'&&prefix!=='shortcut-')control.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(commit,350);});}
  }
  action('check-brightness',async () => { const button = q<HTMLButtonElement>('check-brightness'); button.disabled = true; q('brightness-status').hidden = false; q('brightness-status').textContent = '正在读取显示器接口…'; try { const displays = await api.brightnessStatus(); q('brightness-status').innerHTML = displays.map(d => `<div><span class="support-dot ${d.supported ? 'available' : ''}"></span><strong>${esc(d.name)}</strong><span>${d.supported ? `${d.brightness}%` : esc(d.error || '不支持亮度调节')}</span></div>`).join(''); } finally { button.disabled = false; } });
}
