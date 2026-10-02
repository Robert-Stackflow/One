import {diffLines,type Change} from 'diff';

const lineCount=(text:string)=>{let lines=0;for(let at=0;(at=text.indexOf('\n',at))>=0;at++)lines++;return lines+(text.length&&!text.endsWith('\n')?1:0);};
const key=(line:string,ignoreWhitespace:boolean)=>ignoreWhitespace?line.trim():line;

/** Keep dense changes bounded; anchors preserve ordered common lines between blocks. */
export function compareTextLines(left:string,right:string,ignoreWhitespace:boolean){
 left=left.replace(/\r\n/g,'\n');right=right.replace(/\r\n/g,'\n');
 const leftCount=lineCount(left),rightCount=lineCount(right);
 if(left===right)return{changes:left?[{value:right,count:rightCount} as Change]:[],grouped:false};
 // Myers gives precise small edits, but its edit frontier is expensive on dense rewrites.
 if(left.length+right.length<=2*1024*1024&&Math.max(leftCount,rightCount)<=250000){
  const precise=diffLines(left,right,{ignoreWhitespace,timeout:250,maxEditLength:512});
  if(precise)return{changes:precise,grouped:false};
 }
 const changes:Change[]=[];
 const append=(value:string,count:number,added=false,removed=false)=>{
  if(!value)return;const previous=changes.at(-1);
  if(previous&&!!previous.added===added&&!!previous.removed===removed){previous.value+=value;previous.count+=count;}
  else changes.push({value,count,added,removed});
 };
 // Millions of short lines should not create millions of tokens or a huge anchor map.
 if(Math.max(leftCount,rightCount)>250000){
  let a=0,b=0,prefix=0,ae=left.length,be=right.length,suffix=0;
  while(a<ae&&b<be){const an=left.indexOf('\n',a),bn=right.indexOf('\n',b),nextA=an<0?ae:an+1,nextB=bn<0?be:bn+1;if(key(left.slice(a,nextA),ignoreWhitespace)!==key(right.slice(b,nextB),ignoreWhitespace))break;a=nextA;b=nextB;prefix++;}
  while(a<ae&&b<be){const fromA=left.lastIndexOf('\n',left[ae-1]==='\n'?ae-2:ae-1)+1,fromB=right.lastIndexOf('\n',right[be-1]==='\n'?be-2:be-1)+1;if(fromA<a||fromB<b||key(left.slice(fromA,ae),ignoreWhitespace)!==key(right.slice(fromB,be),ignoreWhitespace))break;ae=fromA;be=fromB;suffix++;}
  append(right.slice(0,b),prefix);append(left.slice(a,ae),leftCount-prefix-suffix,false,true);append(right.slice(b,be),rightCount-prefix-suffix,true);append(right.slice(be),suffix);
  return{changes,grouped:true};
 }
 const old=left.match(/[^\n]*\n|[^\n]+$/g)||[],next=right.match(/[^\n]*\n|[^\n]+$/g)||[];
 // Sample at most 20,000 candidates, and retain only unambiguous right-side matches.
 const candidates=new Map<string,{old:number;next:number}>(),stride=Math.max(1,Math.ceil(old.length/20000));
 for(let i=0;i<old.length;i+=stride){const text=key(old[i],ignoreWhitespace),existing=candidates.get(text);if(existing)existing.old=-1;else candidates.set(text,{old:i,next:-1});}
 for(let i=0;i<next.length;i++){const item=candidates.get(key(next[i],ignoreWhitespace));if(item&&item.old>=0)item.next=item.next===-1?i:-2;}
 const matches=[...candidates.values()].filter(item=>item.old>=0&&item.next>=0).sort((a,b)=>a.old-b.old);
 // Longest increasing subsequence prevents moved/repeated lines from crossing anchors.
 const tails:number[]=[],previous=new Int32Array(matches.length).fill(-1);
 for(let i=0;i<matches.length;i++){let lo=0,hi=tails.length;while(lo<hi){const mid=(lo+hi)>>>1;if(matches[tails[mid]].next<matches[i].next)lo=mid+1;else hi=mid;}if(lo)previous[i]=tails[lo-1];tails[lo]=i;}
 const anchors:typeof matches=[];for(let i=tails.at(-1)??-1;i>=0;i=previous[i])anchors.push(matches[i]);anchors.reverse();
 let a=0,b=0;const deadline=Date.now()+500;
 const gap=(endA:number,endB:number)=>{
  const startB=b;let prefix=0;while(a<endA&&b<endB&&key(old[a],ignoreWhitespace)===key(next[b],ignoreWhitespace)){a++;b++;prefix++;}
  append(next.slice(startB,b).join(''),prefix);
  let tailA=endA,tailB=endB;while(a<tailA&&b<tailB&&key(old[tailA-1],ignoreWhitespace)===key(next[tailB-1],ignoreWhitespace)){tailA--;tailB--;}
  const removed=old.slice(a,tailA).join(''),added=next.slice(b,tailB).join('');
  const precise=tailA-a+tailB-b<=256&&Date.now()<deadline?diffLines(removed,added,{ignoreWhitespace,timeout:10,maxEditLength:64}):undefined;
  if(precise)for(const change of precise)append(change.value,change.count,!!change.added,!!change.removed);
  else{append(removed,tailA-a,false,true);append(added,tailB-b,true);}
  append(next.slice(tailB,endB).join(''),endB-tailB);a=endA;b=endB;
 };
 for(const anchor of anchors){gap(anchor.old,anchor.next);append(next[anchor.next],1);a++;b++;}gap(old.length,next.length);
 return{changes,grouped:true};
}
