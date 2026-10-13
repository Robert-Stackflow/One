import { readFile, lstat, mkdir, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const index=process.argv.indexOf('--backend'),backend=index<0?'cpu':process.argv[index+1],prepare=process.argv.includes('--prepare');
if(!['cpu','cuda','all'].includes(backend))throw Error('--backend 需要 cpu、cuda 或 all');
const root=resolve(process.env.ONE_LLAMA_PROBE_ROOT||'work/current/capture-reconstruction/deepseek');
const bundled=await build({entryPoints:['src/main/recognition/llama-runtime-catalog.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {llamaRuntimeProfiles}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const archives=llamaRuntimeProfiles.filter(profile=>backend==='all'||profile.backend===backend).flatMap(profile=>profile.archives),run=promisify(execFile);
if(prepare)await mkdir(root,{recursive:true});const folder=await lstat(root);if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('运行包验证目录无效');
async function info(path){try{const value=await lstat(path);if(!value.isFile()||value.isSymbolicLink())throw Error('运行包文件无效');return value;}catch(error){if(error.code!=='ENOENT')throw error;}}
async function valid(path,artifact){const metadata=await info(path);if(!metadata||metadata.size!==artifact.bytes)return false;const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex')===artifact.sha256;}
let downloadedBytes=0;
for(const artifact of archives){
  const target=join(root,artifact.name),partial=target+'.part';if(await valid(target,artifact))continue;
  if(!prepare)throw Error('运行包缺失或校验失败：'+artifact.name+'；显式加 --prepare 才会下载');
  const pending=await info(partial);if(pending&&pending.size>artifact.bytes)throw Error('运行包临时文件过大：'+artifact.name);
  await run('curl.exe',['--fail','--silent','--show-error','--location','--max-time','600','--continue-at','-','--output',partial,artifact.url],{windowsHide:true,timeout:610000,maxBuffer:65536});
  if(!await valid(partial,artifact))throw Error('运行包下载校验失败：'+artifact.name);
  const previous=await info(target);if(previous)await rename(target,target+'.invalid-'+Date.now());await rename(partial,target);downloadedBytes+=artifact.bytes-(pending?.size||0);
}
console.log(JSON.stringify({backend,verifiedArchives:archives.length,downloadedBytes,root}));
