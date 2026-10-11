export interface ImagePaletteColor {hex:string;percent:number}
type Bin={count:number;r:number;g:number;b:number};

/** Extract representative colors from a bounded, RGBA preview. Transparent pixels are ignored. */
export function extractImagePalette(pixels:Uint8ClampedArray|Uint8Array,width:number,height:number,limit=8):ImagePaletteColor[]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>256*256||pixels.length!==width*height*4||!Number.isInteger(limit)||limit<1||limit>12)throw Error('调色板样本无效');
 const histogram=new Map<number,Bin>();let total=0;
 for(let offset=0;offset<pixels.length;offset+=4){
  const alpha=pixels[offset+3];if(alpha<16)continue;
  const blend=(channel:number)=>Math.round((pixels[offset+channel]*alpha+255*(255-alpha))/255);
  const r=blend(0),g=blend(1),b=blend(2),key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
  const bin=histogram.get(key);if(bin){bin.count++;bin.r+=r;bin.g+=g;bin.b+=b;}else histogram.set(key,{count:1,r,g,b});total++;
 }
 if(!total)return [];
 const boxes:Bin[][]=[[...histogram.values()]];
 while(boxes.length<limit){
  let chosen=-1,channel:0|1|2=0,best=-1;
  for(let index=0;index<boxes.length;index++){
   const box=boxes[index];if(box.length<2)continue;
   const mins=[255,255,255],maxs=[0,0,0];let count=0;
   for(const bin of box){const values=[bin.r/bin.count,bin.g/bin.count,bin.b/bin.count];for(let c=0;c<3;c++){mins[c]=Math.min(mins[c],values[c]);maxs[c]=Math.max(maxs[c],values[c]);}count+=bin.count;}
   const ranges=maxs.map((value,c)=>value-mins[c]),axis=ranges.indexOf(Math.max(...ranges)) as 0|1|2,score=ranges[axis]*count;
   if(score>best){best=score;chosen=index;channel=axis;}
  }
  if(chosen<0)break;
  const box=boxes[chosen],value=(bin:Bin)=>[bin.r,bin.g,bin.b][channel]/bin.count;
  box.sort((left,right)=>value(left)-value(right));const half=box.reduce((sum,bin)=>sum+bin.count,0)/2;
  let sum=0,split=1;for(let index=0;index<box.length-1;index++){sum+=box[index].count;if(sum>=half){split=index+1;break;}}
  boxes.splice(chosen,1,box.slice(0,split),box.slice(split));
 }
 return boxes.map(box=>{const count=box.reduce((sum,bin)=>sum+bin.count,0),channels=[0,1,2].map(channel=>Math.round(box.reduce((sum,bin)=>sum+[bin.r,bin.g,bin.b][channel],0)/count));return {hex:'#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase(),percent:Math.round(count/total*1000)/10,count};}).sort((left,right)=>right.count-left.count||left.hex.localeCompare(right.hex)).map(({hex,percent})=>({hex,percent}));
}
