import {api,q,icon,switchControl,toast} from './ui';
import {bindPreference} from './preferences';
const entries=[
 ['volume','快速音量调节','按住 Alt 滚动滚轮调节音量，Alt＋按下滚轮切换静音。','volume'],
 ['copy','快速复制','选中或双击文字后自动复制；按住 Ctrl 临时跳过。','copy'],
 ['paste','快速粘贴','按住鼠标左键，再点右键粘贴。','clipboard'],
 ['move','快速移动窗口','按住 Alt 和鼠标滚轮拖动，在窗口任意位置移动。','move'],
 ['naturalScroll','自然滚动','反转滚轮方向，采用与 macOS 相同的滚动方式。','mouse']
] as const;
export function quickActionsPage(){return `<div data-enhancement-panel="quick"><div class="settings-card">${entries.map(([key,title,description,glyph])=>`<div class="setting-row"><span class="setting-icon">${icon(glyph)}</span><div class="setting-copy"><h2>${title}</h2><p>${description}</p></div>${switchControl('quick-'+key,title)}</div>${key==='volume'?'<div id="quick-volume-step-row" class="preference-row" hidden><label for="quick-volume-step">音量步长</label><div class="field-group"><input id="quick-volume-step" type="number" min="1" max="20" aria-label="快捷音量步长"><span>%</span></div></div>':''}`).join('')}</div></div>`;}
export function setupQuickActions(){
 const volume=q<HTMLInputElement>('quick-volume'),stepRow=q('quick-volume-step-row');
 const showStep=()=>stepRow.hidden=!volume.checked;
 const load=async()=>{const s=(await api.settings()).quickActions;for(const [key] of entries)q<HTMLInputElement>('quick-'+key).checked=s[key];q<HTMLInputElement>('quick-volume-step').value=String(s.volumeStep);showStep();};
 void load().catch(toast);
 for(const [key] of entries)bindPreference(q('quick-'+key),()=>({quickActions:{[key]:q<HTMLInputElement>('quick-'+key).checked}}),load);
 volume.addEventListener('change',showStep);
 bindPreference(q('quick-volume-step'),()=>({quickActions:{volumeStep:Number(q<HTMLInputElement>('quick-volume-step').value)}}),load);
}
