const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawn}=require('node:child_process');
const {build}=require('esbuild');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const suffix=index=>index===0?'.alz':'.'+String.fromCharCode(97+Math.floor((index-1)/100))+String((index-1)%100).padStart(2,'0');
async function load(source){const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-alz-split-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function native(args,password='',env={},tail=Buffer.alloc(0)){
 return new Promise((resolve,reject)=>{const child=spawn(path.resolve('dist/native/One.Archive.exe'),args,{windowsHide:true,env:{...process.env,...env}});let stdout='';const timer=setTimeout(()=>child.kill(),60000);child.stdout.on('data',data=>stdout+=data);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,events:stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))});});child.stdin.on('error',()=>{});const bytes=Buffer.from(password);child.stdin.end(Buffer.concat([u32(bytes.length),bytes,tail]));});
}
async function split(base,data,cuts){
 const payload=data.subarray(8,-16),points=[0,...cuts.filter(x=>x>0&&x<payload.length),payload.length].sort((a,b)=>a-b),unique=[...new Set(points)],volumes=[];
 for(let i=0;i+1<unique.length;++i){const header=Buffer.from('414c5a010a000000','hex');header.writeUInt16LE(i,6);const trailer=Buffer.from('434c5a010000000000000000434c5a02','hex');if(i+2<unique.length)trailer[15]=3;
  const target=base+suffix(i);await fs.writeFile(target,Buffer.concat([header,payload.subarray(unique[i],unique[i+1]),trailer]));volumes.push(target);}
 return volumes;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-alz-split-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;const results=[];
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{preparePreview}=await load('src/main/preview-service.ts'),{parseCli}=await load('src/main/archive-cli.ts'),{isArchivePath,isAlzPath}=await load('src/shared/archive-actions.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request),browse={directory:'',search:'',flat:true},folder=path.resolve('tests/fixtures/archives/alz-split'),manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
  for(const file of manifest.files){const data=await fs.readFile(path.join(folder,file.name));assert.equal(data.length,file.bytes);assert.equal(hash(data),file.sha256);checks++;}
  for(const set of manifest.sets){
   let baseline;
   for(let i=0;i<set.volumes.length;++i){const source=path.join(folder,set.volumes[i]);assert(isArchivePath(source));assert(isAlzPath(source));const listing=await run({operation:'list',path:source,browse});listing.entries.sort((a,b)=>a.index-b.index);assert.equal(listing.editable,false);assert.deepEqual(listing.entries.map(x=>[x.name.replaceAll('\\','/'),x.size]),set.expected.map(x=>[x.name,x.bytes]));if(baseline)assert.deepEqual(listing.entries,baseline.entries);else baseline=listing;
    assert.equal((await run({operation:'test',path:source})).count,set.expected.length);checks+=3;}
   const source=path.join(folder,set.volumes.at(-1)),parent=path.join(root,set.name+'.out');await fs.mkdir(parent);await run({operation:'extract',path:source,parent,destination:'here'});
   const sums=[];for(const expected of set.expected){const data=await fs.readFile(path.join(parent,expected.name));assert.equal(data.length,expected.bytes);assert.equal(hash(data),expected.sha256);sums.push(hash(data));checks++;}
   results.push({name:set.name,volumes:set.volumes.length,entries:set.expected.length,sha256:sums});
   const preview=await preparePreview(source,()=>{throw Error('Unexpected raw preview');},async()=>undefined);assert.equal(preview.nativeArchive,true);assert.equal(parseCli(['list',source],root).jobs[0].request.path,source);checks+=2;
   const selected=set.expected.findIndex(x=>x.bytes===Math.max(...set.expected.map(x=>x.bytes))),listing=await run({operation:'list',path:source,browse}),selectedParent=path.join(root,set.name+'.selected');await fs.mkdir(selectedParent);await run({operation:'extract',path:source,selected:[selected],revision:listing.revision,parent:selectedParent,destination:'here'});assert.equal(hash(await fs.readFile(path.join(selectedParent,set.expected[selected].name))),set.expected[selected].sha256);checks++;
   const packet=Buffer.concat([u32(1),u32(selected),Buffer.from([1])]),drag=await native(['drag-test',source,path.join(root,set.name+'.drag'),'0',listing.revision],'',{ONE_TEST_MODE:'1'},packet);assert.equal(drag.code,0,JSON.stringify(drag.events));assert.equal(drag.events.filter(x=>x.type==='drag-entry').length,1);checks++;
  }
  // Split existing independently verified codecs and passwords at header,
  // cipher-header and buffer boundaries without changing any encoded bytes.
  const singles=JSON.parse(await fs.readFile('tests/fixtures/archives/alz/manifest.json','utf8'));
  for(const name of ['methods.alz','encrypted.alz','korean-password.alz','dlz-multiblock.alz']){
   const fixture=singles.files.find(x=>x.name===name),data=await fs.readFile(path.join('tests/fixtures/archives/alz',name)),volumes=await split(path.join(root,name+'-split'),data,[1,3,7,14,19,31,43,44,45,46,47,48,49,50,51,52,53,54,70,90,128,65535,65536,65537,131071,data.length-27]),source=volumes.at(-1),request={path:source,password:fixture.password,encoding:fixture.encoding};
   await run({...request,operation:'test'});const parent=path.join(root,name+'.out');await fs.mkdir(parent);await run({...request,operation:'extract',parent,destination:'here'});for(const item of fixture.expected)assert.equal(hash(await fs.readFile(path.join(parent,item.name))),item.sha256);checks+=2;
   if(fixture.password){await assert.rejects(run({...request,operation:'test',password:'incorrect'}),error=>error.code==='password');checks++;}
  }
  // Large volume ordinals transition a99 -> b00; the selected alias still
  // binds every physical member into its revision.
  const small=await fs.readFile('tests/fixtures/archives/alz/methods.alz'),many=await split(path.join(root,'many'),small,Array.from({length:102},(_,i)=>i+1));assert(many.some(x=>x.endsWith('.b00')));await run({operation:'test',path:many.at(-1)});checks++;
  const base=path.join(root,'guard'),guard=await split(base,small,[31,100]),first=guard[0],middle=guard[1],last=guard[2],listing=await run({operation:'list',path:first,browse}),parent=path.join(root,'guard.out');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'sentinel'),'keep');const original=await fs.readFile(middle);
  const damaged=Buffer.from(original);damaged[10]^=1;await fs.writeFile(middle,damaged);await assert.rejects(run({operation:'extract',path:first,revision:listing.revision,parent,destination:'here'}),/changed|变化/i);assert.deepEqual(await fs.readdir(parent),['sentinel']);checks++;
  for(const [label,mutate] of [['ordinal',b=>b.writeUInt16LE(9,6)],['version',b=>b.writeUInt16LE(9,4)],['tail',b=>b[b.length-1]=4],['reserved',b=>b[b.length-8]=1]]){
   const bad=Buffer.from(original);mutate(bad);await fs.writeFile(middle,bad);await assert.rejects(run({operation:'extract',path:first,parent,destination:'here'}));assert.deepEqual(await fs.readdir(parent),['sentinel']);checks++;}
  for(const length of [0,7,8,23,original.length-1]){await fs.writeFile(middle,original.subarray(0,length));await assert.rejects(run({operation:'list',path:first}));checks++;}
  await fs.unlink(middle);await assert.rejects(run({operation:'list',path:first}),/ALZ 分卷.*a00/);checks++;
  await fs.writeFile(middle,original);await fs.unlink(last);await assert.rejects(run({operation:'list',path:middle}),/ALZ 分卷.*a01/);assert.deepEqual(await fs.readdir(parent),['sentinel']);checks++;
  const corruptFolder=path.join(root,'corrupt-payload');await fs.mkdir(corruptFolder);const storedSet=manifest.sets.find(x=>x.name==='split_store.alz');for(const name of storedSet.volumes)await fs.copyFile(path.join(folder,name),path.join(corruptFolder,name));
  for(const name of storedSet.volumes){const file=path.join(corruptFolder,name),valid=await fs.readFile(file),bad=Buffer.from(valid);bad[100]^=1;await fs.writeFile(file,bad);
   await assert.rejects(run({operation:'extract',path:path.join(corruptFolder,'split_store.a01'),parent,destination:'here'}),/CRC32/);assert.deepEqual(await fs.readdir(parent),['sentinel']);await fs.writeFile(file,valid);checks++;}
  const limit=await native(['test',path.join(folder,'split.alz')],'',{ONE_ARCHIVE_EXTRACT_MAX_BYTES:'4096'});assert.equal(limit.events.at(-1)?.code,'resource');checks++;
  const excessive=path.join(root,'excessive.k23');await fs.writeFile(excessive,small);await assert.rejects(run({operation:'list',path:excessive}),error=>error.code==='resource');checks++;
  const evidence=path.resolve('verification/archive-alz-split');await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'latest.json'),JSON.stringify({date:new Date().toISOString(),checks,repository:manifest.repository,referenceCommit:manifest.commit,results,generated:'Existing verified Store/Deflate/DLZ/standard BZh/ZipCrypto streams partitioned across arbitrary header/data/buffer boundaries; a99/b00 transition.'},null,2)+'\n');console.log(`ALZ split passed: ${checks} checks, 11 pinned external volumes, every entry volume, exact hashes, encrypted/DLZ boundaries, ordinal transitions, revisions, cleanup, preview, drag and CLI.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
