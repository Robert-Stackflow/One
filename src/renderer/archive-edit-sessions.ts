import {api,esc,errorMessage} from './ui';
import {confirmDialog,dialogMarkup,openDialog} from './dialog';
import type {ArchiveEditSession} from '../shared/archive-edit-session';
import './archive-recovery.css';
import './archive-edit-sessions.css';

export function showArchiveEditSessions(saved?:(archive:string)=>Promise<void>){
 const previous=document.querySelector<HTMLDialogElement>('#archive-edit-sessions');if(previous){openDialog(previous);return;}
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'archive-edit-sessions',title:'外部编辑',className:'archive-recovery-dialog archive-edit-sessions',body:`<div class="archive-recovery-heading"><p>在外部程序中保存并关闭文件，再检查变化并确认写回。临时文件会保留到你主动移除；重启 One 后仍可继续处理。</p><button data-edit-refresh type="button">刷新</button></div><p data-edit-feedback role="status"></p><div data-edit-list></div><label class="archive-session-password">加密压缩包密码<input data-edit-password type="password" autocomplete="off" placeholder="写回加密包时填写，不会保存"></label>`,actions:'<button data-edit-cancel hidden type="button">停止写回</button><button data-dialog-dismiss type="button">关闭</button>'});
 const dialog=template.content.firstElementChild as HTMLDialogElement,find=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 let items:ArchiveEditSession[]=[],busy=false,live=true,taskId='';
 const detach=api.onArchiveProgress(progress=>{if(!taskId||progress.id!==taskId||!live)return;feedback(progress.operation==='commit'?'正在完成最终保存…':progress.operation==='queue'?'正在等待任务资源…':`正在写回${progress.total?` · ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`:''}`);find<HTMLButtonElement>('[data-edit-cancel]').disabled=progress.operation==='commit';});
 const feedback=(message:string,error=false)=>{find('[data-edit-feedback]').textContent=message;find('[data-edit-feedback]').setAttribute('role',error?'alert':'status');};
 const controls=()=>{for(const element of dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input'))element.disabled=busy&&!element.hasAttribute('data-edit-cancel');find('[data-edit-cancel]').hidden=!taskId;};
 const render=()=>{
  find('[data-edit-list]').innerHTML=items.length?items.map((item,index)=>`<article class="archive-recovery-item"><strong>${esc(item.name)}</strong><p class="archive-recovery-path">${esc(item.archive)}</p><p class="archive-recovery-path">编辑副本：${esc(item.file)}</p><p data-edit-state="${index}" class="archive-recovery-path">${esc(item.error||({ready:'等待检查文件变化',writing:'上次写回结果尚未确认，请保留文件并检查原包',saved:'已写回；副本仍保留，可另存或移除'}[item.state]))}</p><div class="archive-session-actions"><button data-edit-open="${index}" type="button" ${item.error?'disabled':''}>打开编辑副本</button><button data-edit-check="${index}" type="button" ${item.error?'disabled':''}>检查变化</button><button data-edit-save="${index}" type="button" disabled>确认写回</button><button data-edit-reveal="${index}" type="button">查看位置</button><button data-edit-remove="${index}" class="quiet" type="button" ${item.error?'disabled':''}>移除副本</button></div></article>`).join(''):'<div class="archive-recovery-empty">选择 ZIP 或 7Z 中的一个文件，再使用“外部编辑选中项”。</div>';
 };
 const load=async()=>{const page=await api.archiveEditList();if(!live)return;items=page.items;render();if(page.truncated)feedback('资料较多，处理后请刷新。');};
 const work=async(action:()=>Promise<void>)=>{if(busy)return;busy=true;controls();feedback('正在处理…');try{await action();}catch(error){if(live)feedback(errorMessage(error),true);}finally{busy=false;taskId='';if(live){controls();for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-edit-save]')){const item=items[Number(button.dataset.editSave)];button.disabled=!item?.changed||item.state!=='ready'||!!item.error;}for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-edit-open],[data-edit-check],[data-edit-remove]')){const item=items[Number(button.dataset.editOpen??button.dataset.editCheck??button.dataset.editRemove)];button.disabled=!!item?.error;}}}};
 find('[data-edit-refresh]').onclick=()=>void work(async()=>{await load();feedback('已刷新编辑资料');});
 find('[data-edit-cancel]').onclick=()=>{if(taskId)void api.archiveCancel(taskId).catch(error=>feedback(errorMessage(error),true));};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('click',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-edit-open],[data-edit-check],[data-edit-save],[data-edit-reveal],[data-edit-remove]');if(!button||busy)return;
  const index=Number(button.dataset.editOpen??button.dataset.editCheck??button.dataset.editSave??button.dataset.editReveal??button.dataset.editRemove),item=items[index];if(!item)return;
  void work(async()=>{
   if(button.hasAttribute('data-edit-reveal')){await api.revealFile(item.file);feedback('已打开编辑副本位置');return;}
   if(button.hasAttribute('data-edit-open')){await api.archiveEditOpen(item.id);feedback('已打开临时文件；在外部程序保存并关闭后，点击“检查变化”。');return;}
   const current=await api.archiveEditCheck(item.id);if(!live)return;items[index]=current;
   if(button.hasAttribute('data-edit-check')){find(`[data-edit-state="${index}"]`).textContent=current.state==='writing'?'上次写回尚未确认，请保留副本并手动核对原包':current.state==='saved'?current.changed?'副本又有变化；此会话已结束，请另存或重新打开原包开始编辑':'副本内容与已写回版本一致':current.changed?'检测到文件变化；确认后可写回原包':'文件内容没有变化';feedback('已检查文件内容');return;}
   if(button.hasAttribute('data-edit-save')){
    if(!current.changed||current.state!=='ready')throw Error('文件没有变化或会话已经结束，请重新检查');
    if(!await confirmDialog({title:'写回压缩包',message:`${current.archive}\n\n替换：${current.name}\n\n请先在外部程序保存并关闭文件。原包变化时会停止写回，编辑副本仍会保留。`,confirm:'校验并写回'}))return;
    taskId=crypto.randomUUID();controls();
    const result=await api.archiveEditSave(current.id,current.token!,find<HTMLInputElement>('[data-edit-password]').value,taskId);find<HTMLInputElement>('[data-edit-password]').value='';
    await load();feedback(result.recovery?'已写回；分卷恢复资料待检查，编辑副本已保留。':'已写回；编辑副本已保留。');await saved?.(current.archive);return;
   }
   if(!await confirmDialog({title:'移除编辑副本',message:`${current.name}\n\n${current.changed?'副本中有尚未写回的修改。请确认已经另存文件。\n\n':''}将删除这份临时文件及编辑记录。`,confirm:'移除副本'}))return;
   await api.archiveEditDiscard(current.id,current.token!);await load();feedback('已移除编辑副本');
  });
 });
 dialog.addEventListener('close',()=>{live=false;detach();find<HTMLInputElement>('[data-edit-password]').value='';dialog.remove();},{once:true});
 document.body.append(dialog);openDialog(dialog);void work(load);
}
