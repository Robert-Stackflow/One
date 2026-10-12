import {api,esc,errorMessage,icon} from './ui';
import {confirmDialog,dialogMarkup,openDialog} from './dialog';
import type {ArchiveEditSession} from '../shared/archive-edit-session';
import './archive-recovery.css';
import './archive-edit-sessions.css';

export function showArchiveEditSessions(saved?:(archive:string)=>Promise<void>,openId?:string){
 const previous=document.querySelector<HTMLDialogElement>('#archive-edit-sessions');if(previous){openDialog(previous);return;}
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'archive-edit-sessions',title:'外部编辑',className:'archive-recovery-dialog archive-edit-sessions',body:`<div class="archive-edit-toolbar"><span data-edit-count></span><div><button data-edit-cancel hidden type="button">停止操作</button><button data-edit-refresh class="quiet" type="button">${icon('refresh')}刷新</button></div></div><p data-edit-feedback role="status" aria-live="polite" hidden></p><div data-edit-list></div><label class="archive-session-password" hidden>加密压缩包密码<input data-edit-password type="password" autocomplete="off" placeholder="需要核对或写回加密包时填写"></label>`});
 const dialog=template.content.firstElementChild as HTMLDialogElement,find=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 let items:ArchiveEditSession[]=[],busy=false,live=true,taskId='';
 const queued=new Map<string,ArchiveEditSession>();
 const feedback=(message:string,error=false)=>{const node=find('[data-edit-feedback]');node.textContent=message;node.hidden=!message;node.dataset.state=error?'error':'info';node.setAttribute('role',error?'alert':'status');};
 const detachProgress=api.onArchiveProgress(progress=>{if(!taskId||progress.id!==taskId||!live)return;feedback(progress.operation==='commit'?'正在完成最终保存…':progress.operation==='queue'?'正在等待任务资源…':`正在处理${progress.total?` · ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`:''}`);find<HTMLButtonElement>('[data-edit-cancel]').disabled=progress.operation==='commit';});
 const state=(item:ArchiveEditSession)=>item.error||[item.state==='writing'?'上次写回结果尚未确认，请核对原包':item.changed?'检测到尚未写回的修改':item.state==='saved'?'已写回；可以继续编辑':'文件内容没有变化',item.notice].filter(Boolean).join('。');
 const controls=()=>{for(const element of dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input'))element.disabled=busy&&!element.hasAttribute('data-edit-cancel');find('[data-edit-cancel]').hidden=!taskId;
  if(!busy)for(const button of dialog.querySelectorAll<HTMLButtonElement>('[data-edit-action]')){const item=items[Number(button.dataset.editIndex)],action=button.dataset.editAction;button.disabled=action==='reveal'?false:!!item?.error||action==='save'&&(!item.changed||item.state==='writing')||(action==='open'||action==='choose')&&item.editor==='running';}
 };
 const render=()=>{
  find('[data-edit-count]').textContent=items.length?`${items.length} 个编辑副本`:'编辑记录';
  find<HTMLLabelElement>('.archive-session-password').hidden=!items.length;
  const button=(index:number,action:string,label:string,style='')=>`<button data-edit-${action}="${index}" data-edit-action="${action}" data-edit-index="${index}" type="button"${style?` class="${style}"`:''}>${label}</button>`;
  find('[data-edit-list]').innerHTML=items.length?items.map((item,index)=>`<article class="archive-recovery-item archive-edit-item"><div class="archive-edit-item-heading"><strong title="${esc(item.name)}">${esc(item.name)}</strong><span title="${esc(item.archive)}">${esc(item.archive.split(/[\\/]/).pop()||item.archive)}</span></div><p class="archive-edit-copy" title="${esc(item.file)}">${esc(item.file)}</p><p data-edit-state="${index}" class="archive-edit-item-state"${item.error?' data-error="true"':''}>${esc(state(item))}</p><div class="archive-session-actions"><div>${button(index,'open','打开副本')}${button(index,'choose','选择程序')}${button(index,'check','检查变化')}${button(index,'save','确认写回','primary')}</div><div>${button(index,'inspect','核对原包','quiet')}${button(index,'export','另存副本','quiet')}${button(index,'reveal','查看位置','quiet')}${button(index,'remove','结束编辑','quiet')}</div></div></article>`).join(''):`<div class="archive-edit-empty">${icon('file')}<strong>没有进行中的外部编辑</strong><span>在 ZIP 或 7z 中选中文件后，使用“外部编辑选中项”</span></div>`;controls();
 };
 const detachChanges=api.onArchiveEditChanged(item=>{if(!live)return;if(busy){queued.set(item.id,item);return;}const index=items.findIndex(value=>value.id===item.id);if(index>=0){items[index]=item;render();}});
 const load=async()=>{const page=await api.archiveEditList();if(!live)return;items=page.items;render();feedback(page.truncated?'资料较多，处理后请刷新。':'');};
 const work=async(action:()=>Promise<void>)=>{if(busy)return;busy=true;controls();feedback('正在处理…');try{await action();}catch(error){if(live)feedback(errorMessage(error),true);}finally{busy=false;taskId='';if(live){for(const [id,item] of queued){const index=items.findIndex(value=>value.id===id);if(index>=0)items[index]=item;}queued.clear();render();}}};
 const password=()=>find<HTMLInputElement>('[data-edit-password]').value;
 const clearPassword=()=>{find<HTMLInputElement>('[data-edit-password]').value='';};
 find('[data-edit-refresh]').onclick=()=>void work(async()=>{await load();feedback('已刷新编辑资料');});
 find('[data-edit-cancel]').onclick=()=>{if(taskId)void api.archiveCancel(taskId).catch(error=>feedback(errorMessage(error),true));};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('click',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-edit-action]');if(!button||busy)return;
  const index=Number(button.dataset.editIndex),item=items[index],action=button.dataset.editAction;if(!item)return;
  void work(async()=>{
   if(action==='reveal'){await api.revealFile(item.file);feedback('已打开编辑副本位置');return;}
   if(action==='open'||action==='choose'){await api.archiveEditOpen(item.id,action==='choose');feedback('已打开临时文件；保存后会自动检查变化。');return;}
   const current=await api.archiveEditCheck(item.id);if(!live)return;items[index]=current;
   if(action==='check'){feedback('已检查文件内容');return;}
   if(action==='export'){const target=await api.archiveEditExport(item.id,current.token!);feedback(target?'已另存副本：'+target:'已取消另存，编辑副本仍保留');return;}
   if(action==='inspect'){
    taskId=crypto.randomUUID();controls();
    try{const result=await api.archiveEditInspect(item.id,password(),taskId);
     const detail=result.committed?'已确认上次批准的内容已经写入原包。':result.missing?'原条目已被删除或改名。继续后，写回会按原名称重新添加文件。':result.same?'原条目内容没有变化。继续后将以当前原包为基础写回。':'原条目内容也已变化。继续后，你的编辑副本将可以替换原包中的当前内容。';
     if(!await confirmDialog({title:'核对原包',message:`${result.archive}\n\n${result.name}\n\n${detail}\n\n${result.committed?'确认写回结果，保留继续编辑的副本。':'此步只确认继续编辑，随后仍需点击“确认写回”。'}`,confirm:result.committed?'确认已写回':'以当前原包继续'}))return;
     items[index]=await api.archiveEditResolve(item.id,result.token,password(),taskId);feedback(result.committed?'已确认上次写回成功；副本仍保留。':'已确认当前原包；检查修改后可写回。');await saved?.(current.archive);
    }finally{clearPassword();}return;
   }
   if(action==='save'){
    if(!current.changed||current.state==='writing')throw Error('文件没有变化或此前写回尚未确认，请核对原包');
    if(!await confirmDialog({title:'写回压缩包',message:`${current.archive}\n\n替换：${current.name}\n\n请先在编辑程序保存文件。原包变化时会停止写回，副本仍保留；写回后可以继续编辑。`,confirm:'校验并写回'}))return;
    taskId=crypto.randomUUID();controls();
    try{const result=await api.archiveEditSave(current.id,current.token!,password(),taskId);await load();feedback(result.recovery?'已写回；分卷恢复资料待检查，编辑副本已保留。':'已写回；编辑副本已保留。');await saved?.(current.archive);}finally{clearPassword();}return;
   }
   if(!await confirmDialog({title:'结束外部编辑',message:`${current.name}\n\n${current.changed?'副本中有尚未写回的修改。请先写回或另存；继续会丢弃这些修改。\n\n':''}请确认已关闭外部程序中的文件窗口。确认后删除这份临时文件和编辑记录。`,confirm:current.changed?'丢弃修改并结束':'结束并移除副本'}))return;
   await api.archiveEditDiscard(current.id,current.token!);await load();feedback('已移除编辑副本');
  });
 });
 const focus=()=>{if(!busy&&live)void work(load);};window.addEventListener('focus',focus);
 dialog.addEventListener('close',()=>{live=false;detachProgress();detachChanges();window.removeEventListener('focus',focus);clearPassword();dialog.remove();},{once:true});
 document.body.append(dialog);openDialog(dialog);void work(async()=>{await load();if(openId){await api.archiveEditOpen(openId);feedback('已打开临时文件；保存后会自动检查变化。');}});
}
