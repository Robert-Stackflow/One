import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const run=promisify(execFile),folder=resolve('work/current/native-preview/build');
await mkdir(folder,{recursive:true});await mkdir('dist/native',{recursive:true});
const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
const installation=stdout.trim();if(!installation)throw Error('需要 Visual Studio C++ 工具链构建原生预览宿主');
const testing=process.env.ONE_PREVIEW_BUILD_TEST==='1',missing=process.env.ONE_PREVIEW_BUILD_TEST==='missing';
for(const arch of ['x64','x86']){
 const name=arch==='x64'?'One.Preview':'One.Preview32',script=join(folder,`${name}${testing?'-test':missing?'-missing':''}.cmd`),output=testing?join(folder,arch==='x64'?'One.Preview.Test.exe':'One.Preview.Test32.exe'):missing?join(folder,arch==='x64'?'One.Preview.Missing.exe':'One.Preview.Missing32.exe'):resolve('dist/native/'+name+'.exe');
 await writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvarsall.bat" ${arch} >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE ${testing?'/DONE_PREVIEW_TEST':missing?'/DONE_PREVIEW_TEST_MISSING':''} "${resolve('native/preview-host.cpp')}" /Fe:"${output}" /Fo:"${join(folder,name+'.obj')}" /link ole32.lib shell32.lib shlwapi.lib user32.lib advapi32.lib gdi32.lib uuid.lib\r\n`);
 await run('cmd.exe',['/d','/c',script],{windowsHide:true,maxBuffer:65536});
}
console.log(testing||missing?'Native preview test host built.':'Windows preview hosts built (64/32 bit).');
