import type {Appearance} from '../shared/types';
import {defaultAppearance} from '../shared/settings';
import {fontStack} from '../shared/fonts';
import {loadUIFont} from './font-runtime';
import {setupFontPicker} from './font-picker';
import {api,q,button,icon,toast} from './ui';
let current=defaultAppearance();
let fontRevision=0;
let appliedFont='';
const system=matchMedia('(prefers-color-scheme: dark)');
export function applyAppearance(value:Appearance){
  current=value;const dark=value.mode==='dark'||value.mode==='system'&&system.matches;const root=document.documentElement;
  root.dataset.theme=dark?'dark':'light';root.dataset.density=value.density;root.dataset.toastPosition=value.toastPosition||'bottom-center';
  root.style.setProperty('--surface',dark?value.darkBackground:value.lightBackground);root.style.setProperty('--fg',dark?value.darkForeground:value.lightForeground);
  const accent=dark&&value.accent==='#303030'?'#e4e4e4':value.accent;root.style.setProperty('--accent',accent);
  const rgb=accent.slice(1).match(/../g)!.map(x=>parseInt(x,16));root.style.setProperty('--on-accent',rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>155?'#141414':'#ffffff');
  root.style.setProperty('--radius',value.radius+'px');if(appliedFont!==value.font){root.style.setProperty('--ui-font',fontStack(value.font));appliedFont=value.font;}
  const revision=++fontRevision;root.dataset.fontStatus='loading';
  void loadUIFont(value.font,true).then(stack=>{if(revision!==fontRevision)return;root.style.setProperty('--ui-font',stack);root.dataset.fontStatus='ready';}).catch(()=>{if(revision===fontRevision){root.dataset.fontStatus='error';toast('字体加载失败，请刷新字体列表后重试。');}});
}
export function setupAppearance(){void api.appearance().then(applyAppearance).catch(()=>{});api.onAppearance(applyAppearance);system.addEventListener('change',()=>applyAppearance(current));}
export function appearancePage(){return `<div class="appearance-page"><div class="settings-card"><div class="appearance-row"><strong>模式</strong><div class="theme-modes">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([id,name])=>`<button class="theme-choice" data-mode="${id}" aria-label="${name}" aria-pressed="false"><span class="theme-mini ${id}"><i></i><b></b><em></em></span><span>${name}</span></button>`).join('')}</div></div></div><div class="settings-card"><div class="appearance-row"><strong>强调色</strong><div class="swatch-list">${['#303030','#4479d8','#6d61bd','#41886c','#b67838','#b55875'].map(color=>`<button class="accent-swatch" data-color="${color}" style="--swatch:${color}" aria-label="强调色 ${color}"></button>`).join('')}</div><span class="color-field"><i aria-hidden="true"></i><input id="appearance-accent" aria-label="自定义强调色" maxlength="7" spellcheck="false"></span></div><div class="appearance-row"><strong>背景</strong><span class="color-field"><i aria-hidden="true"></i><input id="appearance-bg" aria-label="背景颜色" maxlength="7" spellcheck="false"></span></div><div class="appearance-row"><strong>前景</strong><span class="color-field"><i aria-hidden="true"></i><input id="appearance-fg" aria-label="前景颜色" maxlength="7" spellcheck="false"></span></div><div class="appearance-row"><strong>字体</strong><button type="button" id="appearance-font" class="custom-select" role="combobox" aria-label="界面字体" aria-haspopup="listbox" aria-expanded="false"><span>系统默认</span>${icon('chevron-down')}</button></div><div class="appearance-row"><strong>间距</strong><select id="appearance-density" aria-label="界面间距"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></div><div class="appearance-row"><strong>提示位置</strong><select id="appearance-toastPosition" aria-label="提示位置"><option value="top-center">顶部中间</option><option value="top-right">顶部右侧</option><option value="top-left">顶部左侧</option><option value="bottom-center">底部中间</option><option value="bottom-right">底部右侧</option><option value="bottom-left">底部左侧</option></select></div><div class="appearance-row"><strong>圆角</strong><input type="range" id="appearance-radius" aria-label="界面圆角" min="4" max="16"><output id="radius-value"></output></div></div><div class="appearance-actions">${button('appearance-reset','恢复默认')}</div></div>`;}
export function setupAppearancePage(){
  setupFontPicker(q<HTMLButtonElement>('appearance-font'));
  let value=defaultAppearance();
  const dark=()=>value.mode==='dark'||value.mode==='system'&&system.matches;
  const fill=()=>{document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===value.mode)));q<HTMLInputElement>('appearance-accent').value=value.accent;q<HTMLInputElement>('appearance-bg').value=dark()?value.darkBackground:value.lightBackground;q<HTMLInputElement>('appearance-fg').value=dark()?value.darkForeground:value.lightForeground;q<HTMLSelectElement>('appearance-font').value=value.font;q<HTMLSelectElement>('appearance-density').value=value.density;q<HTMLInputElement>('appearance-radius').value=String(value.radius);q('radius-value').textContent=value.radius+' px';q<HTMLSelectElement>('appearance-toastPosition').value=value.toastPosition;for(const key of ['accent','bg','fg']){const input=q<HTMLInputElement>('appearance-'+key);input.parentElement!.style.setProperty('--swatch',input.value);}};
  void api.appearance().then(a=>{value=a;fill();});
  const persist=(patch:Partial<Appearance>)=>{void api.patchSettings({appearance:patch}).catch(async error=>{value=await api.appearance();fill();applyAppearance(value);toast(error);});};
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.onclick=()=>{value.mode=b.dataset.mode as Appearance['mode'];fill();applyAppearance(value);persist({mode:value.mode});});
  document.querySelectorAll<HTMLElement>('[data-color]').forEach(b=>b.onclick=()=>{value.accent=b.dataset.color!;fill();applyAppearance(value);persist({accent:value.accent});});
  for(const key of ['accent','bg','fg','font','density','radius','toastPosition'])q('appearance-'+key).addEventListener('change',()=>{const raw=q<HTMLInputElement>('appearance-'+key).value;if(['accent','bg','fg'].includes(key)&&!/^#[a-f0-9]{6}$/i.test(raw)){toast('请输入 #RRGGBB 格式颜色');return;}if(key==='bg')value[dark()?'darkBackground':'lightBackground']=raw;else if(key==='fg')value[dark()?'darkForeground':'lightForeground']=raw;else (value as any)[key]=key==='radius'?Number(raw):raw;applyAppearance(value);fill();const property=key==='bg'?(dark()?'darkBackground':'lightBackground'):key==='fg'?(dark()?'darkForeground':'lightForeground'):key;persist({[property]:(value as any)[property]});});
  q('appearance-reset').onclick=()=>{value=defaultAppearance();fill();applyAppearance(value);persist(value);};
}
