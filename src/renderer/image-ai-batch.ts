import {api,q,toast,errorMessage} from './ui';
import type {ImageAiProgress,ImageAiResult} from '../shared/image-ai';

interface BatchConfig {
 prefix:'image-ai'|'image-superres';
 action:string;
 complete:string;
 license:string;
 modelStatus:()=>Promise<{ready:boolean;bytes:number}>;
 start:(source:string,directory:string)=>Promise<ImageAiResult>;
 onProgress:(callback:(progress:ImageAiProgress)=>void)=>()=>void;
 progress:(value:ImageAiProgress)=>string;
}

const nameOf=(path:string)=>path.split(/[\\/]/).pop()||path;
const megabytes=(bytes:number)=>`${(bytes/1048576).toFixed(1)} MB`;

export function setupImageAiBatch(config:BatchConfig){
 const id=config.prefix,pick=q<HTMLButtonElement>(`${id}-pick`),sourceLabel=q<HTMLElement>(`${id}-source`),directory=q<HTMLInputElement>(`${id}-directory`),pickDirectory=q<HTMLButtonElement>(`${id}-pick-directory`),modelLabel=q<HTMLElement>(`${id}-model`),start=q<HTMLButtonElement>(`${id}-start`),cancel=q<HTMLButtonElement>(`${id}-cancel`),status=q<HTMLElement>(`${id}-status`),comparison=q<HTMLElement>(`${id}-comparison`),original=q<HTMLImageElement>(`${id}-original`),resultImage=q<HTMLImageElement>(`${id}-result`),output=q<HTMLElement>(`${id}-output`),detail=q<HTMLElement>(`${id}-detail`),reveal=q<HTMLButtonElement>(`${id}-reveal`),list=q<HTMLElement>(`${id}-batch-list`);
 let sources:string[]=[],results:(ImageAiResult|undefined)[]=[],errors:(string|undefined)[]=[],selected=0,ready=false,running=false,cancelRequested=false,version=0;
 const renderRows=()=>{list.hidden=sources.length<2;if(list.hidden)return;const fragment=document.createDocumentFragment();sources.forEach((source,index)=>{const button=document.createElement('button');button.type='button';button.className='image-ai-batch-row';button.setAttribute('aria-current',String(selected===index));button.title=errors[index]?`${source} · ${errors[index]}`:source;const state=results[index]?'完成':errors[index]?'失败':running&&index===results.filter(Boolean).length+errors.filter(Boolean).length?'处理中':'待处理';button.textContent=`${index+1}. ${nameOf(source)} · ${state}`;button.onclick=()=>{selected=index;showSelection();if(errors[index])status.textContent=errors[index];render();};fragment.append(button);});list.replaceChildren(fragment);};
 const render=()=>{sourceLabel.textContent=sources.length>1?`已选 ${sources.length} 张 · ${nameOf(sources[selected])}`:sources.length?nameOf(sources[0]):'尚未选择图片';sourceLabel.title=sources[selected]||'';pick.disabled=pickDirectory.disabled=running;start.disabled=running||!sources.length||!directory.value;cancel.disabled=!running||cancelRequested;start.textContent=ready?`开始${sources.length>1?'批量':''}${config.action}`:`下载模型并开始${sources.length>1?'批量':''}${config.action}`;const result=results[selected];output.hidden=!result;detail.textContent=result?`${result.width} × ${result.height} · ${megabytes(result.before)} → ${megabytes(result.after)} · ${result.message}`:'';renderRows();};
 const loadPreview=async(path:string,target:HTMLImageElement,ticket:number)=>{try{const value=await api.imageCropPreview(path);if(ticket===version){target.src=value.url;comparison.hidden=false;}}catch(error){if(ticket===version)status.textContent=`预览不可用：${errorMessage(error)}`;}};
 const showSelection=()=>{const ticket=++version;comparison.hidden=true;original.removeAttribute('src');resultImage.removeAttribute('src');if(sources[selected])void loadPreview(sources[selected],original,ticket);const result=results[selected];if(result)void loadPreview(result.output,resultImage,ticket);};
 const progress=(value:ImageAiProgress)=>{if(!running)return;const index=results.filter(Boolean).length+errors.filter(Boolean).length;status.textContent=`${Math.min(index+1,sources.length)}/${sources.length} · ${config.progress(value)}`;};
 pick.onclick=()=>void api.imagePickFiles().then(paths=>{if(!paths.length)return;const unique=[...new Set(paths)];if(unique.length>20){status.textContent='一次最多选择 20 张图片';return;}sources=unique;results=Array(unique.length).fill(undefined);errors=Array(unique.length).fill(undefined);selected=0;status.textContent='';showSelection();render();}).catch(toast);
 pickDirectory.onclick=()=>void api.pickDirectory(directory.value||undefined).then(path=>{if(path)directory.value=path;render();}).catch(toast);
 start.onclick=()=>{if(running||!sources.length||!directory.value)return;const jobPaths=[...sources],destination=directory.value;running=true;cancelRequested=false;results=Array(jobPaths.length).fill(undefined);errors=Array(jobPaths.length).fill(undefined);showSelection();render();void (async()=>{for(let index=0;index<jobPaths.length&&!cancelRequested;index++){selected=index;status.textContent=`${index+1}/${jobPaths.length} · 正在处理 ${nameOf(jobPaths[index])}`;showSelection();render();try{results[index]=await config.start(jobPaths[index],destination);ready=true;modelLabel.textContent='模型已缓存，可离线使用';}catch(error){errors[index]=errorMessage(error);if(cancelRequested)break;if(!ready){const cached=await config.modelStatus().catch(()=>null);ready=!!cached?.ready;if(!ready)break;}}showSelection();render();}const passed=results.filter(Boolean).length,failed=errors.filter(Boolean).length;status.textContent=cancelRequested?`已取消，完成 ${passed}/${jobPaths.length}`:jobPaths.length===1?passed?config.complete:errors[0]||'处理失败':`${config.action}完成：成功 ${passed}，失败 ${failed}${passed+failed<jobPaths.length?`，未处理 ${jobPaths.length-passed-failed}`:''}`;running=false;render();})().catch(error=>{running=false;status.textContent=errorMessage(error);render();});};
 cancel.onclick=()=>{cancelRequested=true;cancel.disabled=true;void api.imageAiCancel().catch(toast);};
 reveal.onclick=()=>{const result=results[selected];if(result)void api.revealFile(result.output).catch(toast);};
 const unsubscribe=config.onProgress(progress);void config.modelStatus().then(value=>{ready=value.ready;modelLabel.textContent=ready?'模型已缓存，可离线使用':`首次使用需下载 ${megabytes(value.bytes)} 模型（${config.license}）`;render();}).catch(error=>{modelLabel.textContent=`模型状态检查失败：${errorMessage(error)}`;render();});render();
 return {dispose(){unsubscribe();if(running)void api.imageAiCancel();}};
}
