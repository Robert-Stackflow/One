import {api,esc,icon,errorMessage} from './ui';
import {dialogMarkup,openDialog,confirmDialog} from './dialog';
import type {ArchiveRecoveryPage,ArchiveRecoveryInspection} from '../shared/archive-recovery';
import './archive-recovery.css';

const stateNames:Record<ArchiveRecoveryInspection['state'],string>={pending:'发布尚未确认完成',committed:'已记录发布完成','rolled-back':'已记录回滚完成',incomplete:'计划未完成',empty:'仅剩空目录',missing:'未找到资料',invalid:'资料无法验证'};
export function showArchiveRecovery(){
 const existing=document.querySelector<HTMLDialogElement>('#archive-recovery-dialog');if(existing){openDialog(existing);return;}
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'archive-recovery-dialog',title:'恢复资料',className:'archive-recovery-dialog',body:`<div class="archive-recovery-heading"><p>检查异常退出后保留的解压记录与原文件副本。</p><button data-recovery-refresh class="quiet" type="button">${icon('refresh')}刷新</button></div><p data-recovery-feedback role="status" hidden></p><p data-recovery-error class="archive-recovery-error" role="alert" hidden></p><div data-recovery-list></div>`,actions:`<span data-recovery-count></span><button data-recovery-prev class="icon-button quiet" aria-label="上一页" type="button">${icon('back')}</button><button data-recovery-next class="icon-button quiet" aria-label="下一页" type="button">${icon('arrow')}</button><button data-dialog-dismiss type="button">关闭</button>`});
 const dialog=template.content.firstElementChild as HTMLDialogElement,find=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 let live=true,revision=0,page:ArchiveRecoveryPage={items:[],total:0,offset:0},checking='',restoring=false,cleaning=false,loading=false,removing=false;
 const error=(value:unknown)=>{const node=find('[data-recovery-error]');node.textContent=errorMessage(value);node.hidden=!value;};
 const controls=()=>{const busy=loading||!!checking||removing;find<HTMLButtonElement>('[data-recovery-refresh]').disabled=busy;find<HTMLButtonElement>('[data-recovery-prev]').disabled=busy||!page.offset;find<HTMLButtonElement>('[data-recovery-next]').disabled=busy||page.offset+50>=page.total;dialog.querySelectorAll<HTMLButtonElement>('[data-check],[data-forget],[data-restore],[data-cleanup]').forEach(button=>button.disabled=busy||page.items[Number(button.dataset.check??button.dataset.forget??button.dataset.restore??button.dataset.cleanup)]?.active===true);};
 const render=()=>{
  find('[data-recovery-count]').textContent=page.total?`${page.offset+1}–${Math.min(page.offset+50,page.total)} / ${page.total}${page.truncated?' · 处理后刷新可查看其余记录':''}`:'没有待处理记录';
  find('[data-recovery-list]').innerHTML=page.items.length?page.items.map((item,index)=>`<article class="archive-recovery-item"><div class="archive-recovery-item-heading"><div><strong>${esc(item.archive?.split(/[\\/]/).pop()||'无法读取的恢复记录')}</strong><time>${esc(new Date(item.created).toLocaleString())}${item.active?' · 任务可能仍在运行':''}</time></div><div class="archive-recovery-item-actions"><button type="button" data-check="${index}" class="quiet">检查</button>${item.path?`<button type="button" data-reveal="${index}" class="icon-button quiet" aria-label="查看恢复目录" title="查看恢复目录">${icon('folder')}</button>`:''}<button type="button" data-forget="${index}" class="icon-button quiet" aria-label="移除列表记录" title="移除列表记录">${icon('trash')}</button></div></div><p class="archive-recovery-path">${esc(item.parent||item.id)}</p>${item.error?`<p class="archive-recovery-error">${esc(item.error)}</p>`:''}<div data-recovery-inspection="${index}" hidden></div></article>`).join(''):'<div class="archive-recovery-empty">没有保留的恢复记录</div>';controls();
 };
 const load=async(offset=page.offset)=>{
  const token=++revision;loading=true;error('');controls();const list=find('[data-recovery-list]');list.setAttribute('aria-busy','true');if(!list.children.length)list.innerHTML='<div class="archive-recovery-empty" role="status">正在读取恢复记录…</div>';
  try{let next=await api.archiveRecoveryList(offset);if(!live||token!==revision)return;if(next.offset>0&&next.offset>=next.total)next=await api.archiveRecoveryList(next.total?Math.floor((next.total-1)/50)*50:0);if(!live||token!==revision)return;page=next;render();}
  catch(value){if(live&&token===revision){error(value);if(list.querySelector('[role="status"]'))list.innerHTML='';}}
  finally{if(live&&token===revision){loading=false;find('[data-recovery-list]').removeAttribute('aria-busy');controls();}}
 };
 const feedback=(message:string)=>{const node=find('[data-recovery-feedback]');node.textContent=message;node.hidden=!message;};
 const cleanupButton=(index:number,state:ArchiveRecoveryInspection['state'])=>['pending','rolled-back','committed','empty','missing'].includes(state)?`<button type="button" data-cleanup="${index}">${state==='committed'?'清理原文件副本':state==='missing'?'清理失效记录':state==='empty'?'清理空目录':'清理已还原资料'}</button>`:'';
 const inspect=async(index:number)=>{
  if(checking||loading||removing)return;const item=page.items[index];if(!item||item.active)return;checking=item.id;const output=find(`[data-recovery-inspection="${index}"]`);output.hidden=false;output.className='archive-recovery-inspection';output.innerHTML='<span role="status">正在检查清单…</span><button type="button" data-recovery-stop>停止</button>';let stopped=false;controls();
  output.querySelector<HTMLButtonElement>('[data-recovery-stop]')!.onclick=async()=>{stopped=true;try{await api.archiveRecoveryCancel(item.id);}catch(value){stopped=false;if(live)error(value);}};
  try{
   const result=await api.archiveRecoveryInspect(item.id);if(!live)return;
   output.innerHTML=`<strong>${esc(stateNames[result.state])}</strong><p>${esc(result.message)}</p><div class="archive-recovery-stats"><span>${result.files.toLocaleString()} 个文件</span><span>${result.directories.toLocaleString()} 个文件夹</span><span>${result.replaced.toLocaleString()} 个原文件替换计划</span></div>${result.samples.length?`<details><summary>计划中的目标路径${result.items>result.samples.length?'（前 30 项）':''}</summary><ul>${result.samples.map(sample=>`<li>${esc(sample.name)}</li>`).join('')}</ul></details>`:''}<small>检查只验证原发布清单及目录身份。还原和清理时重新核对当前文件；未完成发布的任务须先还原，再清理资料。</small>${result.state==='pending'||result.state==='rolled-back'?`<button type="button" data-restore="${index}">还原原文件</button>`:''}${cleanupButton(index,result.state)}`;
  }catch(value){if(live)output.textContent=stopped?'检查已停止':errorMessage(value);}
  finally{checking='';if(live)controls();}
 };
 const mutate=async(index:number,cleanup=false)=>{
  if(checking||loading||removing)return;const item=page.items[index];if(!item||item.active)return;removing=true;error('');feedback('');controls();
  try{
   if(!await confirmDialog(cleanup?{title:'永久清理恢复资料',message:'删除此任务保留的原文件副本或还原后隔离的新内容，以及恢复清单。此操作无法撤销；目标文件和目录不会删除。未完成还原、文件已变化或存在未知内容时停止，已删除的副本无法恢复，剩余资料可继续清理。',confirm:'永久清理'}:{title:'还原解压前的文件',message:'将已发布的新文件移入恢复目录，再放回原文件副本。遇到文件身份变化、缺少副本或占用时停止。已还原的部分会保留，可继续重试；目录、新内容和原清单不会删除。',confirm:'还原原文件'})||!live)return;
   removing=false;checking=item.id;restoring=true;cleaning=cleanup;const output=find(`[data-recovery-inspection="${index}"]`);output.hidden=false;output.className='archive-recovery-inspection';output.innerHTML='<span data-recovery-progress role="status">正在核对当前文件…</span><button data-recovery-stop type="button">停止</button>';controls();
   output.querySelector<HTMLButtonElement>('[data-recovery-stop]')!.onclick=async event=>{const button=event.currentTarget as HTMLButtonElement;button.disabled=true;try{await api.archiveCancel(item.id);}catch(value){if(live){button.disabled=false;error(value);}}};
   try{const result=await(cleanup?api.archiveRecoveryCleanup(item.id):api.archiveRecoveryRestore(item.id));if(live){
    if(cleanup){feedback(`清理完成：本次删除 ${result.count.toLocaleString()} 份恢复副本，目标文件与目录保留。`);await load();}
    else output.innerHTML=`<strong>还原处理完成</strong><p>${result.count?`已放回 ${result.count.toLocaleString()} 个原文件。`:'本次没有需要放回的原文件副本。'}新内容、目录与原发布清单已保留。</p>${cleanupButton(index,'pending')}`;
   }}
   catch(value){if(live){output.textContent=cleanup?'清理已停止或未完成。已删除的副本无法撤销，剩余资料已保留，可检查后继续。':'还原已停止或未完成。已处理的部分和恢复资料均保留，可检查后重试。';error(value);}}
   finally{checking='';restoring=false;}
  }finally{removing=false;if(live)controls();}
 };
 const releaseProgress=api.onArchiveProgress(value=>{if(!live||!restoring||checking!==value.id)return;const node=dialog.querySelector('[data-recovery-progress]');if(node)node.textContent=value.operation==='queue'?'正在等待归档资源…':value.total?`${cleaning?'正在清理副本':'正在还原文件'}：${value.done.toLocaleString()} / ${value.total.toLocaleString()}`:'正在核对当前文件…';});
 dialog.addEventListener('click',event=>{
  const target=(event.target as Element).closest<HTMLButtonElement>('button');if(!target||target.disabled)return;
  if(target.hasAttribute('data-check'))void inspect(Number(target.dataset.check));
  if(target.hasAttribute('data-restore'))void mutate(Number(target.dataset.restore));
  if(target.hasAttribute('data-cleanup'))void mutate(Number(target.dataset.cleanup),true);
  if(target.hasAttribute('data-reveal')){const item=page.items[Number(target.dataset.reveal)];if(item?.path)void api.revealFile(item.path).catch(value=>{if(live)error(value);});}
  if(target.hasAttribute('data-forget'))void(async()=>{
   if(checking||loading||removing)return;const item=page.items[Number(target.dataset.forget)];if(!item||item.active)return;removing=true;controls();
   try{if(!await confirmDialog({title:'移除恢复记录',message:'仅从此列表移除记录。恢复目录、原文件副本和目标文件均会保留。移除后需自行保存资料位置。',confirm:'移除记录'})||!live)return;await api.archiveRecoveryForget(item.id);if(live)await load();}
   catch(value){if(live)error(value);}finally{removing=false;if(live)controls();}
  })();
 });
 find('[data-recovery-refresh]').onclick=()=>void load();find('[data-recovery-prev]').onclick=()=>void load(Math.max(0,page.offset-50));find('[data-recovery-next]').onclick=()=>void load(page.offset+50);
 dialog.addEventListener('close',()=>{live=false;++revision;releaseProgress();if(checking)void(restoring?api.archiveCancel(checking):api.archiveRecoveryCancel(checking)).catch(()=>{});dialog.remove();},{once:true});
 document.body.append(dialog);openDialog(dialog);void load();
}
