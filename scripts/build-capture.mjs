import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';

const run=promisify(execFile),root=resolve('.'),sources=resolve('native/capture');
const folder=resolve('work/current/capture-migration/native-build'),cache=resolve('work/cache/native'),temp=resolve('work/temp/capture-build');
const compilerFlags='/nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE';
const targets=[
  ['CaptureProbe','ole32.lib oleaut32.lib oleacc.lib uuid.lib uiautomationcore.lib dwmapi.lib user32.lib gdi32.lib'],
  ['SingleCapture','windowsapp.lib d3d11.lib dxgi.lib windowscodecs.lib ole32.lib dwmapi.lib user32.lib'],
  ['ScrollCapture','windowsapp.lib d3d11.lib dxgi.lib windowscodecs.lib ole32.lib dwmapi.lib user32.lib gdi32.lib'],
];
// Hash every local include, including ScrollCapture's included SingleCapture.cpp.
async function dependencies(file,seen=new Map()){
  file=resolve(file);if(seen.has(file))return seen;
  const bytes=await readFile(file);seen.set(file,bytes);
  for(const match of bytes.toString('utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm))await dependencies(resolve(dirname(file),match[1]),seen);
  return seen;
}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('截图辅助程序需要 Windows x64 构建环境');
await Promise.all([mkdir(folder,{recursive:true}),mkdir(cache,{recursive:true}),mkdir(temp,{recursive:true}),mkdir('dist/native',{recursive:true})]);
const {stdout}=await run(join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe'),['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
const installation=stdout.trim();if(!installation)throw Error('需要 Visual Studio C++ x64 工具链构建截图辅助程序');
const compilerVersion=(await readFile(join(installation,'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'),'utf8')).trim();
const manifest=join(sources,'helper.manifest'),manifestBytes=await readFile(manifest);
for(const [name,libs] of targets){
  const identity='One.'+name,source=join(sources,name+'.cpp'),output=resolve('dist/native',identity+'.exe'),stamp=join(cache,identity+'.json');
  const hash=createHash('sha256').update(compilerFlags).update(libs).update(installation).update(compilerVersion).update(manifestBytes);
  for(const [file,bytes] of [...await dependencies(source)].sort(([a],[b])=>a.localeCompare(b)))hash.update(file).update(bytes);
  const input=hash.digest('hex');
  try{const stored=JSON.parse(await readFile(stamp,'utf8'));if(stored.input===input&&stored.output===createHash('sha256').update(await readFile(output)).digest('hex')){console.log(identity+': cached');continue;}}catch(error){if(error?.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  const script=join(folder,identity+'.cmd'),built=join(folder,identity+'.exe');
  await writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl ${compilerFlags} "${source}" /Fe:"${built}" /Fo:"${join(folder,identity+'.obj')}" /link /MANIFEST:EMBED /MANIFESTINPUT:"${manifest}" ${libs}\r\n`);
  const result=await run('cmd.exe',['/d','/c',script],{cwd:root,windowsHide:true,maxBuffer:1024*1024,env:{...process.env,TEMP:temp,TMP:temp}});
  await writeFile(join(folder,identity+'.log'),result.stdout+result.stderr);
  await copyFile(built,output);
  await writeFile(stamp,JSON.stringify({input,output:createHash('sha256').update(await readFile(output)).digest('hex')}));
  console.log(identity+': built');
}
