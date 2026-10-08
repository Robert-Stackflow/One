const {execFile}=require('node:child_process'),{promisify}=require('node:util'),fs=require('node:fs/promises'),path=require('node:path');
const run=promisify(execFile);
(async()=>{
 const base=path.resolve('work/temp');await fs.mkdir(base,{recursive:true});const out=await fs.mkdtemp(path.join(base,'explorer-menu-state-'));
 try{
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
 const installation=stdout.trim();if(!installation)throw Error('需要 Visual Studio C++ 工具链');
 const script=path.join(out,'build.cmd');await fs.writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE "${path.resolve('tests/explorer-menu-state.cpp')}" /Fe:"${path.join(out,'state.exe')}" /Fo:"${path.join(out,'state.obj')}" /link ole32.lib shell32.lib shlwapi.lib uuid.lib\r\n`);
 const env={...process.env,TEMP:out,TMP:out};await run('cmd.exe',['/d','/c',script],{windowsHide:true,env});await run(path.join(out,'state.exe'),[],{windowsHide:true,env});
 console.log('PASS shell titles, selection limits, all archive selections, subcommand enumeration/clone/reset, disabled commands and COM cleanup');
 }finally{const relative=path.relative(base,out);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('invalid cleanup path');await fs.rm(out,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
