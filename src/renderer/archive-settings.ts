import {api,q,button,switchControl,toast} from './ui';
import {bindPreference} from './preferences';
import type {ArchivePreferences,ArchiveAssociationState} from '../shared/archive-preferences';

export const archiveLevelOptions=()=>Array.from({length:10},(_,level)=>`<option value="${level}"${level===6?' selected':''}>${({0:'最低',1:'快速',6:'标准',9:'最高'} as Record<number,string>)[level]??'等级 '+level}${[0,1,6,9].includes(level)?' · '+level:''}</option>`).join('');

let migration:Promise<void>|undefined;
/** Preserve the old page-only preference once, then use backed-up settings. */
export async function archivePreferences():Promise<ArchivePreferences>{
 if(!migration)migration=(async()=>{
  const value=localStorage.getItem('one-archive-open-completed');
  if(value===null)return;
  if(value==='true')await api.patchSettings({archive:{openCompleted:true}});
  localStorage.removeItem('one-archive-open-completed');
 })().catch(error=>{migration=undefined;throw error;});
 await migration;
 return (await api.settings()).archive;
}
export function archiveSettingsPage(){return `<h2 class="settings-title">压缩与解压</h2><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>双击压缩包</h2><p>用于 One 内打开文件，以及关联到 One 的压缩文件。</p></div><select id="archive-pref-double-click" aria-label="双击压缩包"><option value="smart">智能解压</option><option value="browse">打开并浏览</option></select></div>
 <div class="setting-row"><div class="setting-copy"><h2>默认压缩格式</h2></div><select id="archive-pref-format" aria-label="默认压缩格式"><option value="zip">ZIP</option><option value="7z">7Z</option><option value="tar">TAR</option><option value="tar.gz">TAR.GZ</option><option value="tar.xz">TAR.XZ</option><option value="gz">GZ · 单文件</option><option value="xz">XZ · 单文件</option></select></div>
 <div class="setting-row"><div class="setting-copy"><h2>完成后打开文件夹</h2><p>默认关闭；开启后，压缩或解压完成时在资源管理器中显示结果。</p></div>${switchControl('archive-pref-open-completed','完成后打开文件夹')}</div>
 <div class="setting-row"><div class="setting-copy"><h2>解压同名文件</h2><p>用于解压至现有目录；同名文件夹合并，保留其中其他内容。</p></div><select id="archive-pref-conflict" aria-label="解压同名文件"><option value="rename">自动重命名</option><option value="skip">跳过</option><option value="replace">替换文件</option></select></div>
 </div><h3 class="settings-section-title">压缩与资源</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>默认压缩等级</h2><p>等级越高，通常耗时和内存使用越多；TAR 只打包。</p></div><select id="archive-pref-level" aria-label="默认压缩等级">${archiveLevelOptions()}</select></div>
 <div class="setting-row"><div class="setting-copy"><h2>压缩线程数</h2><p>用于 7Z、XZ 压缩及 7Z 修改；ZIP 和 GZ 使用单线程。</p></div><input id="archive-pref-threads" type="number" min="1" max="64" step="1" aria-label="压缩线程数"></div>
 <div class="setting-row"><div class="setting-copy"><h2>归档进程内存上限（MB）</h2><p>限制每个归档进程的提交内存；不足时任务失败，可提高上限后重试。新任务生效。</p></div><input id="archive-pref-memory" type="number" min="128" max="8192" step="1" aria-label="归档进程内存上限"></div>
 </div><h3 class="settings-section-title">文件关联</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>压缩包打开方式</h2><p id="archive-association-status">正在读取…</p></div>${button('archive-association-toggle','注册','archive')}</div>
 <div class="setting-row"><div class="setting-copy"><h2>Windows 默认应用</h2><p>选择由 One 打开的文件类型；注册不会更改现有默认程序。</p></div>${button('archive-association-defaults','设置默认应用','open')}</div>
 </div><p class="inline-notice" id="archive-association-message" role="status"></p>`;}

export function setupArchiveSettings(){
 const fill=(value:ArchivePreferences)=>{q<HTMLInputElement>('archive-pref-double-click').value=value.doubleClick;q<HTMLInputElement>('archive-pref-format').value=value.defaultFormat;q<HTMLInputElement>('archive-pref-open-completed').checked=value.openCompleted;q<HTMLSelectElement>('archive-pref-conflict').value=value.conflict;q<HTMLSelectElement>('archive-pref-level').value=String(value.compressionLevel);q<HTMLInputElement>('archive-pref-threads').value=String(value.threads);q<HTMLInputElement>('archive-pref-memory').value=String(value.memoryMiB);};
 const refresh=async()=>fill(await archivePreferences());
 void refresh().catch(toast);api.onArchivePreferences(fill);
 bindPreference(q('archive-pref-double-click'),()=>({archive:{doubleClick:q<HTMLInputElement>('archive-pref-double-click').value as ArchivePreferences['doubleClick']}}),refresh);
 bindPreference(q('archive-pref-format'),()=>({archive:{defaultFormat:q<HTMLInputElement>('archive-pref-format').value as ArchivePreferences['defaultFormat']}}),refresh);
 bindPreference(q('archive-pref-open-completed'),()=>({archive:{openCompleted:q<HTMLInputElement>('archive-pref-open-completed').checked}}),refresh);
 bindPreference(q('archive-pref-conflict'),()=>({archive:{conflict:q<HTMLSelectElement>('archive-pref-conflict').value as ArchivePreferences['conflict']}}),refresh);
 for(const [id,key] of [['archive-pref-level','compressionLevel'],['archive-pref-threads','threads'],['archive-pref-memory','memoryMiB']] as const)bindPreference(q(id),()=>({archive:{[key]:Number(q<HTMLInputElement>(id).value)}}),refresh);
 let state:ArchiveAssociationState={registered:false,available:false},busy=false;
 const display=(value:ArchiveAssociationState)=>{state=value;q('archive-association-status').textContent=!value.available?'安装版本中可注册 ZIP、7Z、RAR、TAR、GZ、XZ 等格式。':value.registered?'已注册为可选打开程序。':'尚未注册为压缩包打开程序。';const toggle=q<HTMLButtonElement>('archive-association-toggle');toggle.textContent=value.registered?'取消注册':'注册';toggle.disabled=busy||!value.available;q<HTMLButtonElement>('archive-association-defaults').disabled=busy||!value.registered;};
 const association=async(operation:'status'|'register'|'remove'|'defaults')=>{if(busy)return;busy=true;display(state);try{display(await api.archiveAssociation(operation));if(operation!=='status')q('archive-association-message').textContent=operation==='register'?'已注册，可在 Windows 默认应用中选择 One。':operation==='remove'?'已取消 One 的文件关联注册。':'已打开 Windows 默认应用设置。';}catch(error){q('archive-association-message').textContent=error instanceof Error?error.message:String(error);}finally{busy=false;display(state);}};
 q('archive-association-toggle').onclick=()=>void association(state.registered?'remove':'register');q('archive-association-defaults').onclick=()=>void association('defaults');
 return {activate:(value:boolean)=>{if(value){void refresh().catch(toast);void association('status');}}};
}
