import {compareTextLines} from '../main/bounded-diff';
import {streamTextDiffRows} from '../main/text-diff';
import type {FileToolRow} from '../shared/file-tools';

self.onmessage=(event:MessageEvent<{id:number;left:string;right:string;ignoreWhitespace:boolean}>)=>{
 const {id,left,right,ignoreWhitespace}=event.data;
 try{
  if(typeof left!=='string'||typeof right!=='string'||left.length>200_000||right.length>200_000||typeof ignoreWhitespace!=='boolean')throw Error('两侧文本各不能超过 200,000 字符');
  const comparison=compareTextLines(left,right,ignoreWhitespace),rows:FileToolRow[]=[];let characters=0;
  const {count,stats}=streamTextDiffRows(comparison.changes,row=>{const size=(typeof row.leftText==='string'?row.leftText.length:0)+(typeof row.rightText==='string'?row.rightText.length:0);if(rows.length<500&&characters+size<=200_000){rows.push(row);characters+=size;}});
  self.postMessage({id,result:{rows,count,stats,grouped:comparison.grouped}});
 }catch(error){self.postMessage({id,error:(error as Error).message});}
};
