const fs=require('node:fs/promises'),path=require('node:path'),{promisify}=require('node:util');
const run=promisify(require('node:child_process').execFile);
module.exports=async function(directory){
  const {stdout}=await run(path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe'),['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
  const installation=stdout.trim();if(!installation)throw Error('Scroll fixture requires the Visual Studio C++ x64 toolchain');
  const output=path.join(directory,'One.ScrollFixture.exe'),script=path.join(directory,'build-fixture.cmd');
  await fs.writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE "${path.resolve('tests/capture/scroll-fixture.cpp')}" /Fe:"${output}" /Fo:"${path.join(directory,'fixture.obj')}" /link user32.lib gdi32.lib\r\n`);
  try{const result=await run('cmd.exe',['/d','/c',script],{windowsHide:true,cwd:directory,maxBuffer:1024*1024});await fs.writeFile(path.join(directory,'fixture-build.log'),result.stdout+result.stderr);}catch(error){throw Error(((error.stdout||'')+(error.stderr||'')).slice(-5000));}
  return output;
};
