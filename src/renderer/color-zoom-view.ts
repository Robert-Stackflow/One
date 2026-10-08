import './color.css';
import {api,q} from './ui';
import type {ScreenCapture} from '../shared/types';

export async function renderColorZoom(){
 document.documentElement.classList.add('transparent-root');
 document.body.className='color-zoom-window';
 q('app').innerHTML='<div class="color-zoom-frame"><canvas id="color-zoom-canvas" width="300" height="300"></canvas></div>';
 const canvas=q<HTMLCanvasElement>('color-zoom-canvas'),ctx=canvas.getContext('2d')!,source=document.createElement('canvas'),src=source.getContext('2d')!;
 let pending:ScreenCapture|undefined,frame=0;
 const paint=()=>{frame=0;const sample=pending;if(!sample?.zoomFrozen||!sample.data)return;
  source.width=sample.width;source.height=sample.height;const data=new Uint8ClampedArray(sample.data);
  for(let i=0;i<data.length;i+=4){const blue=data[i];data[i]=data[i+2];data[i+2]=blue;}
  src.putImageData(new ImageData(data,sample.width,sample.height),0,0);
  const left=sample.cropX??Math.floor((sample.width-sample.pixels)/2),top=sample.cropY??Math.floor((sample.height-sample.pixels)/2),unit=300/sample.pixels;
  ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,300,300);ctx.drawImage(source,left,top,sample.pixels,sample.pixels,0,0,300,300);
  const x=((sample.centerX??Math.floor(sample.width/2))-left)*unit,y=((sample.centerY??Math.floor(sample.height/2))-top)*unit;
  ctx.strokeStyle='#111b';ctx.lineWidth=4;ctx.strokeRect(x+1,y+1,unit-2,unit-2);
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x+2,y+2,unit-4,unit-4);
 };
 const update=(sample:ScreenCapture)=>{pending=sample;if(!frame)frame=requestAnimationFrame(paint);};
 api.onColorSample(update);const initial=await api.colorCapture();if(initial)update(initial);
}
