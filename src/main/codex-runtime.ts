import {accessSync,constants,readdirSync,realpathSync,statSync} from 'node:fs';
import {basename,delimiter,dirname,isAbsolute,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const tr=(text:string)=>text;

export class CodexRuntimeError extends Error {}
export interface CodexDiscoveryOptions {executable?:string;env?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;arch?:string}
export function codexUnavailable(){return new CodexRuntimeError(tr('本机 Codex 无法启动或版本不兼容，请更新 Codex 或重新选择程序'));}

/** Resolve native binaries rather than executing npm shell wrappers. One never supplies its own Codex. */
export function codexExecutables({executable,env=process.env,platform=process.platform,arch=process.arch}:CodexDiscoveryOptions={}):string[]{
 const windows=platform==='win32',name=windows?'codex.exe':'codex',candidates:string[]=[],seen=new Set<string>();
 const add=(file:string)=>{
  if(!isAbsolute(file))return;
  const path=resolve(file),key=windows?path.toLowerCase():path;if(seen.has(key))return;seen.add(key);
  try{if(!statSync(path).isFile())return;if(windows){if(!/\.exe$/i.test(path))return;}else accessSync(path,constants.X_OK);candidates.push(path);}catch{}
 };
 const target=(arch==='arm64'?'aarch64':'x86_64')+(windows?'-pc-windows-msvc':platform==='darwin'?'-apple-darwin':'-unknown-linux-musl'),packageName=`codex-${platform}-${arch}`;
 const cliPackage=(cli:string)=>{
  try{const packageFile=createRequire(join(realpathSync(cli),'package.json')).resolve(`@openai/${packageName}/package.json`);add(join(dirname(packageFile),'vendor',target,'bin',name));}catch{}
  for(const root of [join(cli,'node_modules','@openai',packageName),cli])add(join(root,'vendor',target,'bin',name));
 };
 const npm=(modules:string)=>{
  const cli=join(modules,'@openai','codex');
  add(join(modules,'@openai',packageName,'vendor',target,'bin',name));cliPackage(cli);
 };
 if(executable){
  try{if(!isAbsolute(executable)||!statSync(executable).isFile())throw Error();}catch{throw new CodexRuntimeError(tr('所选 Codex 程序不存在或不可执行，请重新选择'));}
  const entry=basename(executable).toLowerCase();
  if(windows&&/^codex(?:\.(?:ps1|cmd|bat))?$/.test(entry))npm(join(dirname(executable),'node_modules'));
  else if(windows&&entry==='codex.js'&&basename(dirname(executable)).toLowerCase()==='bin')cliPackage(dirname(dirname(executable)));
  else add(executable);
  if(!candidates.length)throw new CodexRuntimeError(tr('所选入口对应的 Codex 程序缺失或无法识别，请重新选择'));return candidates;
 }
 const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
 for(const entry of pathValue.split(delimiter)){
  const directory=entry.trim().replace(/^"(.*)"$/,'$1');if(!directory||!isAbsolute(directory))continue;
  add(join(directory,name));npm(join(directory,'node_modules'));
  if(!windows)npm(join(dirname(directory),'lib','node_modules'));
 }
 if(windows){
  if(env.APPDATA)npm(join(env.APPDATA,'npm','node_modules'));
  if(env.LOCALAPPDATA){
   const bin=join(env.LOCALAPPDATA,'OpenAI','Codex','bin');add(join(bin,name));
   try{
    const versions=readdirSync(bin,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>{const folder=join(bin,item.name);let modified=0;try{modified=statSync(folder).mtimeMs;}catch{}return {folder,modified};}).sort((a,b)=>b.modified-a.modified);
    for(const version of versions)add(join(version.folder,name));
   }catch{}
  }
 }else{
  if(env.HOME){add(join(env.HOME,'.local','bin',name));npm(join(env.HOME,'.npm-global','lib','node_modules'));}
  for(const directory of ['/usr/local/bin','/opt/homebrew/bin','/usr/bin']){add(join(directory,name));npm(join(dirname(directory),'lib','node_modules'));}
 }
 return candidates;
}
export function codexExecutable(options?:CodexDiscoveryOptions){
 const executable=codexExecutables(options)[0];if(!executable)throw new CodexRuntimeError(tr('未找到本机 Codex，请先安装 Codex 或选择已安装的程序'));return executable;
}
