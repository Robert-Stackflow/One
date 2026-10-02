import {icon,iconButton,esc,toast} from './ui';
import type {PreviewData} from '../shared/types';

export function renderMedia(host:HTMLElement,data:PreviewData,metadata:(values:Record<string,string>)=>void){
  const audio=/\.(mp3|wav|ogg|m4a|flac|opus|aac)$/i.test(data.path);
  const lyrics=data.lyrics||[];
  host.innerHTML=`${audio&&data.cover?`<img class="media-backdrop" src="${esc(data.cover)}" alt="">`:''}<div class="media-stage ${audio?'audio-stage'+(lyrics.length?'':' no-lyrics'):''}">${audio?`<div class="music-album"><div class="audio-art">${data.cover?`<img src="${esc(data.cover)}" alt="专辑封面">`:icon('music')}</div><h2>${esc(data.metadata?.['标题']||data.name.replace(/\.[^.]+$/,''))}</h2><p>${esc([data.metadata?.['艺术家'],data.metadata?.['专辑']].filter(Boolean).join(' · '))}</p></div>${lyrics.length?'<div class="music-lyrics" aria-label="歌词"></div>':''}`:''}</div><div class="media-controls"><div class="media-timeline"><span id="media-time">0:00</span><input type="range" id="media-seek" aria-label="播放进度" min="0" max="1" step="0.01" value="0"><span id="media-duration">0:00</span></div><div class="media-actions">${audio?'':iconButton('media-fullscreen','全屏','expand')}${iconButton('media-back','后退 10 秒','rewind')}${iconButton('media-play','暂停','pause')}${iconButton('media-forward','前进 10 秒','forward')}<div class="media-volume-group">${iconButton('media-mute','静音','volume')}<input type="range" id="media-volume" aria-label="音量" min="0" max="100" value="100"></div></div></div>`;
  const media=document.createElement(audio?'audio':'video');media.autoplay=true;media.preload='auto';media.src=data.url!;host.querySelector('.media-stage')!.prepend(media);
  const get=<T extends HTMLElement>(id:string)=>host.querySelector<T>('#'+id)!;
  const seek=get<HTMLInputElement>('media-seek'),volume=get<HTMLInputElement>('media-volume');let scrubbing=false,disposed=false,lyricIndex=-1,manualScroll=0;
  const events=new AbortController();const on=(target:EventTarget,name:string,callback:EventListener)=>target.addEventListener(name,callback,{signal:events.signal});
  const lyricHost=host.querySelector<HTMLElement>('.music-lyrics');
  if(lyricHost){for(const line of lyrics.slice(0,3000)){const row=document.createElement('button');row.textContent=line.text||'♪';row.tabIndex=line.time>=0?0:-1;row.onclick=()=>{if(line.time>=0&&Number.isFinite(media.duration)){media.currentTime=Math.min(media.duration,line.time);updateLyrics();}};lyricHost.append(row);}on(lyricHost,'wheel',()=>manualScroll=Date.now()+3000);}
  const updateLyrics=()=>{if(!lyricHost)return;let index=-1;for(let i=0;i<Math.min(lyrics.length,3000);i++){if(lyrics[i].time>=0&&lyrics[i].time<=media.currentTime)index=i;}if(index===lyricIndex)return;lyricHost.children[lyricIndex]?.classList.remove('current');lyricIndex=index;const current=lyricHost.children[index] as HTMLElement|undefined;current?.classList.add('current');if(current&&Date.now()>manualScroll)lyricHost.scrollTo({top:current.offsetTop-lyricHost.offsetTop-lyricHost.clientHeight/2+current.clientHeight/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
  const time=(n:number)=>{if(!Number.isFinite(n))return '0:00';const total=Math.floor(n);return total>=3600?`${Math.floor(total/3600)}:${String(Math.floor(total/60)%60).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`:`${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;};
  const fill=(input:HTMLInputElement)=>input.style.setProperty('--range-progress',`${Number(input.value)/Number(input.max)*100}%`);
  const update=()=>{if(disposed)return;const duration=Number.isFinite(media.duration)?media.duration:0;seek.max=String(duration||1);seek.disabled=!duration;if(!scrubbing){seek.value=String(media.currentTime);get('media-time').textContent=time(media.currentTime);fill(seek);}get('media-duration').textContent=time(duration);updateLyrics();};
  const state=()=>{if(disposed)return;get('media-play').innerHTML=icon(media.paused?'play':'pause');get('media-play').setAttribute('aria-label',media.paused?'播放':'暂停');get('media-play').title=media.paused?'播放':'暂停';};
  const toggle=()=>{if(media.paused)void media.play().catch(()=>toast('点击播放重试'));else media.pause();};
  const commit=()=>{if(disposed)return;if(Number.isFinite(media.duration))media.currentTime=Math.min(media.duration,Math.max(0,Number(seek.value)));scrubbing=false;update();};
  on(media,'timeupdate',update);on(media,'seeked',update);on(media,'durationchange',update);on(media,'play',state);on(media,'pause',state);
  on(media,'loadedmetadata',()=>{update();metadata({'时长':time(media.duration),...(media instanceof HTMLVideoElement?{'尺寸':`${media.videoWidth} × ${media.videoHeight}`}:{})});});
  on(media,'error',()=>{if(!disposed)toast('当前编码无法播放，请用默认程序打开');});
  on(seek,'pointerdown',()=>{scrubbing=true;});on(seek,'input',()=>{scrubbing=true;get('media-time').textContent=time(Number(seek.value));fill(seek);});on(seek,'change',commit);on(seek,'pointerup',commit);on(seek,'pointercancel',()=>{scrubbing=false;update();});on(seek,'blur',()=>{if(scrubbing)commit();});
  on(volume,'input',()=>{media.volume=Number(volume.value)/100;media.muted=false;fill(volume);get('media-mute').innerHTML=icon(media.volume?'volume':'volume-off');});
  on(get('media-play'),'click',toggle);on(get('media-mute'),'click',()=>{media.muted=!media.muted;get('media-mute').innerHTML=icon(media.muted?'volume-off':'volume');get('media-mute').setAttribute('aria-label',media.muted?'取消静音':'静音');});
  on(get('media-back'),'click',()=>{media.currentTime=Math.max(0,media.currentTime-10);});on(get('media-forward'),'click',()=>{if(Number.isFinite(media.duration))media.currentTime=Math.min(media.duration,media.currentTime+10);});
  if(!audio)on(get('media-fullscreen'),'click',()=>{if(document.fullscreenElement)void document.exitFullscreen();else void host.requestFullscreen().catch(toast);});
  fill(volume);update();void media.play().catch(()=>{if(!disposed)state();});
  const dispose=()=>{if(disposed)return;disposed=true;events.abort();media.pause();media.removeAttribute('src');media.load();};
  return {media,toggle,dispose};
}
