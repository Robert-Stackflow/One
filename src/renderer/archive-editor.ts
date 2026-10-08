import {api,esc,icon,toast} from './ui';
import {closeDialog,confirmDialog,dialogMarkup,openDialog} from './dialog';
import type {ArchiveEdit,ArchiveEntry,ArchiveListing} from '../shared/archive';

export function archiveEditorMarkup(){return `<div id="archive-editor" class="archive-editor" hidden>
 <div class="archive-edit-tools" aria-label="修改压缩包"><button data-archive-edit="add">${icon('plus')}添加内容</button><button data-archive-edit="mkdir">${icon('folder')}新建目录</button><button data-archive-edit="rename">${icon('rename')}重命名</button><button data-archive-edit="delete">${icon('trash')}删除选中项</button><button data-archive-edit="comment">${icon('text')}备注</button></div>
 <div id="archive-edit-preview" class="archive-edit-preview" hidden><div class="archive-edit-heading"><span id="archive-edit-summary"></span><div><button id="archive-edit-discard" class="quiet">放弃修改</button><button id="archive-edit-save" class="primary">保存修改</button></div></div><ol id="archive-edit-changes"></ol><p>保存前会校验原包和修改结果。文件夹的重命名、删除包括其中的全部内容。</p></div>
 </div>`;}

type Draft={change:ArchiveEdit;description:string};
let dialogNumber=0;
async function editDialog(kind:'add'|'mkdir'|'rename'|'comment',entry?:ArchiveEntry,comment=''):Promise<Draft|undefined>{
 const id=`archive-edit-dialog-${++dialogNumber}`,title={add:'添加到压缩包',mkdir:'新建目录',rename:'重命名包内项目',comment:'编辑压缩包备注'}[kind];
 const body=kind==='add'?`<div class="archive-edit-source"><label>添加内容<input data-edit-source readonly placeholder="选择文件或文件夹"></label><div><button data-pick-file>选择文件</button><button data-pick-folder>选择文件夹</button></div></div><label>包内路径<input data-edit-name placeholder="例如 文档/说明.txt"></label><label class="archive-edit-replace"><input type="checkbox" data-edit-replace>替换同名文件</label><p>同名目录会合并；文件与目录同名时不会互相覆盖。</p>`:
  kind==='comment'?`<label>压缩包备注<textarea data-edit-comment rows="5" maxlength="65535">${esc(comment)}</textarea></label>`:
  `<label>${kind==='mkdir'?'目录路径':'包内路径'}<input data-edit-name value="${esc(entry?.name||'')}" placeholder="例如 文档/资料"></label>${entry?.directory?'<p>目录内的全部项目会同步改名。</p>':''}`;
 const template=document.createElement('template');template.innerHTML=dialogMarkup({id,title,body,actions:'<button data-edit-cancel>取消</button><button data-edit-queue class="primary">加入变更</button>',className:'archive-edit-dialog'});
 const dialog=template.content.firstElementChild as HTMLDialogElement;
 document.body.append(dialog);openDialog(dialog);
 let draft:Draft|undefined;
 const input=(selector:string)=>dialog.querySelector<HTMLInputElement>(selector)!;
 const choose=async(folder:boolean)=>{const path=folder?await api.pickDirectory():await api.pickFile();if(path&&dialog.isConnected&&dialog.open){input('[data-edit-source]').value=path;input('[data-edit-name]').value=path.split(/[\\/]/).pop()||'';}};
 dialog.querySelector('[data-pick-file]')?.addEventListener('click',()=>void choose(false).catch(toast));
 dialog.querySelector('[data-pick-folder]')?.addEventListener('click',()=>void choose(true).catch(toast));
 dialog.querySelector('[data-edit-cancel]')!.addEventListener('click',()=>void closeDialog(dialog));
 dialog.querySelector('[data-edit-queue]')!.addEventListener('click',()=>{
  const name=kind==='comment'?'':input('[data-edit-name]').value.trim().replaceAll('\\','/');
  if(kind!=='comment'&&!name)return toast('请填写包内路径');
  if(kind==='add'){
   const source=input('[data-edit-source]').value;if(!source)return toast('请先选择文件或文件夹');
   const replace=input('[data-edit-replace]').checked;draft={change:{kind:'add',source,name,replace},description:`${replace?'添加并替换同名文件':'添加'}：${name}`};
  }else if(kind==='rename')draft={change:{kind:'rename',index:entry!.index,name},description:`重命名：${entry!.name} → ${name}`};
  else if(kind==='mkdir')draft={change:{kind:'mkdir',name},description:`新建目录：${name}`};
  else{const text=input('[data-edit-comment]').value;draft={change:{kind:'comment',text},description:text?'更新压缩包备注':'清空压缩包备注'};}
  void closeDialog(dialog);
 });
 return new Promise(resolve=>dialog.addEventListener('close',()=>{dialog.remove();resolve(draft);},{once:true}));
}

