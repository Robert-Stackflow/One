// Isolated diagnostic build; current native object files must match the source.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const option=(name,fallback)=>{const index=process.argv.indexOf('--'+name);return index<0?fallback:process.argv[index+1];};
const label=option('label','publish-profile');assert(/^[A-Za-z0-9_-]{1,40}$/.test(label));
const evidence=path.resolve(option('output','work/current/archive-publish-profile')),root=path.join(evidence,label),native=path.join(root,'native');fs.mkdirSync(native,{recursive:true});
const sourcePath=path.resolve('native/archive/extract-publish.cpp'),header=path.resolve('tests/archive-publish-profile.h'),original=fs.readFileSync(sourcePath,'utf8');
assert.equal(original.split('#include "common.h"').length,2,'Native publish includes changed; update diagnostic injection.');
let source=original.replace('#include "common.h"','#include "common.h"\n#include "archive-publish-profile.h"');
for(const name of ['CreateFileW','GetFileInformationByHandle','GetFileAttributesW','SetFileInformationByHandle','WriteFile','FlushFileBuffers','PeekNamedPipe','emit','CreateDirectoryW']){assert(source.includes(name+'('),'Native API missing: '+name);source=source.replaceAll(name+'(','profile_'+name+'(');}
const filename=path.join(root,'extract-publish-profile.cpp');fs.writeFileSync(filename,source);
let command=fs.readFileSync('work/archive-build/build-helper.cmd','utf8').replace('cl /nologo','cl /nologo /W4 /WX /I"'+path.resolve('native/archive')+'" /I"'+path.resolve('tests')+'"');
let replaced=0;command=command.replace(/[A-Za-z0-9_\\/-]+\.(?:cpp|c)(?=\s)/g,name=>{if(name==='native\\archive\\extract-publish.cpp'){replaced++;return '"'+filename+'"';}const object=path.resolve('work/archive-build',path.basename(name.replaceAll('\\','/')).replace(/\.(cpp|c)$/,'.obj'));assert(fs.existsSync(object),'Build the current project first: '+object);return '"'+object+'"';});assert.equal(replaced,1);
assert(command.includes('/Fe:dist\\native\\One.Archive.exe')&&command.includes('/Fo:work\\archive-build\\'),'Native build output flags changed.');
command=command.replace('/Fe:dist\\native\\One.Archive.exe','/Fe:"'+path.join(native,'One.Archive.exe')+'"').replace('/Fo:work\\archive-build\\','/Fo:"'+path.join(native,'profile.obj')+'"');
const script=path.join(root,'build.cmd');fs.writeFileSync(script,command);try{cp.execFileSync('cmd.exe',['/d','/c',script],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:1024*1024});}catch(error){fs.writeFileSync(path.join(root,'build.log'),String(error.stdout||'')+'\n'+String(error.stderr||''));throw Error('Diagnostic build failed; see '+path.join(root,'build.log'));}
for(const name of ['One.ArchiveBudget.dll','7z.dll'])fs.copyFileSync(path.resolve('dist/native',name),path.join(native,name));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const metadata={publishSourceSha256:sha(sourcePath),accessHeaderSha256:sha('native/archive/publish-access.h'),profileHeaderSha256:sha(header),helperSha256:sha(path.join(native,'One.Archive.exe')),note:'Instrumented current publisher linked with current cached native objects. Build the project first; timings include instrumentation and ordinary background activity.'};
const originalSpawn=cp.spawn,profiles=[];
cp.spawn=function(command,args,options){const child=originalSpawn(command,args,options);if(String(command).endsWith('One.Archive.exe')&&args[0]==='publish'){
 let stderr='';child.stderr.on('data',data=>stderr+=data);child.on('close',code=>{try{const result=JSON.parse(stderr.trim());assert(result.publishProfile);profiles.push({exitCode:code,...result});fs.writeFileSync(path.join(root,'profiles.json'),JSON.stringify({metadata,profiles},null,2)+'\n');}catch(error){fs.writeFileSync(path.join(root,'profile-error.txt'),String(error)+'\n'+stderr.slice(-6000));process.exitCode=1;}});
 }return child;};
process.argv=[process.argv[0],path.resolve('tests/archive-small-files-benchmark.cjs'),'--label',label,'--helper-dir',native,'--mode','here','--repeat','1','--output',root,'--source',path.resolve(option('source','work/current/archive-small-files-perf/small-files.zip'))];
console.log('Built an isolated publisher profiler; source and production binaries unchanged.');
require(path.resolve('tests/archive-small-files-benchmark.cjs'));
