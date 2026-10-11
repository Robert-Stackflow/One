import {api,esc,icon,toast} from './ui';
import {installFileDropOverlay} from './file-drop-overlay';

export function toolInfo(label:string,detail:string){return `<button type="button" class="tool-info icon-button quiet" aria-label="${esc(label)}" data-tooltip="${esc(detail)}">${icon('info')}</button>`;}

export function installToolFileDrop(host:HTMLElement,title:string,onFiles:(paths:string[])=>void|Promise<void>,enabled?:()=>boolean){
 return installFileDropOverlay(host,{title,detail:'松开以添加文件',enabled,placement:'host',spacious:true,onDrop:async paths=>{
  const kinds=await api.dropPathKinds(paths);
  const files=kinds.filter(item=>item.kind==='file').map(item=>item.path);
  if(!files.length){toast('请拖入文件');return;}
  await onFiles(files);
 }});
}
