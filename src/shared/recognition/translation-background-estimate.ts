import type {TranslationRaster} from './image-translation-background';
import type {TranslationRect} from './image-translation';
export type BackgroundEstimate={kind:'flat'|'gradient';at(x:number,y:number):number[]}|undefined;
interface Sample {x:number;y:number;rgb:number[];u:number;v:number}
/** Small robust plane fit. Text on the sampling ring is treated as an outlier, never averaged into the fill. */
export function estimateTranslationBackground(source:TranslationRaster,rect:TranslationRect,glyphs:TranslationRect[]):BackgroundEstimate {
  const samples:Sample[]=[],positions=new Set<number>();
  const sample=(x:number,y:number)=>{x=Math.max(0,Math.min(source.width-1,Math.round(x)));y=Math.max(0,Math.min(source.height-1,Math.round(y)));const at=y*source.width+x;if(positions.has(at))return;positions.add(at);samples.push({x,y,rgb:[...source.data.subarray(at*4,at*4+4)],u:(x-rect.x)/Math.max(1,rect.width)-.5,v:(y-rect.y)/Math.max(1,rect.height)-.5});};
  for(let i=0;i<=24;i++){const t=i/24;sample(rect.x+rect.width*t,rect.y-2);sample(rect.x+rect.width*t,rect.y+rect.height+1);sample(rect.x-2,rect.y+rect.height*t);sample(rect.x+rect.width+1,rect.y+rect.height*t);}
  if(samples.some(item=>item.rgb[3]<245))return undefined;
  const median=[0,1,2].map(channel=>samples.map(item=>item.rgb[channel]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
  const difference=(a:number[],b:number[])=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
  let estimate:BackgroundEstimate;
  if(samples.filter(item=>difference(item.rgb,median)<=4).length/samples.length>=.9)estimate={kind:'flat',at:()=>[...median,255]};
  else {
    const fit=(items:Sample[])=>{
      const matrix=[[0,0,0],[0,0,0],[0,0,0]],values=[[0,0,0],[0,0,0],[0,0,0]];
      for(const item of items){const point=[1,item.u,item.v];for(let row=0;row<3;row++){for(let column=0;column<3;column++)matrix[row][column]+=point[row]*point[column];for(let channel=0;channel<3;channel++)values[row][channel]+=point[row]*item.rgb[channel];}}
      const rows=matrix.map((row,index)=>[...row,...values[index]]);
      for(let column=0;column<3;column++){let pivot=column;for(let row=column+1;row<3;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
        if(Math.abs(rows[pivot][column])<1e-8)return undefined;[rows[pivot],rows[column]]=[rows[column],rows[pivot]];const factor=rows[column][column];for(let i=column;i<6;i++)rows[column][i]/=factor;
        for(let row=0;row<3;row++)if(row!==column){const scale=rows[row][column];for(let i=column;i<6;i++)rows[row][i]-=scale*rows[column][i];}}
      return (x:number,y:number)=>[0,1,2].map(channel=>rows[0][channel+3]+rows[1][channel+3]*((x-rect.x)/Math.max(1,rect.width)-.5)+rows[2][channel+3]*((y-rect.y)/Math.max(1,rect.height)-.5));
    };
    let plane=fit(samples);if(!plane)return undefined;
    for(let iteration=0;iteration<2;iteration++){const prediction=plane,ordered=[...samples].sort((a,b)=>difference(a.rgb,prediction(a.x,a.y))-difference(b.rgb,prediction(b.x,b.y)));plane=fit(ordered.slice(0,Math.ceil(samples.length*.8)));if(!plane)return undefined;}
    if(samples.filter(item=>difference(item.rgb,plane!(item.x,item.y))<=6).length/samples.length<.88)return undefined;
    const corners=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x+rect.width,rect.y+rect.height],[rect.x,rect.y+rect.height]].map(([x,y])=>plane!(x,y));
    if(corners.some(color=>color.some(value=>value<-6||value>261)))return undefined;
    const brightness=corners.map(color=>color[0]*.299+color[1]*.587+color[2]*.114);
    if(Math.min(...brightness)<100&&Math.max(...brightness)>180)return undefined;
    const prediction=plane;estimate={kind:'gradient',at:(x,y)=>[...prediction(x,y).map(value=>Math.max(0,Math.min(255,Math.round(value)))),255]};
  }
  // Probe non-text gaps too: a quiet outer ring alone does not prove the interior is a simple background.
  let checked=0,matched=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const px=Math.max(0,Math.min(source.width-1,Math.floor(rect.x+(x+.37)/8*rect.width))),py=Math.max(0,Math.min(source.height-1,Math.floor(rect.y+(y+.61)/8*rect.height)));
    if(glyphs.some(box=>px>=box.x-1&&px<=box.x+box.width+1&&py>=box.y-1&&py<=box.y+box.height+1))continue;checked++;const at=(py*source.width+px)*4;if(source.data[at+3]>=245&&difference([...source.data.subarray(at,at+3)],estimate.at(px,py))<=6)matched++;}
  return checked&&matched/checked<.9?undefined:estimate;
}
