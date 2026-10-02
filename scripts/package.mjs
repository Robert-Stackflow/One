import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {workspace} from './workspace.mjs';
import {versionParts,newestVersions,releases,staging,validateRelease,retainReleases,removeRelease} from './release.mjs';
const execute=promisify(execFile),source=resolve('.'),{root:work,temp}=await workspace();
const {version}=JSON.parse(await readFile('package.json','utf8')),root=resolve(process.env.ONE_RELEASE_ROOT||'release');
if(!versionParts(version))throw new Error('发布版本必须使用三段数字');
const destination=join(root,version);
if(await stat(destination).catch(()=>null))throw new Error('此版本已有发布包，请递增版本号；日常测试使用 npm run dev');
const existing=await releases(root),retained=newestVersions([...existing,version]).slice(0,2);
if(!retained.includes(version))throw new Error('新发布版本应高于现有的两个运行版本');
const obsolete=existing.filter(item=>!retained.includes(item));
if(obsolete.length){
 const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'One.exe'} | Select-Object -ExpandProperty ExecutablePath) | ConvertTo-Json -Compress"],{windowsHide:true});
 const result=stdout.trim()?JSON.parse(stdout):[],active=Array.isArray(result)?result:[result];
 if(obsolete.some(item=>active.some(file=>file?.toLowerCase().startsWith((join(root,item)+'\\').toLowerCase()))))throw new Error('要清理的旧版正在运行，请先从托盘退出旧版，再生成发布包');
}
// Build one candidate in a fixed staging directory; preserve the two working releases until it is verified.
const candidate=await staging(root),env={...process.env,TEMP:temp,TMP:temp,ELECTRON_BUILDER_CACHE:join(work,'builder-cache')};
try{
 const built=await execute('cmd.exe',['/d','/c',resolve('scripts/build-windows.cmd')],{cwd:source,env,windowsHide:true,maxBuffer:4*1024*1024});process.stdout.write(built.stdout);
 const packed=await execute(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--win','dir','--config.directories.output='+candidate],{cwd:source,env,windowsHide:true,maxBuffer:4*1024*1024});process.stdout.write(packed.stdout);
 const verified=await validateRelease(candidate,source,version);
 await writeFile(join(candidate,'verified.json'),JSON.stringify({...verified,date:new Date().toISOString()},null,2));
 await rename(candidate,destination);const retention=await retainReleases(root);
 console.log(JSON.stringify({folder:destination,verified,...retention}));
}finally{await removeRelease(root,candidate);}
