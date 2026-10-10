import {LineCounter,parseDocument,stringify} from 'yaml';
import {parser as jsonParser} from '@lezer/json';

export type DeveloperDataFormat='json'|'yaml';
export type DeveloperDataAction='format'|'compact'|'validate'|'convert';
export interface DeveloperDataRequest {source:DeveloperDataFormat;action:DeveloperDataAction;text:string}
export interface DeveloperDataResult {text:string;format:DeveloperDataFormat;message:string}

export class DeveloperDataError extends Error {
 constructor(message:string,public line=1,public column=1){super(message);this.name='DeveloperDataError';}
}

function jsonLocation(text:string,message:string){
 const direct=/line (\d+) column (\d+)/i.exec(message);
 if(direct)return {line:Number(direct[1]),column:Number(direct[2])};
 let offset:number|undefined;
 jsonParser.parse(text).iterate({enter:node=>{if(node.type.isError&&offset===undefined)offset=node.from;}});
 const match=/position (\d+)/i.exec(message);offset??=match?Math.min(Number(match[1]),text.length):text.length;
 const before=text.slice(0,offset),lines=before.split(/\r\n|\r|\n/);
 return {line:lines.length,column:lines.at(-1)!.length+1};
}

export function transformDeveloperData(request:DeveloperDataRequest):DeveloperDataResult{
 const {source,action,text}=request;
 if(source!=='json'&&source!=='yaml'||!['format','compact','validate','convert'].includes(action)||typeof text!=='string')throw new DeveloperDataError('操作无效');
 if(text.length>5*1024*1024)throw new DeveloperDataError('输入超过 5 MB 上限');
 let value:unknown;let document:ReturnType<typeof parseDocument>|undefined;
 if(source==='json'){
  try{value=JSON.parse(text);}catch(error){const message=(error as Error).message,{line,column}=jsonLocation(text,message);throw new DeveloperDataError(`JSON 语法错误：${message}`,line,column);}
 }else{
  const counter=new LineCounter();document=parseDocument(text,{uniqueKeys:true,lineCounter:counter});
  if(document.errors.length){const error=document.errors[0],position=counter.linePos(error.pos[0]);throw new DeveloperDataError(`YAML 语法错误：${error.message}`,position.line||1,position.col||1);}
  try{value=document.toJS({maxAliasCount:50});}catch(error){throw new DeveloperDataError(`YAML 内容无法展开：${(error as Error).message}`);}
 }
 if(action==='validate')return {text:'',format:source,message:`${source.toUpperCase()} 语法有效`};
 const format:DeveloperDataFormat=action==='convert'?(source==='json'?'yaml':'json'):source;
 let output:string;
 if(action==='format'&&document)output=document.toString({indent:2,lineWidth:0});
 else if(format==='json')output=JSON.stringify(value,null,action==='compact'?undefined:2);
 else output=stringify(value,{indent:2,lineWidth:0,collectionStyle:action==='compact'?'flow':'block'});
 if(output.length>10*1024*1024)throw new DeveloperDataError('结果超过 10 MB 上限');
 const label=action==='convert'?`已转换为 ${format.toUpperCase()}`:action==='compact'?'已压缩':'已格式化';
 return {text:output,format,message:label};
}
