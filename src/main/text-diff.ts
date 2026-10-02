import type {Change} from 'diff';
import type {FileToolRow} from '../shared/file-tools';

type Piece={text:string;line:number;count:number};
function pieces(values:string[]){
 const result:Piece[]=[];let line=0;
 for(const value of values){
  for(let at=0;at<value.length;){
   let end=Math.min(value.length,at+16000),newline=at,lines=0;
   while((newline=value.indexOf('\n',newline))>=0&&newline<end){lines++;if(lines===80){end=newline+1;break;}newline++;}
   // Keep Unicode pairs intact at the record boundary.
   if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end--;
   const text=value.slice(at,end);result.push({text,line,count:lines+(text.endsWith('\n')?0:1)});line+=lines;at=end;
  }
 }
 return result;
}

/** Pair replacements without splitting an entire large text into temporary line arrays. */
export function textDiffRows(changes:Change[]){
 const rows:FileToolRow[]=[];let oldLine=1,newLine=1,addedLines=0,removedLines=0;
 for(let at=0;at<changes.length;at++){
  const change=changes[at];if(!change.added&&!change.removed){oldLine+=change.count||0;newLine+=change.count||0;continue;}
  const oldStart=oldLine,newStart=newLine,left:string[]=[],right:string[]=[];
  while(at<changes.length&&(changes[at].added||changes[at].removed)){
   const c=changes[at],count=c.count||0;if(c.removed){left.push(c.value);removedLines+=count;oldLine+=count;}else{right.push(c.value);addedLines+=count;newLine+=count;}at++;
  }
  at--;
  const old=pieces(left),next=pieces(right);for(let n=0;n<Math.max(old.length,next.length);n++)rows.push({id:rows.length,status:left.length&&right.length?'修改':left.length?'删除':'新增',oldLine:old[n]?oldStart+old[n].line:oldLine,newLine:next[n]?newStart+next[n].line:newLine,count:Math.max(old[n]?.count||0,next[n]?.count||0),leftText:old[n]?.text||'',rightText:next[n]?.text||''});
 }
 return{rows,stats:{addedLines,removedLines,leftLines:oldLine-1,rightLines:newLine-1}};
}
