import {archiveScanText} from '../shared/archive-scan';
import {api,esc,toast} from './ui';
import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {isArchivePath} from '../shared/archive-actions';
import type {ArchiveTask,ArchiveTaskOperation} from '../shared/archive';

export const archiveTaskTitles:Record<ArchiveTaskOperation,string>={create:'创建压缩包',extract:'解压压缩包',test:'校验压缩包',update:'修改压缩包',drag:'拖出压缩内容',recover:'还原解压前的文件',cleanup:'清理解压恢复资料'};
const stateTitles={running:'进行中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'上次异常中断'};
export const archiveTaskSummary=(task:ArchiveTask)=>`${stateTitles[task.state]} · ${task.path.split(/[\\/]/).pop()}${task.result&&!task.result.cancelled?' · '+task.result.count.toLocaleString()+' 项':''}`;
export function archiveTaskDetails(task:ArchiveTask,browse:(path:string)=>void){
 const template=document.createElement('template'),source=task.operation==='create'&&task.result?task.result.path:task.path;
 const elapsed=Math.max(0,(task.finished??Date.now())-task.started)/1000;
 template.innerHTML=dialogMarkup({id:'archive-task-detail',title:archiveTaskTitles[task.operation],className:'dialog-wide',body:`<dl class="archive-task-details"><dt>状态</dt><dd>${stateTitles[task.state]}</dd><dt>开始时间</dt><dd>${esc(new Date(task.started).toLocaleString())}</dd><dt>耗时</dt><dd>${elapsed.toFixed(1)} 秒</dd><dt>压缩包</dt><dd>${esc(task.path)}</dd>${task.result?`<dt>结果位置</dt><dd>${esc(task.result.path)}</dd><dt>处理内容</dt><dd>${task.result.count.toLocaleString()} 项${task.result.skipped?'，跳过 '+task.result.skipped.toLocaleString()+' 项':''}</dd>`:''}${task.scan?`<dt>恶意软件扫描</dt><dd>${esc(archiveScanText(task.scan))}</dd>${task.scan.provider?`<dt>扫描服务</dt><dd>${esc(task.scan.provider)}</dd>`:''}${task.scan.emptyFiles?`<dt>空文件</dt><dd>${task.scan.emptyFiles} 个（无需扫描内容）</dd>`:''}${task.scan.reason?`<dt>扫描详情</dt><dd>${esc(task.scan.reason)}</dd>`:''}`:''}${task.message?`<dt>详情</dt><dd>${esc(task.message)}</dd>`:''}</dl>`,actions:`${isArchivePath(source)?'<button data-task-browse>浏览压缩包</button>':''}${task.state==='completed'&&task.result?'<button data-task-reveal>查看结果位置</button>':''}<button data-dialog-dismiss>关闭</button>`});
 const dialog=template.content.firstElementChild as HTMLDialogElement;dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.querySelector('[data-task-browse]')?.addEventListener('click',()=>{void closeDialog(dialog).then(closed=>{if(closed)browse(source);});});
 dialog.querySelector('[data-task-reveal]')?.addEventListener('click',()=>void api.revealFile(task.result!.path).catch(toast));
 document.body.append(dialog);openDialog(dialog);
}
