import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

const run=promisify(execFile);
const root=resolve('.');
const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
const {stdout}=await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
const installation=stdout.trim();
if(!installation)throw new Error('需要 Visual Studio C++ x64 工具链构建压缩辅助程序');
const cmake=join(installation,'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
const zlibSource=resolve('work/archive-source/zlib');
const zlibBuild=resolve('work/archive-build/zlib');
const minizipBuild=resolve('work/archive-build/minizip-ng');
const minizipSource=resolve('vendor/archive/minizip-ng');
const zlibLib=join(zlibBuild,'Release/zlibstatic.lib');
const minizipLib=join(minizipBuild,'Release/minizip-ng.lib');
await mkdir('work/archive-build',{recursive:true});
await mkdir('dist/native',{recursive:true});
// zlib's CMake configuration moves zconf.h in its source tree. Build a private copy.
if(!existsSync(zlibSource))await cp(resolve('vendor/archive/zlib'),zlibSource,{recursive:true});
const call=async(args)=>{const result=await run(cmake,args,{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});process.stdout.write(result.stdout);};
await call(['-S',zlibSource,'-B',zlibBuild,'-G','Visual Studio 17 2022','-A','x64','-DBUILD_SHARED_LIBS=OFF','-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded']);
await call(['--build',zlibBuild,'--config','Release','--target','zlibstatic','--parallel','8']);
await call(['-S',minizipSource,'-B',minizipBuild,'-G','Visual Studio 17 2022','-A','x64','-DCMAKE_POLICY_DEFAULT_CMP0091=NEW','-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
  '-DMZ_FETCH_LIBS=OFF','-DMZ_ZLIB_FLAVOR=zlib','-DMZ_BZIP2=OFF','-DMZ_LZMA=OFF','-DMZ_PPMD=OFF','-DMZ_ZSTD=OFF',
  '-DMZ_COMPAT=OFF','-DMZ_BUILD_TESTS=OFF','-DMZ_PKCRYPT=ON','-DMZ_WZAES=ON',
  `-DZLIB_INCLUDE_DIR=${zlibSource};${zlibBuild}`,`-DZLIB_LIBRARY=${zlibLib}`]);
await call(['--build',minizipBuild,'--config','Release','--target','minizip-ng','--parallel','8']);
const command=resolve('work/archive-build/build-helper.cmd');
await writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE /I"${minizipSource}" /I"${minizipBuild}" /I"${zlibSource}" /I"${zlibBuild}" native\\archive\\archive.cpp native\\archive\\zip-update.cpp native\\archive\\sevenzip.cpp native\\archive\\sevenzip-create.cpp /Fe:dist\\native\\One.Archive.exe /Fo:work\\archive-build\\ /link "${minizipLib}" "${zlibLib}" bcrypt.lib crypt32.lib ole32.lib oleaut32.lib\r\n`, 'utf8');
const result=await run('cmd.exe',['/d','/c',command],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
await copyFile('vendor/archive/7zip/7z.dll','dist/native/7z.dll');
