import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';

const run=promisify(execFile),root=resolve('.'),parent=resolve('work/temp');
await mkdir(parent,{recursive:true});await mkdir('dist/native',{recursive:true});
const temporary=await mkdtemp(join(parent,'archive-cli-build-'));
try{
 const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
 const installation=stdout.trim();if(!installation)throw Error('Visual Studio C++ x64 toolchain is required');
 const script=join(temporary,'build.cmd');
 await writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE "${join(root,'native/archive-cli.cpp')}" /Fe:"${join(root,'dist/native/One.Cli.exe')}" /Fo:"${join(temporary,'archive-cli.obj')}" /link /SUBSYSTEM:CONSOLE\r\n`);
 const result=await run('cmd.exe',['/d','/c',script],{cwd:temporary,windowsHide:true,env:{...process.env,TEMP:temporary,TMP:temporary},maxBuffer:2*1024*1024});process.stdout.write(result.stdout);
}finally{const child=relative(parent,temporary);if(child&&!child.startsWith('..')&&!isAbsolute(child))await rm(temporary,{recursive:true,force:true});}
