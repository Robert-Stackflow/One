const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {randomBytes,createHash}=require('node:crypto');
const {build}=require('esbuild');
const JSZip=require('jszip');
const hash=data=>createHash('sha256').update(data).digest('hex');
const normalized=name=>name.replace(/\\/g,'/');

// Pause the real helper after preflight, while its source handles are alive.
// The internal receiver consumes FileContents; this never opens Explorer.
async function lockedDrag(root,source,later,revision,index,password){
 const child=spawn(path.resolve('dist/native/One.Archive.exe'),['drag-test',source,path.join(root,'drag-'+randomBytes(6).toString('hex')),'0',revision],{windowsHide:true,env:{...process.env,ONE_TEST_MODE:'1',ONE_ARCHIVE_RISK_REVISION:''}});
 let output='',stderr='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const complete=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{readyReject(Error('Helper exited before ready: '+output+stderr));resolve(code);});});
 const timer=setTimeout(()=>{readyReject(Error('Drag preflight timed out'));child.kill();},30000);
 child.stdout.on('data',bytes=>{output+=bytes.toString();if(output.length>1024**2){readyReject(Error('Unexpected helper output'));child.kill();}if(output.split(/\r?\n/).some(line=>line&&line.includes('"type":"ready"')))readyResolve();});
 child.stderr.on('data',bytes=>stderr+=bytes.toString());
 const secret=Buffer.from(password),packet=Buffer.alloc(12+secret.length);packet.writeUInt32LE(secret.length);secret.copy(packet,4);packet.writeUInt32LE(1,4+secret.length);packet.writeUInt32LE(index,8+secret.length);child.stdin.write(packet);
 try{
  await ready;
  for(const member of [source,later]){
   let writable;try{writable=await fs.open(member,'r+');}catch(error){assert(['EACCES','EPERM','EBUSY'].includes(error.code),String(error));}
   if(writable){await writable.close();assert.fail('Archive volume allowed a writer while drag was active: '+member);}
   const moved=member+'.lock-test';let renamed=false;
   try{await fs.rename(member,moved);renamed=true;}catch(error){assert(['EACCES','EPERM','EBUSY'].includes(error.code),String(error));}
   if(renamed){await fs.rename(moved,member);assert.fail('Archive volume allowed replacement while drag was active: '+member);}
  }
  child.stdin.end(Buffer.from([1]));assert.equal(await complete,0,output+stderr);
  const entries=output.trim().split(/\r?\n/).map(JSON.parse).filter(item=>item.type==='drag-entry');assert(entries.some(item=>!item.directory&&item.bytes>0));
 }finally{clearTimeout(timer);if(child.exitCode===null){child.kill();await complete;}}
 const writable=await fs.open(later,'r+');await writable.close();
}

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-revision-'));let service;
 const keys=['TEMP','TMP','ONE_TEST_MODE','ONE_ARCHIVE_DRAG_TEST_TARGET'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_DRAG_TEST_TARGET:'1'});
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.resolve('dist/main/archive-revision-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  service=new mod.exports.ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const payload=path.join(root,'payload.bin');await fs.writeFile(payload,randomBytes(3*1024**2));
  const nested=path.join(root,'nested.zip'),inner=new JSZip();inner.file('inner.txt','inner');await fs.writeFile(nested,await inner.generateAsync({type:'nodebuffer'}));
  const families=[];
  for(const format of ['zip','7z']){
   const password=format==='7z'?'分卷 password':'',target=path.join(root,'split.'+format);
   const created=await run({operation:'create',path:target,sources:[payload,nested],volumeBytes:1024**2,level:0,password});
   families.push({source:created.path,later:format==='zip'?path.join(root,'split.z01'):target+'.002',password,name:'payload.bin',expected:hash(await fs.readFile(payload)),risk:true});
  }
  for(const family of [{base:'test_rar_multivolume_single_file',parts:3,digits:1,name:'LibarchiveAddingTest.html',expected:'ee16390e87152d7dec632ae2b37566da6135966e46b5166e6f40a1c827fa61ad'},
   {base:'test_read_format_rar5_multiarchive',parts:8,digits:2,name:'home/antek/temp/build/unrar5/libarchive/bin/bsdcat_test',expected:'b858933c12f1b907dac93a9428ae266c9fcb95df5cb88586fcd752a05305e1eb'}]){
   const dir=path.join(root,family.base);await fs.mkdir(dir);const part=index=>`${family.base}.part${String(index).padStart(family.digits,'0')}.rar`;
   for(let index=1;index<=family.parts;index++)await fs.copyFile(path.resolve('tests/fixtures/rar',part(index)),path.join(dir,part(index)));
   families.push({...family,source:path.join(dir,part(1)),later:path.join(dir,part(2)),password:''});
  }
  const parent=path.join(root,'output');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'keep.txt'),'original');
  for(const family of families){
   const {source,later,password,name,expected}=family,sourceBytes=hash(await fs.readFile(source)),fixed=new Date(Date.UTC(2020,0,2));await fs.utimes(later,fixed,fixed);
   const listing=await run({operation:'list',path:source,password,browse:{directory:'',search:'',flat:true}}),revision=listing.revision;
   assert.match(revision,/^v2:[0-9a-f]{64}$/);assert.equal((await run({operation:'list',path:source,password})).revision,revision);
   const picked=listing.entries.find(entry=>normalized(entry.name)===name);assert(picked,JSON.stringify({source,entries:listing.entries}));const index=picked.index;
   const details={operation:'details',path:source,password,index,revision};assert.equal(normalized((await run(details)).details.entry.name),name);
   let approval={revision,maxBytes:64*1024**3,maxMilliseconds:30*60000};
   if(family.risk){const warning=await run({operation:'extract',path:source,password,parent});assert.equal(warning.risk.nested,1);assert.equal(warning.risk.revision,revision);approval.revision=warning.risk.revision;}
   // Identical bytes and identical write time, but a new file identity. The
   // entry volume is untouched: checking just that file cannot catch this.
   const before=await fs.stat(later,{bigint:true}),bytes=await fs.readFile(later),replacement=later+'.replacement';await fs.writeFile(replacement,bytes);await fs.utimes(replacement,fixed,fixed);await fs.rename(replacement,later);
   const after=await fs.stat(later,{bigint:true});assert.notEqual(before.ino,after.ino);assert.equal(before.mtimeNs,after.mtimeNs);assert.equal(before.size,after.size);assert.equal(hash(await fs.readFile(source)),sourceBytes);
   const extract={operation:'extract',path:source,password,parent,selected:[index],revision};
   await assert.rejects(run(details),/变化|changed/);
   await assert.rejects(run(extract),/变化|changed/);
   await assert.rejects(run({operation:'drag',path:source,password,selected:[index],revision}),/变化|changed/);
   await assert.rejects(run({...extract,revision:undefined,riskApproval:approval}),error=>error.code==='safety'&&/变化|changed/.test(error.message));
   assert.deepEqual(await fs.readdir(parent),['keep.txt']);
   const fresh=await run({operation:'list',path:source,password});assert.notEqual(fresh.revision,revision);
   assert.equal(normalized((await run({...details,revision:fresh.revision})).details.entry.name),name);
   const output=await run({...extract,revision:fresh.revision});assert.equal(hash(await fs.readFile(path.join(output.path,name))),expected);await fs.rm(output.path,{recursive:true});
   await lockedDrag(root,source,later,fresh.revision,index,password);
   await fs.utimes(later,fixed,new Date(fixed.getTime()+5000));await assert.rejects(run({...details,revision:fresh.revision}),/变化|changed/);
   const touched=await run({operation:'list',path:source,password});assert.notEqual(touched.revision,fresh.revision);
   const saved=later+'.saved';await fs.rename(later,saved);
   try{await assert.rejects(run({...extract,revision:touched.revision}));assert.deepEqual(await fs.readdir(parent),['keep.txt']);}finally{await fs.rename(saved,later);}
   assert.equal(hash(await fs.readFile(source)),sourceBytes);
  }
  assert.equal(await fs.readFile(path.join(parent,'keep.txt'),'utf8'),'original');
  console.log('Archive volume revisions passed: split ZIP, encrypted split 7Z, RAR4/5; later-volume replacement with identical bytes/time, stale details/selection/drag/approval, timestamps, missing volumes, fresh extraction and operation-scoped read locks. No Explorer windows.');
 }finally{if(service)await service.stop();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
