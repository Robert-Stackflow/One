const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {build}=require('esbuild');
async function load(source){const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',write:false});const file=path.resolve('dist/main/archive-preview-test.cjs'),mod=new Module(file);mod.filename=file;mod.paths=module.paths;mod._compile(result.outputFiles[0].text,file);return mod.exports;}
(async()=>{
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-preview-'));let service;
 try{
  const {ArchiveService}=await load('src/main/archive-service.ts'),{previewArchive}=await load('src/main/preview-archive.ts'),{preparePreview}=await load('src/main/preview-service.ts');
  service=new ArchiveService(path.join(root,'cache'),()=>{});
  const source=path.join(root,'资料.txt');await fs.writeFile(source,'archive preview');
  for(const format of ['zip','7z','tar','tar.gz','tar.xz','gz','xz']){
   const file=path.join(root,'preview.'+format);await service.run(1,{operation:'create',path:file,sources:[source]});
   const data=await preparePreview(file,()=>{throw Error('Archive preview must not register raw assets');},async()=>undefined);
   assert.equal(data.type,'archive');assert.equal(data.nativeArchive,true);
   const listing=await previewArchive(()=>data,{path:file,browse:{directory:'',search:'',flat:false}},crypto.randomUUID(),(request,id)=>service.run(2,request,id));
   assert.equal(listing.entries.length,1);assert(!listing.entries[0].directory);
  }
  for(const format of ['rar4','rar5']){
   const file=path.resolve(`tests/fixtures/${format}-sample.rar`),data=await preparePreview(file,()=>'',async()=>undefined);
   const result=await previewArchive(()=>data,{path:file},crypto.randomUUID(),(request,id)=>service.run(2,request,id));assert(result.entries.length>0);
  }
  let data={path:path.join(root,'preview.zip'),type:'archive'},called=0;
  const run=async request=>{++called;assert.equal(request.operation,'list');assert(!('sources' in request));return {path:data.path,entries:[],total:0,offset:0,comment:''};};
  await assert.rejects(previewArchive(()=>data,{path:source},crypto.randomUUID(),run),/切换/);assert.equal(called,0);
  await previewArchive(()=>data,{path:data.path,operation:'extract',sources:[source]},crypto.randomUUID(),run);assert.equal(called,1);
  const previous=data;await assert.rejects(previewArchive(()=>data,{path:data.path},crypto.randomUUID(),async()=>{data={...previous};return {entries:[]};}),/切换/);
  console.log('Archive preview passed: seven archive families plus RAR4/5 use native listing; arbitrary paths/writes and stale preview results are rejected.');
 }finally{await service?.stop();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
