const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const esbuild=require('esbuild');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const value=check();if(value)return value;await delay(30);}throw new Error('Live disk update timed out');}

async function main(){
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'one-disk-live-'));
 const output=path.join(work,'disk-service.cjs'),folder=path.join(work,'child'),old=path.join(folder,'old.bin'),added=path.join(folder,'added.bin');
 await fs.mkdir(folder);await fs.writeFile(old,Buffer.alloc(10));
 global.__diskScanControl={};
 await esbuild.build({entryPoints:['src/main/disk-service.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',plugins:[{name:'fake-native-scan',setup(build){build.onResolve({filter:/^\.\/native-scan$/},()=>({path:'native-scan',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function nativeScan(path,progress,complete){global.__diskScanControl.progress=progress;global.__diskScanControl.complete=complete;return {stop(){},kill(){}}}',loader:'js'}));}}]});
 const {DiskService}=require(output),events=[];const service=new DiskService(p=>events.push(p));
 const node=(file,parent,directory,size)=>({path:file,parent,name:path.basename(file),directory,size,modified:0});
 const base=[node(work,null,true,10),node(folder,work,true,10),node(old,folder,false,10)];
 try{
  service.start(work,()=>{});
  const progress=(nodes=base)=>global.__diskScanControl.progress({rootPath:work,path:old,bytes:10,files:1,directories:2,issues:0,nodes});
  progress();
  await fs.unlink(old);
  await until(()=>events.find(e=>e.phase==='scan'&&e.removed?.includes(old)&&e.bytes===0&&e.files===0));
  progress();
  assert.equal(events.at(-1).bytes,0,'stale native progress must not restore removed bytes');
  assert.equal(events.at(-1).files,0,'stale native progress must not restore removed file count');
  assert.ok(!events.at(-1).nodes.some(n=>n.path===old),'stale native progress must not restore removed file');
  await fs.writeFile(added,Buffer.alloc(25));
  await until(()=>events.find(e=>e.phase==='scan'&&e.nodes.some(n=>n.path===added)&&e.bytes===25&&e.files===1));
  progress();
  assert.equal(events.at(-1).bytes,25,'new file must survive stale native progress');
  assert.equal(events.at(-1).files,1);
  await fs.writeFile(added,Buffer.alloc(30));
  await until(()=>events.find(e=>e.phase==='scan'&&e.nodes.some(n=>n.path===added&&n.size===30)&&e.bytes===30&&e.files===1));
  progress();
  assert.equal(events.at(-1).bytes,30,'modified file must survive stale native progress');
  global.__diskScanControl.complete({rootPath:work,bytes:10,files:1,directories:2,issues:[]});
  await until(()=>events.find(e=>e.phase==='watch'&&e.bytes===30&&e.files===1));
  console.log('PASS disk changes update during scan and survive stale progress');
 }finally{service.stop();delete global.__diskScanControl;await fs.rm(work,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
