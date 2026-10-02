import {mkdir,readdir,readFile,writeFile,rm,stat,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
export const storageLimits={cases:20,records:128*1024**2,fixtures:192*1024**2};
export async function workspace(){
 const root=resolve(process.env.ONE_WORK_ROOT||'work'),marker=join(root,'.one-generated-workspace');await mkdir(root,{recursive:true});
 const entries=await readdir(root);if(!entries.includes('.one-generated-workspace')&&entries.length)throw new Error('工作区非空且没有 One 标记，拒绝写入');
 await writeFile(marker,'One development and generated verification workspace.\n');const temp=join(root,'temp');await mkdir(temp,{recursive:true});return{root,temp};
}
// Bound outstanding filesystem calls even for fixtures with tens of thousands of files.
async function occupied(file){const item=await lstat(file);if(item.isSymbolicLink())return 0;if(!item.isDirectory())return Math.ceil(item.size/4096)*4096;let size=0;for(const name of await readdir(file))size+=await occupied(join(file,name));return size;}
async function active(file){const pid=Number(await readFile(join(file,'.active'),'utf8').catch(()=>''));if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
export async function removeGenerated(root,file){const rel=relative(root,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('生成文件清理路径越界');await rm(file,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
export async function pruneWorkspace(root,limits=storageLimits){
 if(!await readFile(join(root,'.one-generated-workspace'),'utf8').catch(()=>''))throw new Error('工作区缺少标记');
 const current=join(root,'current'),cases=[];let running=false;for(const item of await readdir(current,{withFileTypes:true}).catch(()=>[]))if(item.isDirectory()&&item.name!=='fixtures'){
  const file=join(current,item.name);if(!await stat(join(file,'.one-generated-case')).catch(()=>null))continue;if(await active(file)){running=true;continue;}
  cases.push({file,time:(await stat(file)).mtimeMs,bytes:await occupied(file)});
 }
 cases.sort((a,b)=>b.time-a.time);let retained=0,count=0;
 for(const item of cases){if(count>=limits.cases||retained+item.bytes>limits.records)await removeGenerated(current,item.file);else{retained+=item.bytes;count++;}}
 const fixtures=join(current,'fixtures');if(!running&&await stat(fixtures).catch(()=>null)&&await occupied(fixtures)>limits.fixtures)await removeGenerated(current,fixtures);
}
