const {execFile}=require('node:child_process'),{promisify}=require('node:util'),fs=require('node:fs/promises'),path=require('node:path');
const run=promisify(execFile);
(async()=>{
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/explorer-menu-state');await fs.mkdir(out,{recursive:true});
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
 const installation=stdout.trim();if(!installation)throw Error('需要 Visual Studio C++ 工具链');
 const script=path.join(out,'build.cmd');await fs.writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE "${path.resolve('tests/explorer-menu-state.cpp')}" /Fe:"${path.join(out,'state.exe')}" /Fo:"${path.join(out,'state.obj')}" /link ole32.lib shell32.lib shlwapi.lib uuid.lib\r\n`);
 await run('cmd.exe',['/d','/c',script],{windowsHide:true});await run(path.join(out,'state.exe'),[],{windowsHide:true});
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({result:'PASS',plainTitles:true,nullSelection:true,multiSelectionLimits:true,disabledCommands:true}));console.log('PASS shell command titles, activation state and selection limits');
})().catch(error=>{console.error(error);process.exitCode=1;});
