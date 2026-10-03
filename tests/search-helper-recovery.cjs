const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('esbuild');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await wait(50);}throw Error('Timeout: '+label);}

async function run(){
 const base=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-helper-recovery');
 await fs.mkdir(base,{recursive:true});
 const profile=await fs.mkdtemp(path.join(base,'profile-'));
 const native=path.join(profile,'native'),module=path.join(profile,'main','service.cjs'),root=path.join(profile,'files');
 let service;
 try{
  await fs.mkdir(native);await fs.mkdir(root);
  await fs.copyFile(path.resolve('dist/native/One.Index.exe'),path.join(native,'One.Index.exe'));
  await fs.writeFile(path.join(root,'recovery-fixture.txt'),'fixture');
  await build({entryPoints:['src/main/search-service.ts'],outfile:module,bundle:true,platform:'node'});
  const {SearchService}=require(module),states=[];
  service=new SearchService(path.join(profile,'index.bin'),{roots:[root],excluded:[],maxEntries:1000,fuzzy:true,pinyin:true,priorities:[]},state=>states.push({...state}));
  await until(()=>service.state().count>=1&&!service.state().running,'initial index');
  assert.equal((await service.query('recovery-fixture')).total,1);
  const old=service.child,originalPid=old.pid;
  old.kill();
  await until(()=>old.exitCode!==null||old.signalCode!==null,'helper exit');
  assert.doesNotThrow(()=>service.releaseScope(42),'closing a window after helper exit must not throw');
  service.launchers([]);
  await until(()=>service.child.pid!==originalPid&&service.state().count>=1&&!service.state().running&&!service.state().error,'automatic helper recovery');
  assert.equal((await service.query('recovery-fixture')).total,1);
  assert.ok(states.some(state=>state.error==='搜索服务正在恢复'));
  console.log(JSON.stringify({result:'PASS',oldPid:originalPid,newPid:service.child.pid,states:states.length}));
 }finally{
  if(service)await service.stop();
  const resolved=await fs.realpath(profile),parent=await fs.realpath(base);
  assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
