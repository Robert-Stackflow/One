import {api,q,switchControl,toast} from './ui';
import type {ExplorerMenuState} from '../shared/explorer-menu';
import './explorer-menu-settings.css';
export function explorerMenuSettings(){return `<div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2 class="shell-setting-title">系统右键菜单<span class="shell-status-tag" id="shell-status" role="status" hidden></span></h2><p>在资源管理器中选择文件或文件夹，直接打开 One 中对应的工具。</p></div></div><div class="setting-row"><div class="setting-copy"><h2>文件占用</h2></div>${switchControl('shell-locksmith','系统右键菜单：文件占用')}</div><div class="setting-row"><div class="setting-copy"><h2>批量重命名</h2></div>${switchControl('shell-rename','系统右键菜单：批量重命名')}</div><div class="setting-row"><div class="setting-copy"><h2>创建压缩包</h2></div>${switchControl('shell-archive-create','系统右键菜单：创建压缩包')}</div><div class="setting-row"><div class="setting-copy"><h2>解压压缩包</h2></div>${switchControl('shell-archive-extract','系统右键菜单：解压压缩包')}</div></div>`;}
export function setupExplorerMenuSettings(){
 const keys=['locksmith','rename','archiveCreate','archiveExtract'] as const;
 const controls=keys.map(k=>q<HTMLInputElement>('shell-'+k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())));let state:ExplorerMenuState={locksmith:false,rename:false,archiveCreate:false,archiveExtract:false,classic:false,modern:false};
 const status=(label:string,detail='')=>{const tag=q('shell-status');tag.textContent=label;tag.hidden=!label;tag.title=detail;};
 const fill=(next:ExplorerMenuState)=>{state=next;keys.forEach((key,index)=>controls[index].checked=!!state[key]);status(next.error?'未能启用':next.modern?'已启用 · 现代菜单':next.classic?'已启用 · 经典菜单':keys.some(key=>next[key])?'未能启用':'',next.error||(next.classic&&!next.modern?'在 Windows 11 的“显示更多选项”中使用；现代菜单需要受信任的签名包。':''));};
 const busy=(v:boolean)=>controls.forEach(c=>c.disabled=v);let initialized=false;busy(true);
 for(const control of controls)control.onchange=()=>{const value={locksmith:controls[0].checked,rename:controls[1].checked,archiveCreate:controls[2].checked,archiveExtract:controls[3].checked};busy(true);status('正在更新');void api.setExplorerMenu(value).then(fill).catch(error=>{fill(state);toast(error);}).finally(()=>busy(false));};
 return{activate(value:boolean){if(value&&!initialized){initialized=true;busy(true);void api.explorerMenuState().then(fill).catch(error=>{initialized=false;toast(error);}).finally(()=>busy(false));}}};
}
