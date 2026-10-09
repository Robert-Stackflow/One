// Abrupt native exits bypass rollback, unlike ordinary injected exceptions.
// All victims and originals belong to this test's private workspace directory.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const Module=require('node:module');
const JSZip=require('jszip');
const helper=path.resolve('dist/native/One.Archive.exe');
const crcTable=Array.from({length:256},(_,i)=>{let value=i;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(previous,text){let value=previous^0xffffffff;for(const byte of Buffer.from(text))value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
async function records(directory){
 const text=await fs.readFile(path.join(directory,'manifest.jsonl'),'utf8');assert(text.endsWith('\n'),'all acknowledged records are complete');
 let crc=0;return text.trimEnd().split('\n').map((line,index)=>{
  const entry=JSON.parse(line),suffix=line.lastIndexOf(',"crc32":');assert(suffix>0);assert.equal(entry.sequence,index);
  crc=crc32(crc,line.slice(0,suffix));assert.equal(entry.crc32,crc.toString(16).padStart(8,'0'),'ordered journal checksum');return entry.record;
 });
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-journal-'));let service;
 try{
  let serial=0;
  const fixture=async()=>{
   const parent=path.join(root,'中文 '+serial++),stage=path.join(parent,'.one-extract-'+randomUUID()),recovery=path.join(parent,'.one-recovery-'+randomUUID());await fs.mkdir(stage,{recursive:true});
   for(const [name,text]of Object.entries({'a.txt':'original a','z.txt':'original z'}))await fs.writeFile(path.join(parent,name),text);
   for(const [name,text]of Object.entries({'a.txt':'new a','z.txt':'new z','目录/文件.txt':'文件 😀'})){await fs.mkdir(path.dirname(path.join(stage,name)),{recursive:true});await fs.writeFile(path.join(stage,name),text);}
   return{parent,stage,recovery};
  };
  const run=(job,point,extra={},status=77)=>{
   const result=spawnSync(helper,['publish',job.stage,job.parent,job.recovery,'replace'],{env:{...process.env,ONE_TEST_MODE:'1',ONE_ARCHIVE_PUBLISH_CRASH_POINT:point,TEMP:root,TMP:root,...extra},input:Buffer.from([0,0,0,0,1]),encoding:'utf8',timeout:30000});
   assert.equal(result.status,status,JSON.stringify(result));return result;
  };
  const read=(job,name)=>fs.readFile(path.join(job.parent,name),'utf8');
  const missing=file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
  let job=await fixture();run(job,'prepared');let rows=await records(job.recovery);
  assert.equal(rows[0].type,'header');assert.equal(rows[0].version,2);assert.equal(rows[0].parent,job.parent);assert.equal(rows[0].stage,job.stage);assert.equal(rows[0].recovery,job.recovery);
  for(const key of ['parentIdentity','stageIdentity','recoveryIdentity'])assert.match(rows[0][key],/^\d+:\d+:\d+$/);
  const planned=rows.filter(row=>row.type==='item');assert.equal(planned.length,4);assert.equal(rows.at(-1).type,'prepared');assert.equal(rows.at(-1).items,4);
  assert.equal(planned[0].existing,true);assert.equal(planned[0].source,path.join(job.stage,'a.txt'));assert.equal(planned[0].target,path.join(job.parent,'a.txt'));assert.equal(planned[0].backup,path.join(job.recovery,'0.original'));assert.match(planned[0].sourceStamp,/^(\d+:){6}\d+$/);
  assert.equal(await read(job,'a.txt'),'original a');await missing(path.join(job.recovery,'0.original'));
  job=await fixture();run(job,'backup:0');rows=await records(job.recovery);assert.equal(rows.at(-1).type,'prepared');await missing(path.join(job.parent,'a.txt'));assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'original a');assert.equal(await fs.readFile(path.join(job.stage,'a.txt'),'utf8'),'new a');
  // Batched progress records may be lost; the durable plan and file identities
  // must remain sufficient to recognise a moved file without a commit marker.
  job=await fixture();run(job,'published:0');rows=await records(job.recovery);assert.equal(rows.at(-1).type,'prepared');assert(!rows.some(row=>row.type==='committed'));assert.equal(await read(job,'a.txt'),'new a');assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'original a');assert.equal(await read(job,'z.txt'),'original z');
  job=await fixture();run(job,'committed');rows=await records(job.recovery);assert.deepEqual(rows.at(-1),{type:'committed',count:4,skipped:0});assert.equal(rows.filter(row=>row.type==='published').length,4);assert.equal(rows.filter(row=>row.type==='directory-created').length,1);assert.equal(await read(job,'目录/文件.txt'),'文件 😀');assert.equal(await fs.readFile(path.join(job.recovery,'1.original'),'utf8'),'original z');
  job=await fixture();run(job,'cleanup:0');rows=await records(job.recovery);assert.equal(rows.at(-1).type,'committed');await missing(path.join(job.recovery,'0.original'));assert.equal(await fs.readFile(path.join(job.recovery,'1.original'),'utf8'),'original z');assert.equal(await read(job,'a.txt'),'new a');
  // Inability to record the commit decision restores old contents; no backup
  // cleanup starts before a successful completion barrier.
  job=await fixture();run(job,'',{ONE_ARCHIVE_PUBLISH_JOURNAL_FAIL_AT_SEQUENCE:'11'},2);rows=await records(job.recovery);assert(!rows.some(row=>row.type==='committed'));assert.equal(await read(job,'a.txt'),'original a');assert.equal(await read(job,'z.txt'),'original z');await missing(path.join(job.parent,'目录'));
  // Environment fault points are ignored in ordinary production runs.
  job=await fixture();run(job,'committed',{ONE_TEST_MODE:'0'},0);assert.equal(await read(job,'a.txt'),'new a');await missing(job.recovery);

  // A hard-exited publisher is reported with its known recovery directory;
  // the main service still removes only its unpublished staging directory.
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-journal-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(compiled.outputFiles[0].text,filename);
  const parent=path.join(root,'service'),source=path.join(root,'source.zip'),id=randomUUID();await fs.mkdir(parent);await fs.writeFile(path.join(parent,'a.txt'),'service original');const zip=new JSZip();zip.file('a.txt','service replacement');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));
  const priorMode=process.env.ONE_TEST_MODE,priorPoint=process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;
  process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT='published:0';service=new mod.exports.ArchiveService(path.join(root,'cache'),()=>{});
  try{await assert.rejects(service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'},id),error=>error.message.includes('恢复资料')&&error.message.includes(path.join(parent,'.one-recovery-'+id)));}
  finally{if(priorMode===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=priorMode;if(priorPoint===undefined)delete process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;else process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT=priorPoint;}
  assert.equal(await fs.readFile(path.join(parent,'.one-recovery-'+id,'0.original'),'utf8'),'service original');await missing(path.join(parent,'.one-extract-'+id));assert.equal((await records(path.join(parent,'.one-recovery-'+id))).at(-1).type,'prepared');
  await service.stop();service=undefined;
  console.log('Extraction journal passed: chained records, complete plan, identities, abrupt exits before/after replacement and commit/cleanup, write failure rollback, production fault isolation and retained recovery reporting.');
 }finally{await service?.stop();const scope=path.relative(path.resolve('work/temp'),root);assert(scope&&!scope.startsWith('..')&&!path.isAbsolute(scope));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
