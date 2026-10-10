import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const run=promisify(execFile),folder=resolve('work/current/theme-schedule/native-build');await mkdir(folder,{recursive:true});await mkdir('dist/native',{recursive:true});
const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
const installation=stdout.trim();if(!installation)throw Error('需要 Visual Studio C++ 工具链构建主题服务');
for(const testing of [false,true]){
 const name=testing?'One.Theme.Test':'One.Theme',script=join(folder,name+'.cmd'),target=testing?join(folder,name+'.exe'):resolve('dist/native/'+name+'.exe');
 await writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE ${testing?'/DONE_THEME_TEST':''} "${resolve('native/theme.cpp')}" /Fe:"${target}" /Fo:"${join(folder,name+'.obj')}" /link advapi32.lib user32.lib\r\n`);
 const result=await run('cmd.exe',['/d','/c',script],{windowsHide:true,maxBuffer:65536});if(result.stderr)process.stderr.write(result.stderr);
}
console.log('Windows theme helper and isolated test variant built.');