export function setupArchiveEditor(root:HTMLElement,options:{listing:()=>ArchiveListing|undefined;selected?:()=>ArchiveEntry[];save:(changes:ArchiveEdit[])=>Promise<boolean>;saved:()=>Promise<void>;status:(message:string)=>void}){
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const entries=new Map<number,ArchiveEntry>();let drafts:Draft[]=[],busy=false;
 const selected=()=>options.selected?.()??[...root.querySelectorAll<HTMLInputElement>('.archive-entry input:checked')].map(input=>entries.get(Number(input.value))).filter((entry):entry is ArchiveEntry=>!!entry);
 const render=()=>{
  const listing=options.listing();find('#archive-editor').hidden=!listing?.editable;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-edit]'))button.disabled=busy||!listing?.editable;
  find<HTMLButtonElement>('[data-archive-edit="comment"]').hidden=!!listing&&!/\.zip$/i.test(listing.path);
  find('#archive-edit-preview').hidden=!drafts.length;
  find('#archive-edit-summary').textContent=`待保存 · ${drafts.length} 项变更`;
  find('#archive-edit-changes').innerHTML=drafts.map((draft,index)=>`<li><span>${esc(draft.description)}</span><button class="icon-button quiet" data-remove-change="${index}" aria-label="移除变更">${icon('close')}</button></li>`).join('');
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-remove-change],#archive-edit-save,#archive-edit-discard'))button.disabled=busy;
 };
 for(const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-edit]'))button.onclick=async()=>{
  if(busy||!options.listing()?.editable)return;
  const kind=button.dataset.archiveEdit as 'add'|'mkdir'|'rename'|'delete'|'comment',items=selected();
  if((kind==='rename'||kind==='delete')&&items.some(entry=>entry.implicit))return options.status('此文件夹未单独记录在压缩包中，请进入目录后选择实际文件修改');
  if(kind==='delete'){
   if(!items.length)return options.status('请先选择要删除的项目');
   drafts.push({change:{kind:'delete',indexes:items.map(e=>e.index)},description:`删除：${items.slice(0,3).map(e=>e.name).join('、')}${items.length>3?` 等 ${items.length} 项`:''}`});
  }else{
   if(kind==='rename'&&items.length!==1)return options.status('请选择一个项目重命名');
   const listing=options.listing();
   const pendingComment=[...drafts].reverse().find(d=>d.change.kind==='comment')?.change;
   const draft=await editDialog(kind,items[0],pendingComment?.kind==='comment'?pendingComment.text:listing?.comment);
   if(!draft||options.listing()!==listing||busy)return;
   if(kind==='comment')drafts=drafts.filter(d=>d.change.kind!=='comment');
   drafts.push(draft);
  }
  render();
 };
 find('#archive-edit-changes').onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-remove-change]');if(button&&!busy){drafts.splice(Number(button.dataset.removeChange),1);render();}};
 find('#archive-edit-discard').onclick=()=>{if(!busy){drafts=[];render();}};
 find('#archive-edit-save').onclick=async()=>{
  if(busy||!drafts.length)return;const listing=options.listing();
  if(!listing?.revision)return options.status('请重新打开压缩包后再保存修改');
  const snapshot=[...drafts];
  if(!await confirmDialog({title:'保存压缩包修改',message:`${listing.path}\n\n${snapshot.map(d=>d.description).join('\n')}\n\n校验通过后替换原压缩包。`,confirm:'校验并保存'}))return;
  if(options.listing()!==listing||busy||drafts.length!==snapshot.length||drafts.some((d,i)=>d!==snapshot[i]))return;
  if(await options.save(snapshot.map(d=>d.change))){drafts=[];render();await options.saved();}
 };
 return {
  hasChanges:()=>drafts.length>0,
  async discardBeforeLoad(){if(drafts.length&&!await confirmDialog({title:'放弃未保存的修改',message:'重新打开压缩包会清除当前待保存的变更。',confirm:'放弃并打开'}))return false;drafts=[];entries.clear();render();return true;},
  loaded(listing:ArchiveListing){entries.clear();for(const entry of listing.entries)if(!entry.implicit)entries.set(entry.index,entry);render();},
  setBusy(value:boolean){busy=value;render();},
  invalidate(){render();},
 };
}
