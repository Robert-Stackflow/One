const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const Module=require('node:module');
const {build}=require('esbuild');
const JSZip=require('jszip');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const normalName=name=>name.replace(/\\/g,'/');
async function load(source){const compiled=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-formats-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);return mod.exports;}
async function files(root,prefix=''){const result=[];for(const item of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){const name=prefix+item.name;if(item.isDirectory())result.push(...await files(root,name+'/'));else result.push(name);}return result.sort();}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-formats-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,checks=0;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{preparePreview}=await load('src/main/preview-service.ts'),{previewArchive}=await load('src/main/preview-archive.ts'),{parseCli}=await load('src/main/archive-cli.ts'),{isArchivePath,archiveBaseName,isCompositeArchive}=await load('src/shared/archive-actions.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=async request=>{try{return await service.run(1,request);}catch(error){error.message=`${request.operation} ${path.basename(request.path)}: ${error.message}`;throw error;}},browse={directory:'',search:'',flat:true};
  const directory=path.resolve('tests/fixtures/archives'),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  const verify=async (output,expected)=>{assert.deepEqual(await files(output),expected.map(item=>item.name).sort());for(const item of expected){const bytes=await fs.readFile(path.join(output,item.name));assert.equal(bytes.length,item.bytes,item.name);assert.equal(hash(bytes),item.sha256,item.name);}checks++;};
  for(const fixture of manifest.files){
   const stored=await fs.readFile(path.join(directory,fixture.stored)),bytes=fixture.stored.endsWith('.gz')?zlib.gunzipSync(stored):stored;assert.equal(bytes.length,fixture.bytes);assert.equal(hash(bytes),fixture.sha256);
   const source=path.join(root,fixture.name);await fs.writeFile(source,bytes);assert(isArchivePath(source));
   const parent=path.join(root,fixture.name+'.output');await fs.mkdir(parent);
   if(fixture.unsupported){for(const operation of ['list','test','extract'])await assert.rejects(run({operation,path:source,parent,destination:'here'}),/Cannot open archive|headers|头部/i);assert.deepEqual(await fs.readdir(parent),[]);checks+=3;continue;}
   if(fixture.unsafe){await assert.rejects(run({operation:'list',path:source,browse}),error=>error.code==='safety');await assert.rejects(run({operation:'extract',path:source,parent,destination:'here'}),error=>error.code==='safety');await run({operation:'test',path:source});assert.deepEqual(await fs.readdir(parent),[]);checks+=3;continue;}
   const listing=await run({operation:'list',path:source,browse});assert.equal(listing.editable,false,fixture.name);assert(listing.revision);assert.deepEqual(listing.entries.filter(entry=>!entry.directory).map(entry=>normalName(entry.name)).sort(),fixture.expected.map(item=>item.name).sort(),fixture.name);checks++;
   const preview=await preparePreview(source,()=>{throw Error('Native archive preview must not expose raw assets');},async()=>undefined);assert.equal(preview.type,'archive');assert.equal(preview.nativeArchive,true);
   assert.equal((await previewArchive(()=>preview,{path:source,browse},crypto.randomUUID(),(request,id)=>service.run(2,request,id))).total,listing.total);checks++;
   assert.equal(parseCli(['list',source],root).jobs[0].request.path,source);checks++;
   const tested=await run({operation:'test',path:source});assert(tested.count>=fixture.expected.length);checks++;
   const first=listing.entries.find(entry=>!entry.directory);assert(first);const details=await run({operation:'details',path:source,index:first.index,revision:listing.revision});assert.equal(details.details.entry.name,first.name);checks++;
   await run({operation:'extract',path:source,parent,destination:'here',revision:listing.revision});await verify(parent,fixture.expected);
   const selected=path.join(root,fixture.name+'.selected');await fs.mkdir(selected);await run({operation:'extract',path:source,parent:selected,destination:'here',revision:listing.revision,selected:[first.index]});await verify(selected,fixture.expected.filter(item=>item.name===normalName(first.name)));
   await assert.rejects(run({operation:'update',path:source,revision:listing.revision,changes:[{kind:'delete',indexes:[first.index]}]}),/ZIP 和 7Z/);assert.throws(()=>parseCli(['update','--changes','changes.json',source],root),/ZIP and 7Z/);checks++;
   assert.equal(hash(await fs.readFile(source)),fixture.sha256,'Read-only source changed');
  }
  const aliases=[['payload.txt.bz2','payload.txt.BZIP2',false],['payload.tar.bz2','payload.TBZ',true],['payload.tar.bz2','payload.TBZ2',true],['test_compat_zstd_1.tar.zst','payload.TZST',true],['test_compat_zstd_1.tar.zst','payload.tar.ZSTD',true],['test_compat_zstd_1.tar.zst','payload.ZST',false],['test_compat_zstd_1.tar.zst','payload.ZSTD',false],['test_read_format_lha_bugfix_0.lzh','payload.LHA',false]];
  for(const [original,name,composite] of aliases){const target=path.join(root,name);await fs.copyFile(path.join(root,original),target);assert(isArchivePath(target));assert.equal(isCompositeArchive(target),composite);assert.equal(archiveBaseName(name),name.includes('.txt.')?'payload.txt':'payload');const result=await run({operation:'list',path:target,browse});assert(result.entries.length>0);assert.equal(result.editable,false);await run({operation:'test',path:target});checks++;}
  for(const extension of ['jar','apk','zipx']){
   const zip=new JSZip();zip.file('目录/中文.txt','signed container bytes');zip.file('binary.bin',Buffer.from([0,255,1,2]));const source=path.join(root,'sample.'+extension);await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
   const listing=await run({operation:'list',path:source,browse});assert.equal(listing.editable,false);assert.equal(listing.entries.filter(entry=>!entry.directory).length,2);await run({operation:'test',path:source});
   const parent=path.join(root,extension);await fs.mkdir(parent);await run({operation:'extract',path:source,parent,destination:'here'});assert.equal(await fs.readFile(path.join(parent,'目录/中文.txt'),'utf8'),'signed container bytes');
   await assert.rejects(run({operation:'update',path:source,revision:listing.revision,changes:[]}),/ZIP 和 7Z/);checks++;
   const unsafe=new JSZip();unsafe.file('../escape.txt','blocked');const bad=path.join(root,'unsafe.'+extension);await fs.writeFile(bad,await unsafe.generateAsync({type:'nodebuffer'}));const empty=path.join(root,'unsafe-'+extension);await fs.mkdir(empty);await assert.rejects(run({operation:'extract',path:bad,parent:empty,destination:'here'}));assert.deepEqual(await fs.readdir(empty),[]);checks++;
  }
  const stream=path.join(root,'payload.txt.bz2'),unknown=await run({operation:'list',path:stream});assert.equal(unknown.entries[0].sizeKnown,false);assert.equal((await run({operation:'details',path:stream,index:0,revision:unknown.revision})).details.entry.sizeKnown,false);await assert.rejects(run({operation:'drag',path:stream,revision:unknown.revision,selected:[0]}),/先解压/);checks++;
  const input=path.join(root,'input.txt');await fs.writeFile(input,'source');
  for(const extension of ['bz2','zst','cab','lha','iso','wim','jar','apk','zipx','tar.bz2','tar.zst']){const target=path.join(root,'not-created.'+extension);await assert.rejects(run({operation:'create',path:target,sources:[input]}),/不支持/);assert.throws(()=>parseCli(['create','--output',target,input],root),/Unsupported output/);assert.equal(await fs.stat(target).catch(()=>null),null);checks++;}
  for(const extension of ['bz2','zst','cab','lzh','iso','wim','zipx']){const source=path.join(root,'truncated.'+extension);await fs.writeFile(source,Buffer.from('truncated'));await assert.rejects(run({operation:'list',path:source}));checks++;}
  // New containers participate in the existing nested-archive approval flow.
  for(const extension of ['zipx','jar','apk','cab','lha','iso','wim','bzip2','zstd','tbz2','tzst']){const zip=new JSZip();zip.file('nested.'+extension,'payload');const source=path.join(root,'nested-'+extension+'.zip');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));const parent=path.join(root,'nested-'+extension);await fs.mkdir(parent);const result=await run({operation:'extract',path:source,parent,destination:'here'});assert.equal(result.count,0);assert.equal(result.risk?.nested,1,'Nested container: '+extension);assert.deepEqual(await fs.readdir(parent),[]);checks++;}
  console.log(`Archive read formats passed: ${checks} checks, ${manifest.files.length} pinned/generated fixtures, byte hashes, selective extraction, preview/CLI, aliases, read-only guards, malformed files and traversal/nested risks.`);
 }finally{await service?.stop();for(const key of ['TEMP','TMP'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
