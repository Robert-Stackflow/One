import {api,q,button,switchControl,toast} from './ui';
import {bindPreference} from './preferences';
import type {ArchivePreferences,ArchiveAssociationState} from '../shared/archive-preferences';
import {solidSizes} from '../shared/archive-compression';

export const archiveThreadOptions=()=>'<option value="0">自动</option>'+Array.from({length:64},(_,index)=>`<option value="${index+1}"${index===1?' selected':''}>${index+1}</option>`).join('');
export const archiveSolidOptions=()=>'<option value="off">非固实</option>'+solidSizes.map(size=>`<option value="${size}"${size===64?' selected':''}>${size} MB</option>`).join('')+'<option value="solid">固实</option>';
export const archiveZipMethodOptions='<option value="deflate">Deflate</option><option value="xz">XZ</option>';
export const archiveZipEncryptionOptions='<option value="aes256">AES-256</option><option value="zipcrypto">ZipCrypto</option>';
export const archiveSevenMethodOptions='<option value="lzma2">LZMA2</option><option value="lzma">LZMA</option>';

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
 <div class="setting-row"><div class="setting-copy"><h2>任务完成后关闭窗口</h2><p>仅在压缩或解压成功时关闭；出错时保留窗口。</p></div>${switchControl('archive-pref-close-on-complete','任务完成后关闭窗口')}</div>
 <div class="setting-row"><div class="setting-copy"><h2>解压同名文件</h2><p>用于解压至现有目录；同名文件夹合并，保留其中其他内容。</p></div><select id="archive-pref-conflict" aria-label="解压同名文件"><option value="rename">自动重命名</option><option value="skip">跳过</option><option value="replace">替换文件</option></select></div>
 </div><h3 class="settings-section-title">压缩与资源</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>默认压缩等级</h2><p>等级越高，通常耗时和内存使用越多；TAR 只打包。</p></div><select id="archive-pref-level" aria-label="默认压缩等级">${archiveLevelOptions()}</select></div>
 <div class="setting-row"><div class="setting-copy"><h2>压缩线程数</h2><p>自动模式按 CPU 与总线程预算选择；ZIP 可并行压缩多个文件，GZ 使用单线程。</p></div><select id="archive-pref-threads" aria-label="压缩线程数">${archiveThreadOptions()}</select></div>
 <div class="setting-row"><div class="setting-copy"><h2>归档进程内存上限（MB）</h2><p>限制每个归档进程的提交内存；不足时任务失败，可提高上限后重试。新任务生效。</p></div><input id="archive-pref-memory" type="number" min="128" max="8192" step="1" aria-label="归档进程内存上限"></div>
 </div><h3 class="settings-section-title">ZIP 压缩设置</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>压缩方法</h2><p>Deflate 兼容性更广；XZ 需要接收软件支持该方法。</p></div><select id="archive-pref-zip-method" aria-label="ZIP 压缩方法">${archiveZipMethodOptions}</select></div>
 <div class="setting-row"><div class="setting-copy"><h2>加密算法</h2><p>设置密码后生效。AES-256 为默认；ZipCrypto 用于旧软件兼容，保护能力较弱。</p></div><select id="archive-pref-zip-encryption" aria-label="ZIP 加密算法">${archiveZipEncryptionOptions}</select></div>
 </div><h3 class="settings-section-title">7Z 压缩设置</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>压缩方法</h2></div><select id="archive-pref-seven-method" aria-label="7Z 压缩方法">${archiveSevenMethodOptions}</select></div>
 <div class="setting-row"><div class="setting-copy"><h2>固实块大小</h2><p>同一块中的文件共同压缩；较大块可改善压缩率，但提取其中单个文件可能更慢。</p></div><select id="archive-pref-seven-solid" aria-label="7Z 固实块大小">${archiveSolidOptions()}</select></div>
 </div><h3 class="settings-section-title">任务队列</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>同时运行的任务数</h2><p>超过上限的任务依次等待，可在任务中心停止。开始新任务时应用队列设置。</p></div><input id="archive-pref-concurrent" type="number" min="1" max="8" step="1" aria-label="同时运行的归档任务数"></div>
 <div class="setting-row"><div class="setting-copy"><h2>总内存预算（MB）</h2><p>运行中任务的进程内存上限合计不超过此值；预算至少应容纳一个任务。不包含 One 主窗口及其他程序。</p></div><input id="archive-pref-total-memory" type="number" min="128" max="32768" step="1" aria-label="归档队列总内存预算"></div>
 <div class="setting-row"><div class="setting-copy"><h2>总线程预算</h2><p>按每个任务配置的线程数预留额度，避免同时压缩占用过多 CPU；不是系统线程数的硬限制。</p></div><input id="archive-pref-total-threads" type="number" min="1" max="64" step="1" aria-label="归档队列总线程预算"></div>
 </div><h3 class="settings-section-title">解压防护</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>保留下载来源标记</h2><p>默认开启。将压缩包的 Internet 或受限区域标记传给解出的文件，保留 Windows 后续提醒。写入失败时停止解压；不支持命名流的磁盘需手动关闭此项。</p></div>${switchControl('archive-pref-propagate-zone','保留下载来源标记')}</div>
 <div class="setting-row"><div class="setting-copy"><h2>解压时扫描恶意软件</h2><p>默认关闭。通过本机扫描服务检查暂存文件；扫描不可用、失败或超时时停止解压。扫描未检出威胁不代表文件绝对安全。</p></div>${switchControl('archive-pref-scan','解压时扫描恶意软件')}</div>
 </div><h3 class="settings-section-title">文件关联</h3><div class="settings-card">
 <div class="setting-row"><div class="setting-copy"><h2>压缩包打开方式</h2><p id="archive-association-status">正在读取…</p></div>${button('archive-association-toggle','注册','archive')}</div>
 <div class="setting-row"><div class="setting-copy"><h2>Windows 默认应用</h2><p>选择由 One 打开的文件类型；注册不会更改现有默认程序。</p></div>${button('archive-association-defaults','设置默认应用','open')}</div>
 </div><p class="inline-notice" id="archive-association-message" role="status"></p>`;}

export function setupArchiveSettings(){
 const fill=(value:ArchivePreferences)=>{q<HTMLInputElement>('archive-pref-double-click').value=value.doubleClick;q<HTMLInputElement>('archive-pref-format').value=value.defaultFormat;q<HTMLInputElement>('archive-pref-open-completed').checked=value.openCompleted;q<HTMLInputElement>('archive-pref-close-on-complete').checked=value.closeOnComplete;q<HTMLSelectElement>('archive-pref-conflict').value=value.conflict;q<HTMLSelectElement>('archive-pref-level').value=String(value.compressionLevel);q<HTMLInputElement>('archive-pref-threads').value=value.autoThreads?'0':String(value.threads);q<HTMLInputElement>('archive-pref-memory').value=String(value.memoryMiB);q<HTMLInputElement>('archive-pref-concurrent').value=String(value.maxConcurrent);q<HTMLInputElement>('archive-pref-total-memory').value=String(value.totalMemoryMiB);q<HTMLInputElement>('archive-pref-total-threads').value=String(value.totalThreads);q<HTMLInputElement>('archive-pref-propagate-zone').checked=value.propagateZone;q<HTMLInputElement>('archive-pref-scan').checked=value.scanOnExtract;};
 const fillCompression=(value:ArchivePreferences)=>{q<HTMLSelectElement>('archive-pref-zip-method').value=value.zipMethod;q<HTMLSelectElement>('archive-pref-zip-encryption').value=value.zipEncryption;q<HTMLSelectElement>('archive-pref-seven-method').value=value.sevenMethod;q<HTMLSelectElement>('archive-pref-seven-solid').value=String(value.sevenSolid);};
 const refresh=async()=>{const value=await archivePreferences();fill(value);fillCompression(value);};

 void refresh().catch(toast);api.onArchivePreferences(value=>{fill(value);fillCompression(value);});
 bindPreference(q('archive-pref-scan'),()=>({archive:{scanOnExtract:q<HTMLInputElement>('archive-pref-scan').checked}}),refresh);
 bindPreference(q('archive-pref-propagate-zone'),()=>({archive:{propagateZone:q<HTMLInputElement>('archive-pref-propagate-zone').checked}}),refresh);
 bindPreference(q('archive-pref-double-click'),()=>({archive:{doubleClick:q<HTMLInputElement>('archive-pref-double-click').value as ArchivePreferences['doubleClick']}}),refresh);
 bindPreference(q('archive-pref-format'),()=>({archive:{defaultFormat:q<HTMLInputElement>('archive-pref-format').value as ArchivePreferences['defaultFormat']}}),refresh);
 bindPreference(q('archive-pref-open-completed'),()=>({archive:{openCompleted:q<HTMLInputElement>('archive-pref-open-completed').checked}}),refresh);
 bindPreference(q('archive-pref-close-on-complete'),()=>({archive:{closeOnComplete:q<HTMLInputElement>('archive-pref-close-on-complete').checked}}),refresh);
 bindPreference(q('archive-pref-conflict'),()=>({archive:{conflict:q<HTMLSelectElement>('archive-pref-conflict').value as ArchivePreferences['conflict']}}),refresh);
 for(const [id,key] of [['archive-pref-level','compressionLevel'],['archive-pref-memory','memoryMiB'],['archive-pref-concurrent','maxConcurrent'],['archive-pref-total-memory','totalMemoryMiB'],['archive-pref-total-threads','totalThreads']] as const)bindPreference(q(id),()=>({archive:{[key]:Number(q<HTMLInputElement>(id).value)}}),refresh);
 for(const [id,key] of [['archive-pref-zip-method','zipMethod'],['archive-pref-zip-encryption','zipEncryption'],['archive-pref-seven-method','sevenMethod']] as const)bindPreference(q(id),()=>({archive:{[key]:q<HTMLSelectElement>(id).value}}),refresh);
 bindPreference(q('archive-pref-seven-solid'),()=>{const value=q<HTMLSelectElement>('archive-pref-seven-solid').value;return {archive:{sevenSolid:(value==='off'||value==='solid'?value:Number(value)) as ArchivePreferences['sevenSolid']}};},refresh);
 bindPreference(q('archive-pref-threads'),()=>{const threads=Number(q<HTMLSelectElement>('archive-pref-threads').value);return {archive:{autoThreads:threads===0,...(threads?{threads}:{})}};},refresh);
 let state:ArchiveAssociationState={registered:false,available:false},busy=false;
 const display=(value:ArchiveAssociationState)=>{state=value;q('archive-association-status').textContent=!value.available?'安装版本中可注册 ZIP、7Z、RAR、TAR、GZ、XZ 等格式。':value.needsUpdate?'旧版打开方式已注册，可更新为各格式专用图标。':value.registered?'已注册为可选打开程序。':'尚未注册为压缩包打开程序。';const toggle=q<HTMLButtonElement>('archive-association-toggle');toggle.textContent=value.needsUpdate?'更新注册':value.registered?'取消注册':'注册';toggle.disabled=busy||!value.available;q<HTMLButtonElement>('archive-association-defaults').disabled=busy||!value.registered;};
 const association=async(operation:'status'|'register'|'remove'|'defaults')=>{if(busy)return;busy=true;display(state);try{display(await api.archiveAssociation(operation));if(operation!=='status')q('archive-association-message').textContent=operation==='register'?'已注册，可在 Windows 默认应用中选择 One。':operation==='remove'?'已取消 One 的文件关联注册。':'已打开 Windows 默认应用设置。';}catch(error){q('archive-association-message').textContent=error instanceof Error?error.message:String(error);}finally{busy=false;display(state);}};
 q('archive-association-toggle').onclick=()=>void association(state.registered?'remove':'register');q('archive-association-defaults').onclick=()=>void association('defaults');
 return {activate:(value:boolean)=>{if(value){void refresh().catch(toast);void association('status');}}};
}
