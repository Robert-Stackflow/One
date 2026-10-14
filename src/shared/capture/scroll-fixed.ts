import {scrollSearchCandidates,scrollLocallyConsistent} from './scroll-search';
export interface FixedEdges {start:number;end:number}
/** Require a unique moving body, identical edges and evidence beyond ordinary blank margins. */
export function detectScrollFixedEdges(a:Uint8Array,b:Uint8Array,axis:number,cross:number,left:number,right:number,omit?:(oldRow:number,newRow:number,x:number)=>boolean):FixedEdges|undefined {
  const margin=Math.min(128,Math.floor(axis*.2)),body=axis-margin*2;if(body<64)return;
  const first=a.subarray(margin*cross*4,(axis-margin)*cross*4),second=b.subarray(margin*cross*4,(axis-margin)*cross*4);
  const score=(shift:number)=>{
    const from=Math.max(0,-shift),to=Math.min(body,body-shift);let sum=0,count=0;
    for(let row=from;row<to;row+=Math.max(1,Math.floor((to-from)/64)))for(let x=left;x<right;x+=Math.max(1,Math.floor((right-left)/24))){if(omit?.(row+shift+margin,row+margin,x))continue;for(let c=0;c<3;c++){sum+=Math.abs(first[((row+shift)*cross+x)*4+c]-second[(row*cross+x)*4+c]);count++;}}
    return count?sum/count:Infinity;
  };
  const guesses=scrollSearchCandidates(first,second,body,cross,left,right).map(shift=>({shift,score:score(shift)})).sort((a,b)=>a.score-b.score),best=guesses[0];
  if(!best||best.shift<=0||best.score>1)return;
  const runner=guesses.find(item=>Math.abs(item.shift-best.shift)>3);
  if(runner&&runner.score<best.score+2)return;
  const rowSame=(row:number)=>{let error=0,count=0;for(let x=left;x<right;x+=Math.max(1,Math.floor((right-left)/32)))for(let c=0;c<3;c++){const at=(row*cross+x)*4+c;error+=Math.abs(a[at]-b[at]);count++;}return error/count<.25;};
  let start=0,end=0;while(start<margin&&rowSame(start))start++;while(end<margin&&rowSame(axis-end-1))end++;
  if(start===margin)start=0;if(end===margin)end=0;if(start<4)start=0;if(end<4)end=0;if(!start&&!end)return;
  const median=(values:number[])=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)];};
  const samples=(from:number,to:number)=>{const channels=[[],[],[]] as number[][];for(let row=from;row<to;row+=Math.max(1,Math.floor((to-from)/8)))for(let x=left;x<right;x+=Math.max(1,Math.floor((right-left)/24)))for(let c=0;c<3;c++)channels[c].push(a[(row*cross+x)*4+c]);return channels;};
  const center=samples(margin,axis-margin).map(median),distinct=(from:number,to:number)=>{const values=samples(from,to);return values.some((channel,c)=>Math.abs(median(channel)-center[c])>=6||channel.at(-1)!-channel[0]>=24);};
  if(start&&!distinct(0,start))start=0;if(end&&!distinct(axis-end,axis))end=0;if(!start&&!end)return;
  const length=axis-start-end,old=a.subarray(start*cross*4,(axis-end)*cross*4),next=b.subarray(start*cross*4,(axis-end)*cross*4);
  if(!scrollLocallyConsistent(old,next,length,cross,left,right,best.shift,omit?(a,b,x)=>omit(a+start,b+start,x):undefined))return;
  return {start,end};
}
