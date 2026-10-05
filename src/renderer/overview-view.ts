import {api,q,esc,icon,button,size,toast,action} from './ui';
import type {FileToolReport} from '../shared/file-tools';
import type {VolumeStatus} from '../shared/disk-monitor';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import './overview.css';
const titles:Record<string,string>={duplicates:'重复文件',diff:'文件比较','rename-preview':'重命名预览','rename-apply':'批量重命名','rename-undo':'撤销重命名','document-index':'文档索引','document-search':'正文搜索','integrity-create':'生成完整性清单','integrity-verify':'校验完整性'};
export function overviewPage(){return `<div class="overview-summary"><article class="overview-stat"><span>${icon('search')}文件索引</span><strong id="overview-index">—</strong><small id="overview-index-state">读取中</small></article><article class="overview-stat"><span>${icon('disk')}磁盘可用空间</span><strong id="overview-free">—</strong><small id="overview-volume-count">读取中</small></article><article class="overview-stat"><span>${icon('activity')}最近任务</span><strong id="overview-task-count">—</strong><small id="overview-last-task">尚无记录</small></article></div><div class="overview-columns"><section><div class="section-heading"><h2>常用工具</h2></div><div class="overview-tools">${[['duplicates','copy','重复文件','找出内容相同的文件'],['diff','braces','文件比较','查看文件与目录差异'],['rename','rename','批量重命名','预览规则与名称变化'],['documents','search','文档全文搜索','查找正文中的关键词'],['search','folder','文件搜索','文件、程序与系统设置'],['disk','disk','空间分析','查看目录占用与变化']].map(([id,glyph,title,description])=>`<button data-overview-tool="${id}"><span>${icon(glyph)}</span><div><strong>${title}</strong><small>${description}</small></div>${icon('chevron')}</button>`).join('')}</div></section><section><div class="section-heading"><h2>磁盘</h2><button class="quiet" data-overview-tool="system">容量告警 ${icon('chevron')}</button></div><div id="overview-volumes" class="overview-volumes"><div class="overview-empty">正在读取磁盘状态</div></div></section></div><section class="overview-recent" id="overview-task-center"><div class="section-heading"><h2>任务中心</h2>${button('overview-refresh','刷新','refresh')}</div><div id="overview-active" class="overview-task-list"></div><div id="overview-failures" class="overview-task-errors"></div><div class="section-heading overview-history-heading"><h2>最近完成</h2></div><div id="overview-history" class="overview-history"><div class="overview-empty">完成文件任务后，记录会显示在这里。</div></div></section>`;}
export function setupOverview(navigate:(id:string,report?:string)=>void){
 let active=false,timer:ReturnType<typeof setInterval>|undefined,revision=0,refreshing=false,pending=false;
 let history:FileToolReport[]=[],volumeKey='',historyKey='',taskKey='',volumeRevision=0;
 const showing=()=>active&&isWindowVisible();
 const text=(id:string,value:string)=>{const node=q(id);if(node.textContent!==value)node.textContent=value;};
 const availableSize=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(3)} GB`:size(bytes);
 const showVolumes=(volumes:VolumeStatus[])=>{
  if(!showing())return;
  const valid=volumes.filter(v=>v.total&&!v.error);
  text('overview-free',valid.length?availableSize(valid.reduce((n,v)=>n+v.free,0)):'—');text('overview-volume-count',valid.length?`${valid.length} 个磁盘`:'等待采样');
  const key=JSON.stringify(valid.map(v=>[v.drive,v.label,v.total,Math.round(v.free/1024**2)]));
  if(volumeKey!==key){volumeKey=key;q('overview-volumes').innerHTML=valid.length?valid.map(v=>`<button data-overview-drive="${esc(v.drive)}"><span>${icon('disk')}<strong>${esc(v.drive)} ${esc(v.label)}</strong><small>${availableSize(v.free)} 可用</small></span><div class="overview-volume-track"><i style="width:${Math.round((v.total-v.free)/v.total*100)}%;${v.free/v.total<.1?'background:#bd7356':''}"></i></div><small>${size(v.total-v.free)} / ${size(v.total)}</small></button>`).join(''):'<div class="overview-empty">暂时没有磁盘数据</div>';}
 };
 const refresh=async()=>{
  if(!showing())return;
  if(refreshing){pending=true;return;}
  refreshing=true;const request=revision,volumeRequest=volumeRevision;
  try{
   const data=await api.fileToolsOverview(true);if(request!==revision||!showing())return;
   text('overview-index',data.index.count.toLocaleString());text('overview-index-state',data.index.running?'正在更新':data.index.error||'可随时搜索');
   if(volumeRequest===volumeRevision)showVolumes(data.volumes);
   history=data.recent.filter(r=>r.kind!=='rename-preview');text('overview-task-count',String(history.length));text('overview-last-task',history.length?'最近完成于 '+new Date(history[0].created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'尚无记录');
   const live=[...(data.index.running?[{id:'index',label:'文件索引',phase:'正在建立索引',progress:''}]:[]),...(data.disk.running?[{id:'disk',label:'空间分析',phase:data.disk.root,progress:`${data.disk.files.toLocaleString()} 个文件` }]:[]),...data.active.map(job=>({id:job.id,label:titles[job.kind]||job.kind,phase:job.phase,progress:job.total?`${job.completed.toLocaleString()} / ${job.total.toLocaleString()}`:job.completed?job.completed.toLocaleString():''}))];
   const taskState=JSON.stringify([live,data.failures]);if(taskKey!==taskState){taskKey=taskState;q('overview-active').innerHTML=live.length?live.map(job=>`<div class="overview-task-row"><span class="overview-task-indicator"></span><div><strong>${esc(job.label)}</strong><small title="${esc(job.phase)}">${esc(job.phase)}${job.progress?' · '+esc(job.progress):''}</small></div><button class="quiet" data-overview-cancel="${esc(job.id)}">停止</button></div>`).join(''):'<div class="overview-task-empty">目前没有正在执行的任务</div>';q('overview-failures').innerHTML=data.failures.length?data.failures.slice(0,3).map(f=>`<div>${icon('info')}<strong>${esc(titles[f.kind]||f.kind)}</strong><span title="${esc(f.message)}">${esc(f.message)}</span><time>${new Date(f.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):'';}
   const recent=JSON.stringify(history);
   if(historyKey!==recent){historyKey=recent;q('overview-history').innerHTML=history.length?history.slice(0,6).map(r=>`<button data-overview-report="${r.id}"><span>${icon(r.kind.startsWith('rename')?'rename':r.kind==='duplicates'?'copy':'search')}</span><div><strong>${titles[r.kind]}</strong><small>${esc(r.summary)}</small></div><time>${new Date(r.created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>${icon('chevron')}</button>`).join(''):'<div class="overview-empty">完成文件任务后，记录会显示在这里。</div>';}
  }finally{refreshing=false;if(pending){pending=false;if(showing())void refresh().catch(()=>{});}}
 };
 const sync=()=>{revision++;clearInterval(timer);timer=undefined;if(showing()){void refresh().catch(toast);timer=setInterval(()=>void refresh().catch(()=>{}),5000);}else void api.fileToolsOverview(false).catch(()=>{});};
 api.onDiskMonitor(value=>{if(showing()&&value.volumes.length){volumeRevision++;showVolumes(value.volumes);}});onWindowVisibility(sync);action('overview-refresh',refresh);
 q('page-home').addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-overview-tool],[data-overview-drive],[data-overview-report],[data-overview-cancel]'):null;if(!target)return;if(target.dataset.overviewCancel){const id=target.dataset.overviewCancel;void (id==='index'?api.cancelSearchIndex():id==='disk'?api.cancelScan():api.fileToolsCancelId(id)).then(refresh).catch(toast);return;}if(target.dataset.overviewTool)navigate(target.dataset.overviewTool);else if(target.dataset.overviewDrive)navigate('disk',target.dataset.overviewDrive);else{const report=history.find(r=>r.id===target.dataset.overviewReport);if(report)navigate(report.kind.startsWith('rename')?'rename':report.kind.startsWith('document')?'documents':report.kind.startsWith('integrity')?'integrity':report.kind,report.id);}});
 return{activate(value:boolean){active=value;sync();}};
}
