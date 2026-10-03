import {api,q,switchControl,toast} from './ui';
import type {ExplorerMenuState} from '../shared/explorer-menu';
export function explorerMenuSettings(){return `<div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>系统右键菜单</h2><p>在资源管理器中选择文件或文件夹，直接打开 One 文件工具。</p></div></div><div class="setting-row"><div class="setting-copy"><h2>文件占用</h2></div>${switchControl('shell-locksmith','系统右键菜单：文件占用')}</div><div class="setting-row"><div class="setting-copy"><h2>批量重命名</h2></div>${switchControl('shell-rename','系统右键菜单：批量重命名')}</div><p class="footnote" id="shell-status" role="status"></p></div>`;}
export function setupExplorerMenuSettings(){
 const controls=['locksmith','rename'].map(k=>q<HTMLInputElement>('shell-'+k));let state:ExplorerMenuState={locksmith:false,rename:false,modern:false};
 const fill=(next:ExplorerMenuState)=>{state=next;controls[0].checked=state.locksmith;controls[1].checked=state.rename;q('shell-status').textContent=next.error?'未能启用系统菜单：'+next.error:next.modern?'已接入 Windows 11 右键菜单':next.locksmith||next.rename?'已接入系统右键菜单':'';};
 const busy=(v:boolean)=>controls.forEach(c=>c.disabled=v);let initialized=false;busy(true);
 for(const control of controls)control.onchange=()=>{const value={locksmith:controls[0].checked,rename:controls[1].checked};busy(true);q('shell-status').textContent='正在更新系统菜单…';void api.setExplorerMenu(value).then(fill).catch(error=>{fill(state);toast(error);}).finally(()=>busy(false));};
 return{activate(value:boolean){if(value&&!initialized){initialized=true;busy(true);void api.explorerMenuState().then(fill).catch(error=>{initialized=false;toast(error);}).finally(()=>busy(false));}}};
}
