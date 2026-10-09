const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);

async function main(){
 await fs.mkdir('work/temp',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('work/temp/one-directories-'));
 try{
  const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
  const found=await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
  const installation=found.stdout.trim();assert(installation);
  const version=(await fs.readFile(path.join(installation,'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'),'utf8')).trim(),bin=path.join(installation,'VC/Tools/MSVC',version,'bin/Hostx64/x64');
  for(const sanitized of process.argv.includes('--asan')?[true]:[false,true]){
   const label=sanitized?'asan':'normal',base=path.join(root,label),unit=path.join(root,label+'.exe'),command=path.join(root,label+'.cmd');
   await fs.mkdir(path.join(base,'outside'),{recursive:true});await fs.writeFile(path.join(base,'outside/keep.txt'),'keep');await fs.symlink(path.join(base,'outside'),path.join(base,'linked-parent'),'junction');
   await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /UNDEBUG /W4 /WX /utf-8 /DUNICODE /D_UNICODE ${sanitized?`/fsanitize=address /Zi /Fd:"${path.join(root,'asan.pdb')}" `:''}/I"${path.resolve('native/archive')}" "${path.resolve('tests/archive-directories.cpp')}" /Fe:"${unit}" /Fo:"${path.join(root,label+'.obj')}"\r\n`);
   await execute('cmd.exe',['/d','/c',command],{cwd:root,windowsHide:true,maxBuffer:256*1024,timeout:120000});
   const stdout=await new Promise((resolve,reject)=>{
    const env={...process.env},pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';if(sanitized)env[pathKey]=bin+';'+(env[pathKey]||'');
    const child=spawn(unit,[base],{cwd:root,env,windowsHide:true,timeout:30000});let output='',errors='',ready=false;
    child.on('error',reject);child.stdout.on('data',data=>{output+=data;if(output.length>65536){child.kill();reject(Error('Unexpected unit output size'));return;}
     if(!ready&&output.includes('junction-ready')){ready=true;fs.symlink(path.join(base,'outside'),path.join(base,'parent/stage/linked-child'),'junction').then(()=>child.stdin.end('1')).catch(error=>{child.kill();reject(error);});}
    });child.stderr.on('data',data=>errors=(errors+data).slice(-6000));child.on('close',code=>code===0?resolve(output):reject(Error(`Directory unit exited ${code}: ${output.slice(-2000)} ${errors}`)));
   });assert.match(stdout,/Extraction directories passed:/);
   assert.equal(await fs.readFile(path.join(base,'outside/keep.txt'),'utf8'),'keep');console.log(label+': '+stdout.trim().replace('junction-ready\r\n',''));
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(String(error.stderr||error.stdout||error).slice(-6000));process.exitCode=1;});
