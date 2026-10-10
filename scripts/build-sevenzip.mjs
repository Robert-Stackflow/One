import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildSevenzip(installation,output){
 const root=resolve('.'),vendor=join(root,'vendor/archive/7zip'),metadata=JSON.parse(await readFile(join(vendor,'SOURCE.json'),'utf8'));
 const archive=join(vendor,metadata.archive),patches=(metadata.patches||[metadata.patch]).map(name=>join(vendor,name)),bytes=await readFile(archive);
 if(hash(bytes)!==metadata.sha256)throw Error('7-Zip source archive checksum mismatch');
 const revision=hash(Buffer.concat([bytes,...await Promise.all(patches.map(patch=>readFile(patch)))])),source=join(root,'work/archive-source','7zip-'+revision.slice(0,16)),stamp=join(source,'.one-source-ready');
 await mkdir(source,{recursive:true});await mkdir('work/archive-build',{recursive:true});
 if(!existsSync(stamp)){
  await run('tar.exe',['-xzf',archive,'-C',source,'--strip-components=1'],{windowsHide:true,maxBuffer:1024*1024});
  for(const patch of patches)await run('git',['apply','--whitespace=nowarn','--directory='+relative(root,source).replaceAll('\\','/'),patch],{cwd:root,windowsHide:true,maxBuffer:1024*1024});
  await writeFile(stamp,revision+'\n');
 }
 if(!installation){
  const vswhere=join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
  installation=(await run(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true})).stdout.trim();
 }
 if(!installation)throw Error('7-Zip requires the Visual Studio x64 C++ toolchain');
 const command=join(root,'work/archive-build/build-sevenzip.cmd'),log=join(root,'work/archive-build/sevenzip.log'),bundle=join(source,metadata.bundle);
 await writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncd /d "${bundle}"\r\nnmake /nologo PLATFORM=x64 MP_NPROC=8\r\n`);
 try{const result=await run('cmd.exe',['/d','/c',command],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});await writeFile(log,result.stdout+result.stderr);}
 catch(error){await writeFile(log,(error.stdout||'')+(error.stderr||''));throw Error('7-Zip build failed; '+log+'\n'+((error.stdout||'')+(error.stderr||'')).slice(-3000));}
 const built=join(bundle,'x64/7z.dll'),target=output?resolve(output):join(vendor,'7z.dll');
 await mkdir(dirname(target),{recursive:true});
 if(!existsSync(target)||hash(await readFile(target))!==hash(await readFile(built)))await copyFile(built,target);
 console.log('7-Zip 26.04 x64 built with ZIP password encoding, LHA headers/encoding and CAB volume diagnostics');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await buildSevenzip();
