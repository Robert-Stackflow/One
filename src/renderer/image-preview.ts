import type {PreviewData} from '../shared/types';
import {api,icon,iconButton,toast,errorMessage} from './ui';

type Surface=HTMLImageElement|HTMLCanvasElement;
/** All asynchronous work belongs to this file selection, including the decoder and video track. */
export function renderImage(body:HTMLElement,data:PreviewData,controls:HTMLElement,onSurface:(surface:Surface,width:number,height:number)=>void,metadata:(values:Record<string,string>)=>void){
 const stage=document.createElement('div'),visual=document.createElement('div'),photo=document.createElement('img');
 stage.className='image-stage';visual.className='photo-visual';photo.alt=data.name;photo.draggable=false;visual.append(photo);stage.append(visual);body.append(stage);
 let alive=true,stillURL:string|undefined,decoder:ImageDecoder|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const abort=new AbortController();let epoch=0,pending:{index:number;epoch:number}|undefined,decoding=false,playing=true,index=0,loops=0,frameCount=0,repetitions=0;
 let canvas:HTMLCanvasElement|undefined,video:HTMLVideoElement|undefined,motionPlaying=false,stillFailed=false;
 let cancelMotionExport=()=>{};
 let makePoster=()=>{};
 const clearTimer=()=>{clearTimeout(timer);timer=undefined;};
 const button=(name:string,title:string,glyph:string,run:()=>void)=>{const holder=document.createElement('span');holder.innerHTML=iconButton('image-'+name,title,glyph);const b=holder.firstElementChild as HTMLButtonElement;b.onclick=run;controls.append(b);return b;};
 const label=(b:HTMLButtonElement,title:string,glyph:string)=>{b.title=title;b.setAttribute('aria-label',title);b.innerHTML=icon(glyph);};
 const surface=(node:Surface,width:number,height:number,preview=false)=>{if(!alive||!width||!height)return;metadata({[preview?'预览尺寸':'尺寸']:width+' × '+height});onSurface(node,width,height);};
 const unsupported=(message:string)=>{if(!alive)return;stage.classList.add('image-unavailable');const hint=document.createElement('p');hint.className='image-preview-hint';hint.textContent=message;stage.append(hint);};
 photo.onload=()=>{if(alive&&photo.isConnected)surface(photo,photo.naturalWidth,photo.naturalHeight,!!stillURL);};
 photo.onerror=()=>{void (async()=>{
   if(!alive)return;
   const fallback=await api.previewStillImage(data.url!).catch(()=>null);
   if(!alive){if(fallback)void api.previewReleaseDisplayImage(fallback).catch(()=>{});return;}
   if(fallback){stillURL=fallback;data.cover=fallback;photo.onerror=()=>{if(data.motionPhoto){stillFailed=true;photo.hidden=true;makePoster();}else unsupported('图片无法解码，请用默认程序打开');};photo.src=fallback;metadata({'照片预览':'系统图片解码（缩略预览）'});}
   else if(data.motionPhoto){stillFailed=true;photo.hidden=true;makePoster();}
   else unsupported('系统尚未提供此图片的解码支持，请用默认程序打开');
 })();};
 photo.src=data.url!;

 let play:HTMLButtonElement|undefined;
 const updateAnimation=()=>{if(play)label(play,playing?'暂停动画':'播放动画',playing?'pause':'play');};
 async function pump(){
  if(decoding)return;decoding=true;
  try{while(alive&&pending&&decoder){const job=pending;pending=undefined;let frame:VideoFrame|undefined;
    try{const result=await decoder.decode({frameIndex:job.index,completeFramesOnly:true});frame=result.image;
     if(!alive||job.epoch!==epoch)continue;
     if(!canvas){canvas=document.createElement('canvas');canvas.className='animated-image';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',data.name);canvas.width=frame.displayWidth;canvas.height=frame.displayHeight;photo.replaceWith(canvas);photo.removeAttribute('src');surface(canvas,canvas.width,canvas.height);}
     const context=canvas.getContext('2d')!;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(frame,0,0,canvas.width,canvas.height);index=job.index;
     if(playing&&!document.hidden){const duration=Math.max(20,Math.min(60000,(frame.duration??100000)/1000));timer=setTimeout(()=>{
       timer=undefined;if(!alive||!playing)return;let next=index+1;if(next>=frameCount){next=0;if(loops>=repetitions){playing=false;updateAnimation();return;}loops++;}requestFrame(next);
      },duration);}
    }finally{frame?.close();}
   }}catch{if(alive){clearTimer();playing=false;pending=undefined;epoch++;decoder?.close();decoder=undefined;controls.replaceChildren();canvas?.replaceWith(photo);canvas=undefined;photo.src=data.url!;metadata({'动画播放':'使用浏览器原始播放'});}}
  finally{decoding=false;}
 }
 function requestFrame(next:number){clearTimer();pending={index:next,epoch};void pump();}
 const visibility=()=>{if(!decoder)return;epoch++;pending=undefined;clearTimer();if(!document.hidden&&playing)requestFrame(index);};
 document.addEventListener('visibilitychange',visibility);
 if(data.animated&&!data.motionPhoto)void (async()=>{
  try{if(typeof ImageDecoder==='undefined')return;
   const type=/\.gif$/i.test(data.name)?'image/gif':/\.webp$/i.test(data.name)?'image/webp':/\.avif$/i.test(data.name)?'image/avif':'image/png';
   if(!await ImageDecoder.isTypeSupported(type)||!alive)return;
   const response=await fetch(data.url!,{signal:abort.signal});if(!alive||!response.body)return;
   decoder=new ImageDecoder({data:response.body,type,preferAnimation:true});void decoder.completed.catch(()=>{});
   await decoder.tracks.ready;await decoder.completed;if(!alive)return;
   const track=decoder.tracks.selectedTrack;if(!track||track.frameCount<=1){decoder.close();decoder=undefined;return;}
   const first=await decoder.decode({frameIndex:0});const pixels=first.image.displayWidth*first.image.displayHeight;first.image.close();
   if(!alive)return;if(pixels>32*1024*1024||track.frameCount>10000){decoder.close();decoder=undefined;metadata({'动画播放':'使用浏览器原始播放（动画较大）'});return;}
   frameCount=track.frameCount;repetitions=track.repetitionCount;
   metadata({'动画帧数':String(frameCount),'动画循环':repetitions===Infinity?'无限':String(repetitions+1)+' 次'});
   play=button('play','暂停动画','pause',()=>{epoch++;pending=undefined;clearTimer();playing=!playing;updateAnimation();if(playing){if(index===frameCount-1&&loops>=repetitions){loops=0;requestFrame(0);}else requestFrame(index);}});
   button('restart','重新播放','rewind',()=>{epoch++;playing=true;loops=0;updateAnimation();requestFrame(0);});requestFrame(0);
  }catch{decoder?.close();decoder=undefined;/* Keep the browser image if controlled decoding is unavailable. */}
 })();

 if(data.motionPhoto){
  video=document.createElement('video');video.className='motion-photo-video';video.playsInline=true;video.muted=true;video.preload='metadata';video.hidden=true;visual.append(video);
  const movie=video;let posterMade=false;
  const stopMotion=()=>{motionPlaying=false;movie.pause();movie.hidden=true;if(movie.readyState)movie.currentTime=0;label(motionButton,'播放动态照片','play');};
  const motionButton=button('motion','播放动态照片','play',()=>{if(motionPlaying){stopMotion();return;}motionPlaying=true;movie.hidden=false;label(motionButton,'停止动态照片','pause');void movie.play().catch(()=>{stopMotion();metadata({'动态播放':'视频编码不可用，请用默认程序打开'});});});
  const soundButton=button('sound','开启声音','volume-off',()=>{movie.muted=!movie.muted;label(soundButton,movie.muted?'开启声音':'静音',movie.muted?'volume-off':'volume');});
  let exporting=false;
  cancelMotionExport=()=>{if(exporting)void api.previewMotionExportCancel();};
  const exportButton=button('export-motion','导出原始视频','disk',()=>{
   if(exporting){void api.previewMotionExportCancel();return;}
   exporting=true;label(exportButton,'取消视频导出','stop');metadata({'动态视频导出':'正在导出原始视频…'});
   void api.previewMotionExport().then(path=>{if(alive)metadata({'动态视频导出':path?`已导出 ${path.split(/[\\/]/).pop()}`:'已取消选择'});}).catch(error=>{if(alive){const message=errorMessage(error);metadata({'动态视频导出':message});toast(message);}}).finally(()=>{exporting=false;if(alive)label(exportButton,'导出原始视频','disk');});
  });
  movie.onended=stopMotion;
  makePoster=()=>{if(!alive||posterMade||!stillFailed)return;if(movie.error){unsupported('此照片和视频需要系统解码支持，请用默认程序打开');return;}if(movie.readyState<2){movie.preload='auto';movie.load();return;}
   // HEIC may require an optional system codec. A decoded movie frame is an explicit fallback.
   const poster=document.createElement('canvas');poster.width=movie.videoWidth;poster.height=movie.videoHeight;if(!poster.width||!poster.height||poster.width*poster.height>32*1024*1024)return;
   posterMade=true;poster.getContext('2d')?.drawImage(movie,0,0);photo.replaceWith(poster);const cover=document.createElement('canvas');cover.width=192;cover.height=Math.max(1,Math.round(192*poster.height/poster.width));cover.getContext('2d')?.drawImage(poster,0,0,cover.width,cover.height);data.cover=cover.toDataURL();surface(poster,poster.width,poster.height,true);metadata({'照片预览':'使用动态片段画面'});
  };
  movie.onloadeddata=makePoster;
  movie.onerror=()=>{if(!alive)return;stopMotion();motionButton.disabled=true;soundButton.disabled=true;metadata({'动态播放':'视频编码不可用，请用默认程序打开'});if(stillFailed&&!posterMade)unsupported('此照片和视频需要系统解码支持，请用默认程序打开');};
  movie.src=data.motionPhoto.url;
 }
 return ()=>{alive=false;cancelMotionExport();epoch++;pending=undefined;clearTimer();abort.abort();decoder?.close();document.removeEventListener('visibilitychange',visibility);controls.replaceChildren();photo.onload=photo.onerror=null;photo.removeAttribute('src');if(video){video.onended=video.onerror=video.onloadeddata=null;video.pause();video.removeAttribute('src');video.load();}if(stillURL)void api.previewReleaseDisplayImage(stillURL).catch(()=>{});};
}
