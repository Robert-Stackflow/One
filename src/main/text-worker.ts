import {parentPort} from 'node:worker_threads';
import {lstat,opendir,mkdir,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,relative,resolve} from 'node:path';
import {compareTextLines} from './bounded-diff';
import {textDiffRows} from './text-diff';
import {transform} from '../shared/text';
import {validateSteps,operationNames,type TextStep,type TextProgress,type TextBatchRequest,type TextBatchResult,type TextDifference} from '../shared/text-tools';
import {compareNatural} from '../shared/natural-sort';
import {readText,saveText,createTextWriter} from './text-files';
const progress=(value:TextProgress,timeout=30000)=>parentPort!.postMessage({progress:value,timeout});
function pipeline(text:string,steps:TextStep[],label=''){let result=text;for(let i=0;i<steps.length;i++){const step=steps[i];progress({phase:operationNames[step.operation],completed:i,total:steps.length,path:label},step.regex?5000:30000);result=transform({...step,text:result});}return result;}
async function batch(request:TextBatchRequest){
 const steps=validateSteps(request.steps);if(!Array.isArray(request.paths)||!request.paths.length||request.paths.length>1000||request.paths.some(p=>typeof p!=='string'||!isAbsolute(p)||p.includes('\0'))||!isAbsolute(request.output)||typeof request.extensions!=='string'||typeof request.separator!=='string'||request.separator.length>10000)throw new Error('批处理参数无效');
 const extensions=new Set(request.extensions.split(/[;,\s]+/).map(x=>x.replace(/^\./,'').toLowerCase()).filter(Boolean));if(!extensions.size)throw new Error('请指定文本扩展名');const files:{path:string;relative:string}[]=[],seen=new Set<string>();
 for(let index=0;index<request.paths.length;index++){const root=resolve(request.paths[index]);const info=await lstat(root);if(info.isSymbolicLink())continue;if(info.isFile()){if(!seen.has(root.toLowerCase())){seen.add(root.toLowerCase());files.push({path:root,relative:request.paths.length>1?`${index+1}-${basename(root)}`:basename(root)});}continue;}if(!info.isDirectory())continue;const stack=[root],collected:{path:string;relative:string}[]=[];while(stack.length){const dir=stack.pop()!;const iterator=await opendir(dir);for await(const entry of iterator){if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);if(entry.isDirectory()){if(request.recursive)stack.push(path);}else if(entry.isFile()&&extensions.has(extname(path).slice(1).toLowerCase())&&!seen.has(path.toLowerCase())){seen.add(path.toLowerCase());collected.push({path,relative:join(`${index+1}-${basename(root)}`,relative(root,path))});if(files.length+collected.length>10000)throw new Error('一次最多处理 10,000 个文件');}}progress({phase:'正在收集文件',completed:files.length+collected.length,total:0});}collected.sort((a,b)=>compareNatural(a.path,b.path));files.push(...collected);}
 if(!files.length)throw new Error('没有符合条件的文本文件');
 if(!(await lstat(request.output)).isDirectory())throw new Error('请选择输出目录');const output=join(request.output,`One-${request.merge?'合并':'处理'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,6)}`);await mkdir(output);const result:TextBatchResult={output,completed:0,failed:[],files:files.length};let writer:Awaited<ReturnType<typeof createTextWriter>>|undefined,length=0;
 try{
  for(const file of files){
   progress({phase:'正在读取',completed:result.completed,total:files.length,path:file.path,output});let processed:string|undefined;
   try{const text=await readText(file.path,request.inputEncoding);processed=pipeline(text,steps,file.path);if(request.merge){if(length+processed.length+(result.completed?request.separator.length:0)>10_000_000)throw new Error('合并结果超过 1,000 万字符上限');}else{const target=join(output,file.relative);await mkdir(dirname(target),{recursive:true});await saveText(target,processed,request.outputEncoding,path=>parentPort!.postMessage({temporary:path}));}}
   catch(e){result.failed.push({path:file.path,error:(e as Error).message});progress({phase:'已处理',completed:result.completed,total:files.length,path:file.path,output});continue;}
   if(request.merge){writer??=await createTextWriter(join(output,'合并结果.txt'),request.outputEncoding,path=>parentPort!.postMessage({temporary:path}));const part=(result.completed?request.separator:'')+processed;await writer.append(part);length+=part.length;}
   result.completed++;progress({phase:'已处理',completed:result.completed,total:files.length,path:file.path,output});
  }
  await writer?.finish();return result;
 }catch(error){await writer?.abort();throw error;}
}
parentPort!.on('message',async task=>{try{
 let result:unknown;
 if(task.kind==='batch')result=await batch(task.request);
 else if(task.kind==='compare'){
  if(typeof task.left!=='string'||typeof task.right!=='string'||task.left.length>10_000_000||task.right.length>10_000_000)throw new Error('比较文本超过长度上限');
  progress({phase:'正在比较',completed:0,total:1});
  const comparison=compareTextLines(task.left,task.right,!!task.ignoreWhitespace),{rows,stats}=textDiffRows(comparison.changes),pageSize=100;
  await mkdir(task.cache.directory,{recursive:true});
  for(let i=0;i<rows.length;i+=pageSize){await writeFile(join(task.cache.directory,`${i/pageSize}.json`),JSON.stringify(rows.slice(i,i+pageSize)));progress({phase:'正在整理差异',completed:i+Math.min(pageSize,rows.length-i),total:rows.length});}
  result={id:task.cache.id,count:rows.length,pageSize,grouped:comparison.grouped,stats};
 }else result=pipeline(task.text,validateSteps(task.steps));
 parentPort!.postMessage({result});
 }catch(error){parentPort!.postMessage({error:(error as Error).message});}});
