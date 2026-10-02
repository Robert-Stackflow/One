import {parseDocument} from 'yaml';
import {decodePreviewText} from '../shared/preview';
import {StructureStore} from '../shared/structured-preview';
import {CsvStore} from '../shared/csv-preview';
let store:StructureStore|undefined;
let table:CsvStore|undefined;
self.onmessage=async(event:MessageEvent)=>{
  try{
  const request=event.data;
  if(request.tableAction){
   if(!table)throw new Error('表格尚未加载');
   const result=request.tableAction==='range'?table.range(request.row,request.column,request.rows,request.columns):request.tableAction==='cell'?table.cell(request.row,request.column):undefined;
   if(result===undefined)throw new Error('表格操作无效');self.postMessage({requestId:request.requestId,result});return;
  }
  if(request.structureAction){
   if(!store)throw new Error('结构化文档尚未加载');
   const result=request.structureAction==='children'?store.children(request.id,request.start,request.count):request.structureAction==='text'?store.text(request.id,request.index):undefined;
   if(result===undefined)throw new Error('结构操作无效');self.postMessage({requestId:request.requestId,result});return;
  }
  const {text,url,structured,type,format}=event.data;let content:string=text??'';
  if(url){const buffer=await fetch(url).then(r=>{if(!r.ok)throw new Error('无法读取文件');return r.arrayBuffer();});content=decodePreviewText(new Uint8Array(buffer));}
  if(request.table){if(content.length>5*1024*1024)throw new Error('表格预览上限为 5 MB，请使用源码视图');table=new CsvStore(content,request.delimiter);self.postMessage({requestId:request.requestId,result:table.shape});return;}
  if(format){if(content.length>5*1024*1024)throw new Error('格式化上限为 5 MB');if(type==='yaml'){const doc=parseDocument(content,{uniqueKeys:true});if(doc.errors.length)throw new Error(doc.errors[0].message);content=doc.toString();}else content=JSON.stringify(JSON.parse(content),null,2);}
  if(structured){if(content.length>5*1024*1024)throw new Error('结构化视图上限为 5 MB，请使用源码视图');let value:unknown;if(type==='yaml'){const doc=parseDocument(content,{uniqueKeys:true});if(doc.errors.length)throw new Error(doc.errors[0].message);value=doc.toJS({maxAliasCount:50});}else value=JSON.parse(content);store=new StructureStore(value);self.postMessage({requestId:event.data.requestId,result:store.root()});}
  else self.postMessage({lines:content.split(/\r\n|\r|\n/)});
 }catch(error){self.postMessage({requestId:event.data.requestId,error:(error as Error).message});}
};
