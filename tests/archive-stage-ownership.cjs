// Durable provenance for the private recorded-stage operation. This does not
// grant deletion authority or claim that the public cleanup UI is connected.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const kernel=require('koffi').load('kernel32.dll');
const create=kernel.func('intptr_t __stdcall CreateFileW(str16 path,uint32 access,uint32 share,void *security,uint32 disposition,uint32 flags,intptr_t templateFile)');
const info=kernel.func('bool __stdcall GetFileInformationByHandle(intptr_t file,_Out_ uint8_t *information)');
const close=kernel.func('bool __stdcall CloseHandle(intptr_t file)');
function stamp(file,directory=false){const handle=create(file,0x80,7,null,3,0x200000|(directory?0x2000000:0),0);assert(handle!==-1&&handle!==-1n);try{const bytes=Buffer.alloc(52);assert(info(handle,bytes));assert(!(bytes.readUInt32LE(0)&0x400));if(!directory)assert.equal(bytes.readUInt32LE(40),1);return[28,44,48,32,36,24,20].map(offset=>bytes.readUInt32LE(offset)).join(':');}finally{close(handle);}}
const identity=value=>value.split(':').slice(0,3).join(':');
const table=Array.from({length:256},(_,i)=>{let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc32(previous,text){let v=previous^0xffffffff;for(const byte of Buffer.from(text))v=table[(v^byte)&255]^(v>>>8);return(v^0xffffffff)>>>0;}
const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/stage-ownership-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function journal(recovery){let crc=0;const text=await fs.readFile(path.join(recovery,'stage.jsonl'),'utf8');assert(text.endsWith('\n'));assert(Buffer.byteLength(text)<64*1024**2);return text.trimEnd().split('\n').map((line,i)=>{const value=JSON.parse(line),end=line.lastIndexOf(',"crc32":');assert.equal(value.sequence,i);crc=crc32(crc,line.slice(0,end));assert.equal(value.crc32,crc.toString(16).padStart(8,'0'));return value.record;});}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-stage-ownership-'));let service;const live=new Set();
 const keys=['TEMP','TMP','ONE_TEST_MODE','ONE_ARCHIVE_TEST_BUDGET_SCOPE','ONE_ARCHIVE_RECOVER_CRASH_POINT','ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE'];
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 try{
  for(const key of keys)delete process.env[key];Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:'stage-record-'+randomUUID()});
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');
  service=new ArchiveService(path.join(root,'profile','cache'),()=>{});const run=request=>service.run(1,request),helper=path.resolve('dist/native/One.Archive.exe');
  const input=path.join(root,'input.bin'),added=path.join(root,'added.bin'),data=randomBytes(2200*1024),extra=randomBytes(2400*1024);await fs.writeFile(input,data);await fs.writeFile(added,extra);
  const fingerprint=async files=>Promise.all(files.map(async file=>({file,stamp:stamp(file),hash:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  const paths=()=>({stage:path.join(root,'.one-update-'+randomUUID()),recovery:path.join(root,'.one-volume-recovery-'+randomUUID())});
  const raw=async(source,listing,password,changes,expected=0,env={},job=paths())=>{
   const packet=Buffer.concat([secret(password),await archiveEditPacket(changes)]);
   const result=spawnSync(helper,['update-recorded-stage',source,job.stage,job.recovery,'0',listing.revision],{env:{...process.env,...env},windowsHide:true,input:packet,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});
   assert.equal(result.status,expected,JSON.stringify(result));const messages=result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);assert(!messages.some(item=>item.type==='ready'),'Recorded staging cannot publish source files');
   return{...job,messages,result:messages.find(item=>item.type==='result')};
  };
  const inspect=async(job,source,listing,sealed)=>{
   const records=await journal(job.recovery),header=records[0];assert.deepEqual(Object.keys(header),['type','version','kind','parent','stage','recovery','parentIdentity','stageIdentity','recoveryIdentity','primary','revision']);
   assert.equal(header.version,4);assert.equal(header.kind,'volume-stage');assert.equal(header.parent,root);assert.equal(header.stage,job.stage);assert.equal(header.recovery,job.recovery);assert.equal(header.primary,path.basename(source));assert.equal(header.revision,listing.revision);
   for(const name of ['parent','stage','recovery'])assert.equal(header[name+'Identity'],identity(stamp(header[name],true)));
   const created=records.filter(item=>item.type==='created'),snapshots=records.filter(item=>item.type==='snapshot');assert.equal(new Set(created.map(item=>item.identity)).size,created.length);assert.equal(new Set(created.map(item=>item.name.toLowerCase())).size,created.length);
   for(const [i,item]of created.entries()){assert.equal(item.index,i);assert.equal(path.basename(item.name),item.name);const file=path.join(job.stage,item.name);if(await exists(file))assert.equal(identity(stamp(file)),item.identity);}
   if(sealed){assert.equal(records.at(-1).type,'sealed');assert.equal(snapshots.length,created.length);assert.equal(records.at(-1).items,created.length);assert.equal(records.at(-1).files,(await fs.readdir(job.stage)).length);
    for(const [i,item]of snapshots.entries()){assert.equal(item.index,i);const file=path.join(job.stage,created[i].name);assert.equal(item.stamp,await exists(file)?stamp(file):'');}
   }else assert(!records.some(item=>item.type==='sealed'));
   return{records,created,snapshots};
  };
  for(const format of ['zip','7z'])for(const password of ['','record secret']){
   const target=path.join(root,`${format}-${password?'encrypted':'plain'}.${format==='zip'?'ZIP':'7z'}`),source=(await run({operation:'create',path:target,sources:[input],password,volumeBytes:1024**2,level:0})).path;
   const listing=await run({operation:'list',path:source,password}),base=path.basename(target),files=(await fs.readdir(root)).filter(name=>format==='zip'?name===base||name.startsWith(base.slice(0,-4)+'.z'):name.startsWith(base+'.')).map(name=>path.join(root,name)),before=await fingerprint(files);
   const changes=[{kind:'add',source:added,name:'added.bin'}];
   const success=await raw(source,listing,password,changes),checked=await inspect(success,source,listing,true);assert(success.result.staged);assert(success.result.volumes>files.length);
   if(format==='7z'){assert.equal(checked.created[0].name,base);assert.equal(checked.snapshots[0].stamp,'','Deleted intermediate is explicitly recorded');}
   await run({operation:'test',path:success.result.path,password});const output=await run({operation:'extract',path:success.result.path,parent:root,password});assert.deepEqual(await fs.readFile(path.join(output.path,'input.bin')),data);assert.deepEqual(await fs.readFile(path.join(output.path,'added.bin')),extra);
   const external=spawnSync('7z',['t',success.result.path,...(password?['-p'+password]:[])],{env:process.env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024**2});assert.equal(external.status,0,external.stdout+external.stderr);
   const empty=await raw(source,listing,password,[{kind:'delete',indexes:listing.entries.map(item=>item.index)}]);await inspect(empty,source,listing,true);assert.equal(empty.result.count,0);await run({operation:'test',path:empty.result.path,password});
   for(const point of ['stage-header','stage-created:0','stage-created:2','stage-sealed']){
    const stopped=await raw(source,listing,password,changes,77,{ONE_ARCHIVE_RECOVER_CRASH_POINT:point}),state=await inspect(stopped,source,listing,point==='stage-sealed');
    if(point==='stage-header'){assert.equal(state.created.length,0);assert.deepEqual(await fs.readdir(stopped.stage),[]);}
    if(point.startsWith('stage-created:')){const index=Number(point.split(':')[1]);assert.equal(state.created.length,index+1);assert.equal((await fs.stat(path.join(stopped.stage,state.created[index].name))).size,0,'Ownership is flushed before first payload write');}
   }
   for(const sequence of [1,3]){
    const failed=await raw(source,listing,password,changes,2,{ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE:String(sequence)}),state=await inspect(failed,source,listing,false);assert.equal(state.created.length,sequence-1);assert(!failed.result);assert(failed.messages.some(item=>item.type==='error'&&item.code==='write'&&item.message==='Injected staging ownership journal failure'),'Report the journal cause after leaving the C callback: '+JSON.stringify({format,sequence,messages:failed.messages}));
    const recorded=new Set(state.created.map(item=>item.name));for(const name of await fs.readdir(failed.stage))if(!recorded.has(name))assert.equal((await fs.stat(path.join(failed.stage,name))).size,0,'An unregistered create never receives payload');
   }
   // A complete generated archive is not a successful recorded stage until
   // every snapshot and the final sealed marker have reached the journal.
   for(const sequence of [checked.created.length+1,checked.created.length*2+1]){
    const failed=await raw(source,listing,password,changes,2,{ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE:String(sequence)}),state=await inspect(failed,source,listing,false);assert.equal(state.created.length,checked.created.length);assert(!failed.result);assert(failed.messages.some(item=>item.type==='error'));
   }
   const headerFailure=await raw(source,listing,password,changes,2,{ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE:'0'});assert.equal((await fs.stat(path.join(headerFailure.recovery,'stage.jsonl'))).size,0);assert.deepEqual(await fs.readdir(headerFailure.stage),[]);
   if(password){const failed=await raw(source,listing,'wrong',changes,2);await inspect(failed,source,listing,false);assert.deepEqual(await fs.readdir(failed.stage),[]);}
   const production=await raw(source,listing,password,changes,0,{ONE_TEST_MODE:'0',ONE_ARCHIVE_RECOVER_CRASH_POINT:'stage-created:0',ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE:'1'});await inspect(production,source,listing,true);
   const longFault=await raw(source,listing,password,changes,0,{ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE:'1'.repeat(1000)});await inspect(longFault,source,listing,true);
   const collision=paths();await fs.mkdir(collision.recovery);await fs.writeFile(path.join(collision.recovery,'unrelated'),'keep');await raw(source,listing,password,changes,2,{},collision);assert.equal(await fs.readFile(path.join(collision.recovery,'unrelated'),'utf8'),'keep');
   const invalid=await raw(source,{...listing,revision:'v2:bad'},password,changes,2);assert(!await exists(invalid.recovery));
   const wrongScope=paths();wrongScope.recovery=path.join(root,'wrong-recovery-name');await raw(source,listing,password,changes,2,{},wrongScope);assert(!await exists(wrongScope.recovery));
   // Hold the child before its private edit packet, then introduce content
   // which never receives provenance. CREATE_NEW must reject a hard-link.
   const waiting=paths(),child=spawn(helper,['update-recorded-stage',source,waiting.stage,waiting.recovery,'0',listing.revision],{env:process.env,windowsHide:true,stdio:'pipe'});live.add(child);let text='';child.stdout.on('data',data=>{text+=data;});child.stdin.on('error',()=>{});
   let timer;const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Recorded staging timeout'));},30000);child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);live.delete(child);resolve({code,signal});});});done.catch(()=>{});child.stdin.write(secret(password));
   const deadline=Date.now()+10000;while(!await exists(path.join(waiting.recovery,'stage.jsonl'))){assert(child.exitCode===null&&Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
   const unrelated=path.join(root,'unrelated-'+randomUUID());await fs.writeFile(unrelated,'do not truncate');await fs.link(unrelated,path.join(waiting.stage,format==='zip'?base.slice(0,-4)+'.z01':base));child.stdin.end(await archiveEditPacket(changes));assert.equal((await done).code,2,text);assert.equal(await fs.readFile(unrelated,'utf8'),'do not truncate');assert.equal((await journal(waiting.recovery)).length,1);
   assert.deepEqual(await fingerprint(files),before,'Every recorded stage, fault and crash preserves all originals');
  }
  // A one-physical-part 7Z uses its single-file stamp instead of a v2 group hash.
  const tiny=path.join(root,'tiny.txt');await fs.writeFile(tiny,'small');const single=(await run({operation:'create',path:path.join(root,'single.7z'),sources:[tiny],volumeBytes:1024**2})).path,listing=await run({operation:'list',path:single});assert(!listing.revision.startsWith('v2:'));const job=await raw(single,listing,'',[{kind:'add',source:added,name:'added.bin'}]);await inspect(job,single,listing,true);assert(job.result.volumes>1);
  const password='中文密码',encoded=(await run({operation:'create',path:path.join(root,'encoded.zip'),sources:[input],volumeBytes:1024**2,password,passwordEncoding:936})).path,encodedList=await run({operation:'list',path:encoded,password,passwordEncoding:936});
  const encodedJob=await raw(encoded,encodedList,password,[{kind:'add',source:tiny,name:'新增.txt'}],0,{ONE_ARCHIVE_PASSWORD_ENCODING:'936'});await inspect(encodedJob,encoded,encodedList,true);await run({operation:'test',path:encodedJob.result.path,password,passwordEncoding:936});const decoded=await run({operation:'extract',path:encodedJob.result.path,parent:root,password,passwordEncoding:936});assert.equal(await fs.readFile(path.join(decoded.path,'新增.txt'),'utf8'),'small');
  await assert.rejects(run({operation:'update-recorded-stage',path:single}),/请求无效/);
  console.log('Recorded stage provenance passed: CRC-chained bounded journal, actual directory/file identities, pre-write persistence, plain/encrypted split ZIP/7Z growth/empty/singleton, final snapshots/deleted intermediate, native/external verification and content extraction, hard exits, journal failures, production fault isolation, hard-link collision rejection and unchanged originals. Public cleanup remains to be integrated.');
 }finally{
  for(const child of live){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
  await service?.stop();for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
  assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
