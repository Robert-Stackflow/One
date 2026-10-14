import {textBounds} from './text-document';
import type {ImageTranslationBlock,TranslationRect} from './image-translation';
export interface TranslationRaster {width:number;height:number;data:Uint8ClampedArray}
export interface TranslationBackground {kind:'flat'|'plate';color:string;textColor:string;pixels:number;sourceRect:TranslationRect}
/** Read only the frozen source. Repair is constrained to OCR glyph boxes; horizontal rules stay intact. */
export function repairTranslationBackground(source:TranslationRaster,output:TranslationRaster,block:ImageTranslationBlock):TranslationBackground {
  const {width,height,data}=source;
  const extent=block.glyphs.reduce((value,quad)=>{const box=textBounds(quad);return {left:Math.min(value.left,box.x),top:Math.min(value.top,box.y),right:Math.max(value.right,box.x+box.width),bottom:Math.max(value.bottom,box.y+box.height)};},{left:Infinity,top:Infinity,right:0,bottom:0});
  const x=Math.max(0,Math.floor(extent.left)-1),y=Math.max(0,Math.floor(extent.top)-1),rect={x,y,width:Math.min(width,Math.ceil(extent.right)+1)-x,height:Math.min(height,Math.ceil(extent.bottom)+1)-y};
  if(output.width!==width||output.height!==height||output.data.length!==data.length)throw Error('图片像素尺寸不一致');
  const samples:number[][]=[];
  const sample=(x:number,y:number)=>{x=Math.max(0,Math.min(width-1,Math.round(x)));y=Math.max(0,Math.min(height-1,Math.round(y)));const at=(y*width+x)*4;samples.push([data[at],data[at+1],data[at+2],data[at+3]]);};
  for(let i=0;i<=24;i++){const t=i/24;sample(rect.x+rect.width*t,rect.y-2);sample(rect.x+rect.width*t,rect.y+rect.height+1);sample(rect.x-2,rect.y+rect.height*t);sample(rect.x+rect.width+1,rect.y+rect.height*t);}
  const background=[0,1,2,3].map(channel=>samples.map(item=>item[channel]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
  const flat=samples.filter(item=>item.every((value,index)=>Math.abs(value-background[index])<22)).length/samples.length>.85&&background[3]>245;
  const color=`rgb(${background.slice(0,3).join(',')})`,textColor=background[0]*.299+background[1]*.587+background[2]*.114>140?'#202020':'#ffffff';
  if(!flat||block.glyphs.some(quad=>{const box=textBounds(quad);return box.width*box.height>2_000_000;}))return {kind:'plate',color:'#ffffff',textColor:'#202020',pixels:0,sourceRect:rect};
  let pixels=0;
  for(const quad of block.glyphs){
    const box=textBounds(quad),left=Math.max(0,Math.floor(box.x)-1),top=Math.max(0,Math.floor(box.y)-1);
    const right=Math.min(width,Math.ceil(box.x+box.width)+1),bottom=Math.min(height,Math.ceil(box.y+box.height)+1);
    const w=right-left,h=bottom-top;if(w<=0||h<=0)continue;
    const mask=new Uint8Array(w*h),queue=new Uint32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=((top+y)*width+left+x)*4;if(data[at+3]>0&&Math.max(Math.abs(data[at]-background[0]),Math.abs(data[at+1]-background[1]),Math.abs(data[at+2]-background[2]))>8)mask[y*w+x]=1;}
    for(let start=0;start<mask.length;start++){
      if(mask[start]!==1)continue;
      let count=1,head=0,minX=w,minY=h,maxX=0,maxY=0;queue[0]=start;mask[start]=2;
      while(head<count){const at=queue[head++],x=at%w,y=Math.floor(at/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const next of [x>0?at-1:-1,x+1<w?at+1:-1,y>0?at-w:-1,y+1<h?at+w:-1])if(next>=0&&mask[next]===1){mask[next]=2;queue[count++]=next;}}
      // Keep long rules/decoration. No rectangle-wide erase is used for simple backgrounds.
      if(maxX-minX+1>12*(maxY-minY+1)&&h>3*(maxY-minY+1)&&maxX-minX+1>w*.6)continue;
      for(let i=0;i<count;i++){const at=queue[i],x=at%w,y=Math.floor(at/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const offset=((top+y+dy)*width+left+x+dx)*4;
        output.data.set(background,offset);pixels++;
      }}
    }
  }
  return {kind:'flat',color,textColor,pixels,sourceRect:rect};
}
