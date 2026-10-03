import {api,q,switchControl,toast} from './ui';
import type {ExplorerMenuState} from '../shared/explorer-menu';
import './explorer-menu-settings.css';
export function explorerMenuSettings(){return `<div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2 class="shell-setting-title">系统右键菜单<span class="shell-status-tag" id="shell-status" role="status" hidden></span></h2><p>在资源管理器中选择文件或文件夹，直接打开 One 文件工具。</p></div></div><div class="setting-row"><div class="setting-copy"><h2>文件占用</h2></div>${switchControl('shell-locksmith','系统右键菜单：文件占用')}</div><div class="setting-row"><div class="setting-copy"><h2>批量重命名</h2></div>${switchControl('shell-rename','系统右键菜单：批量重命名')}</div></div>`;}
export function setupExplorerMenuSettings(){
 const controls=['locksmith','rename'].map(k=>q<HTMLInputElement>('shell-'+k));let state:ExplorerMenuState={locksmith:false,rename:false,modern:false};
 const status=(label:string,detail='')=>{const tag=q('shell-status');tag.textContent=label;tag.hidden=!label;tag.title=detail;};
 const fill=(next:ExplorerMenuState)=>{state=next;controls[0].checked=state.locksmith;controls[1].checked=state.rename;status(next.error?'未能启用':next.modern?'Windows 11 已注册':next.locksmith||next.rename?'已注册':'',next.error||'');};
 const busy=(v:boolean)=>controls.forEach(c=>c.disabled=v);let initialized=false;busy(true);
 for(const control of controls)control.onchange=()=>{const value={locksmith:controls[0].checked,rename:controls[1].checked};busy(true);status('正在更新');void api.setExplorerMenu(value).then(fill).catch(error=>{fill(state);toast(error);}).finally(()=>busy(false));};
 return{activate(value:boolean){if(value&&!initialized){initialized=true;busy(true);void api.explorerMenuState().then(fill).catch(error=>{initialized=false;toast(error);}).finally(()=>busy(false));}}};
}
