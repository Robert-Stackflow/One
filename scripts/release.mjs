import {readdir,readFile,stat,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

export function versionParts(value){return /^\d+\.\d+\.\d+$/.test(value)?value.split('.').map(Number):null;}
export function newestVersions(versions){
 return [...new Set(versions)].filter(versionParts).sort((a,b)=>{const left=versionParts(a),right=versionParts(b);for(let i=0;i<3;i++)if(left[i]!==right[i])return right[i]-left[i];return 0;});
}
export async function releases(root){
 const result=[];
 for(const item of await readdir(root,{withFileTypes:true}).catch(()=>[]))if(item.isDirectory()&&versionParts(item.name)){
  const folder=join(root,item.name,'win-unpacked');
  if(await stat(join(folder,'One.exe')).catch(()=>null)&&await stat(join(folder,'resources','app.asar')).catch(()=>null))result.push(item.name);
 }
 return newestVersions(result);
}
export async function removeRelease(root,file){
 const rel=relative(root,file);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('发布清理路径越界');
 await rm(file,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
export async function retainReleases(root){
 const versions=await releases(root),removed=[];
 for(const version of versions.slice(2)){await removeRelease(root,join(root,version));removed.push(version);}
 return{retained:versions.slice(0,2),removed};
}
export async function staging(root){
 await mkdir(root,{recursive:true});const folder=join(root,'.building'),marker=join(folder,'.one-generated-release');
 if(await stat(folder).catch(()=>null)){
  if(await readFile(marker,'utf8').catch(()=>'')!=='One generated release staging\n')throw new Error('发布暂存目录缺少标记');
  await removeRelease(root,folder);
 }
 await mkdir(folder);await writeFile(marker,'One generated release staging\n');return folder;
}
export async function validateRelease(folder,source,version){
 const asar=require('@electron/asar'),archive=join(folder,'win-unpacked','resources','app.asar');
 await stat(join(folder,'win-unpacked','One.exe'));
 const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString());
 if(metadata.version!==version)throw new Error('发布版本不一致');
 const hash=data=>createHash('sha256').update(data).digest('hex');let checked=0;
 async function check(root){for(const item of await readdir(root,{withFileTypes:true})){
  const file=join(root,item.name);if(item.isDirectory()){await check(file);continue;}
  const entry=relative(source,file),normalized=entry.replaceAll('\\','/');
  if(normalized.endsWith('.obj')||/^dist\/main\/(?:.*-test\.cjs|brightness-worker\..*|brightness\.ps1)$/.test(normalized))continue;
  const description=asar.statFile(archive,entry);
  const packaged=description.unpacked?await readFile(join(archive+'.unpacked',entry)):asar.extractFile(archive,entry);
  if(hash(packaged)!==hash(await readFile(file)))throw new Error('发布内容与当前构建不同：'+entry);checked++;
 }}
 await check(join(source,'dist'));return{version,checked};
}
