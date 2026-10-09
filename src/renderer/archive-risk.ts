import {api,esc,size} from './ui';
import {closeDialog,dialogMarkup,openDialog} from './dialog';
import {archiveRiskReasons,type ArchiveRisk,type ArchiveRiskApproval} from '../shared/archive-risk';
import type {ArchiveRequest} from '../shared/archive';
export class ArchiveRiskNotice extends Error {}

async function confirmRisk(path:string,risk:ArchiveRisk):Promise<ArchiveRiskApproval|undefined>{
 const template=document.createElement('template');
 template.innerHTML=dialogMarkup({id:'archive-risk-dialog',title:'确认解压风险',className:'archive-risk-dialog',body:`<p class="archive-risk-path" title="${esc(path)}">${esc(path.split(/[\\/]/).pop())}</p><ul>${archiveRiskReasons(risk).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><p>选中内容声明展开 ${size(risk.bytes)}。疑似压缩包按文件名识别，不会自动递归解压；这不表示内容一定有害。</p><div class="archive-risk-limits"><label>本层展开上限（GiB）<input data-risk-bytes type="number" min="1" max="8388607" step="1" value="${Math.max(64,Math.ceil(risk.bytes/1024**3))}"></label><label>本次解压时限（分钟）<input data-risk-time type="number" min="1" max="1440" step="1" value="30"></label></div><p>超出上限会停止解压。磁盘余量、路径和内容大小检查仍会执行。</p><p data-risk-error role="alert" hidden></p>`,actions:'<button data-risk-cancel>取消</button><button data-risk-continue class="primary">确认并继续</button>'});
 const dialog=template.content.firstElementChild as HTMLDialogElement;document.body.append(dialog);
 let approval:ArchiveRiskApproval|undefined;
 const result=new Promise<ArchiveRiskApproval|undefined>(resolve=>dialog.addEventListener('close',()=>{dialog.remove();resolve(approval);},{once:true}));
 dialog.querySelector('[data-risk-cancel]')!.addEventListener('click',()=>void closeDialog(dialog));
 dialog.querySelector('[data-risk-continue]')!.addEventListener('click',()=>{
  const bytes=dialog.querySelector<HTMLInputElement>('[data-risk-bytes]')!,time=dialog.querySelector<HTMLInputElement>('[data-risk-time]')!;
  if(!bytes.reportValidity()||!time.reportValidity())return;
  const maxBytes=Number(bytes.value)*1024**3,maxMilliseconds=Number(time.value)*60000;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<risk.bytes){const error=dialog.querySelector<HTMLElement>('[data-risk-error]')!;error.hidden=false;error.textContent='展开上限不能小于声明的内容大小。';return;}
  approval={revision:risk.revision,maxBytes,maxMilliseconds};void closeDialog(dialog);
 });
 openDialog(dialog);return result;
}

/** Per-page, revision-bound approvals; never persist permission in settings. */
export function archiveRiskRunner(waiting?:(value:boolean)=>void){
 const dragApprovals=new Map<string,ArchiveRiskApproval>();
 return async(request:ArchiveRequest,id:string)=>{
  const key=request.operation==='drag'?JSON.stringify([request.path.toLowerCase(),request.revision,[...request.selected].sort((a,b)=>a-b),[...(request.selectedFolders??[])].sort()]):'';
  let approved=dragApprovals.get(key);
  for(let attempt=0;attempt<3;attempt++){
   const value=await api.archiveRun({...request,riskApproval:approved},id);
   if(!('risk' in value)||!value.risk)return value;
   waiting?.(true);let next:ArchiveRiskApproval|undefined;
   try{next=await confirmRisk(request.path,value.risk);}finally{waiting?.(false);}
   if(!next)throw new ArchiveRiskNotice('已取消风险确认，未发布解压内容。');
   if(request.operation==='drag'){
    if(dragApprovals.size>=16)dragApprovals.clear();dragApprovals.set(key,next);
    throw new ArchiveRiskNotice('已确认本次风险，请重新拖出选中内容。');
   }
   approved=next;
  }
  throw Error('压缩包持续变化，请重新打开后再试。');
 };
}
