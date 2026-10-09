const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),Module=require('node:module');
const {build}=require('esbuild');
const cp=require('node:child_process'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const crypto=require('node:crypto');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/archive-watchdog-'));let service,child,childDone;
 const keys=['ONE_TEST_MODE','ONE_ARCHIVE_HEARTBEAT_TEST_MS','ONE_ARCHIVE_HEARTBEAT_TIMEOUT_MS','ONE_ARCHIVE_IDLE_TIMEOUT_MS','TEMP','TMP'];const old=Object.fromEntries(keys.map(key=>[key,process.env[key]])),spawn=cp.spawn;
 try{
  const output=await build({entryPoints:['src/main/archive-watchdog.ts','src/main/archive-service.ts','src/main/archive-cli.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const file=path.resolve(`dist/main/${name}-watchdog-test.cjs`),mod=new Module(file);mod.filename=file;mod.paths=module.paths;mod._compile(output.outputFiles.find(item=>item.path.endsWith(name+'.js')).text,file);return mod.exports;};
  const {ArchiveWatchdog,archiveWatchdogLimits}=load('archive-watchdog'),{ArchiveService}=load('archive-service'),{cliExit}=load('archive-cli');
  assert.equal(cliExit({code:'timeout'}),12);
  // Deterministic clock: repeated heartbeats/progress do not indefinitely
  // postpone the idle deadline; close and protected phases cannot kill.
  const date=Date.now,set=global.setTimeout,clear=global.clearTimeout;let now=0,serial=0;const timers=new Map();
  const advance=ms=>{const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];if(!next||next[1].due>end)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;};
  const create=(limits,exempt,failed)=>new ArchiveWatchdog(limits,exempt,failed,()=>now);
  try{
   Date.now=()=>now;global.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,due:now+ms});return id;};global.clearTimeout=id=>timers.delete(id);
   let failures=[];const absent=create({heartbeatMs:100,idleMs:500},()=>false,reason=>failures.push(reason));advance(100);assert.deepEqual(failures,['heartbeat']);absent.close();
   failures=[];const idle=create({heartbeatMs:200,idleMs:100},()=>false,reason=>failures.push(reason));advance(50);idle.heartbeat(0);advance(50);idle.heartbeat(0);advance(50);assert.deepEqual(failures,['idle']);idle.close();
   failures=[];const live=create({heartbeatMs:100,idleMs:100},()=>false,reason=>failures.push(reason));for(let i=0;i<20;i++){advance(50);live.heartbeat(i);}assert.deepEqual(failures,[]);live.close();advance(1000);assert.deepEqual(failures,[]);
   let protectedPhase=true;const protectedTask=create({heartbeatMs:100,idleMs:100},()=>protectedPhase,reason=>failures.push(reason));advance(1000);assert.deepEqual(failures,[]);protectedPhase=false;advance(100);assert.deepEqual(failures,['heartbeat']);protectedTask.close();
   const invalid=create({heartbeatMs:100,idleMs:100},()=>true,()=>{});for(const value of [-1,NaN,Infinity,1.5,undefined])assert.throws(()=>invalid.heartbeat(value));invalid.heartbeat(2);assert.throws(()=>invalid.heartbeat(1));invalid.close();assert.equal(timers.size,0);
  }finally{Date.now=date;global.setTimeout=set;global.clearTimeout=clear;}
  Object.assign(process.env,{ONE_TEST_MODE:'1',ONE_ARCHIVE_HEARTBEAT_TIMEOUT_MS:'120',ONE_ARCHIVE_IDLE_TIMEOUT_MS:'200',TEMP:root,TMP:root});
  assert.deepEqual(archiveWatchdogLimits(),{heartbeatMs:120,idleMs:200});process.env.ONE_TEST_MODE='0';assert.deepEqual(archiveWatchdogLimits(),{heartbeatMs:30000,idleMs:1800000});process.env.ONE_TEST_MODE='1';
  const source=path.join(root,'source.txt'),probe=path.join(root,'probe.zip');await fs.writeFile(source,'watchdog source');await fs.writeFile(probe,'controlled engine input');const events=[];service=new ArchiveService(path.join(root,'cache'),()=>{},()=> '0',(event,detail)=>events.push({event,detail}));
  let mode='silent',last;const mocks=[];
  cp.spawn=function(file,args,...rest){if(!String(file).endsWith('One.Archive.exe'))return spawn.call(this,file,args,...rest);
   const item=new EventEmitter();Object.assign(item,{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),killed:false,pid:1});let closed=false,timer;const close=code=>{if(closed)return;closed=true;clearInterval(timer);item.stdout.end();item.stderr.end();item.emit('close',code);};item.kill=()=>{item.killed=true;setImmediate(()=>close(1));return true;};item.finish=()=>{item.stdout.write('{"type":"result","count":1}\n');close(0);};item.cleanup=()=>{clearInterval(timer);close(1);};last=item;mocks.push(item);
   setImmediate(()=>{if(mode==='constant'){item.stdout.write('{"type":"heartbeat","activity":0}\n');timer=setInterval(()=>item.stdout.write('{"type":"heartbeat","activity":0}\n{"type":"progress","done":0,"total":1}\n'),40);}else if(mode==='commit')item.stdout.write('{"type":"ready"}\n');else if(mode==='complete')item.finish();else if(mode==='invalid')item.stdout.write('{"type":"heartbeat","activity":-1}\n');});return item;
  };
  try{
   for(const [current,reason] of [['silent','heartbeat'],['constant','idle']]){mode=current;const target=path.join(root,current+'.zip');await assert.rejects(service.run(1,{operation:'create',path:target,sources:[source]}),error=>error.code==='timeout');assert(last.killed);assert(events.some(item=>item.event==='archive-timeout'&&JSON.parse(item.detail).reason===reason));await assert.rejects(fs.stat(target),{code:'ENOENT'});assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')));}
   mode='invalid';await assert.rejects(service.run(1,{operation:'test',path:probe}),error=>error.code==='archive');assert(last.killed);
   // Exercise the actual service ready handling, not only a timer predicate.
   mode='commit';const perform=service.perform.bind(service);service.perform=async(owner,request,id)=>{await service.execute(owner,id,'publish',[], '');return {path:request.path,count:1};};
   const saving=service.run(1,{operation:'create',path:path.join(root,'protected.zip'),sources:[source]});await sleep(350);assert(!last.killed,'protected publication must never be killed by watchdog');last.finish();await saving;
   // Identity-driven recovery can resume after a hard exit. Unlike final
   // publication, its ready handshake must not disable liveness monitoring.
   for(const operation of ['recover','cleanup']){
    service.perform=async(owner,request,id)=>{await service.execute(owner,id,operation,[], '');return {path:request.path,count:1};};
    await assert.rejects(service.run(1,{operation:'create',path:path.join(root,operation+'.zip'),sources:[source]}),error=>error.code==='timeout');assert(last.killed,'Unresponsive recovery/cleanup must remain under watchdog after ready');
   }service.perform=perform;
  }finally{for(const item of mocks)item.cleanup();cp.spawn=spawn;}
  // Real engine proof: hold the private request frame to observe liveness,
  // then create a sizeable ZIP and observe advancing I/O activity separately.
  Object.assign(process.env,{ONE_ARCHIVE_HEARTBEAT_TEST_MS:'50',ONE_ARCHIVE_HEARTBEAT_TIMEOUT_MS:'1000',ONE_ARCHIVE_IDLE_TIMEOUT_MS:'3000'});
  const input=path.join(root,'random.bin'),archive=path.join(root,'actual.zip');await fs.writeFile(input,crypto.randomBytes(32*1024**2));
  child=spawn(path.resolve('dist/native/One.Archive.exe'),['create',archive,input],{windowsHide:true,stdio:'pipe',env:process.env});let text='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>text+=chunk);child.stderr.resume();const done=childDone=new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});const timeout=setTimeout(()=>child.kill(),15000);
  try{await sleep(180);assert(text.includes('"type":"heartbeat"'));child.stdin.end(Buffer.alloc(4));assert.equal(await done,0,text);child=undefined;}finally{clearTimeout(timeout);}
  const records=text.trim().split(/\r?\n/).map(JSON.parse),heartbeats=records.filter(item=>item.type==='heartbeat');assert(heartbeats.some(item=>item.activity===0));assert(heartbeats.some(item=>item.activity>0));assert.equal(records.at(-1).type,'result');assert.equal((await service.run(1,{operation:'test',path:archive})).count,1);
  await service.stop();service=undefined;console.log('Archive watchdog passed: missing/unchanging/advancing heartbeats, idle detection, validation, protected publication, failure cleanup, test-only overrides and real ZIP I/O liveness.');
 }finally{cp.spawn=spawn;child?.kill();await childDone?.catch(()=>{});await service?.stop();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
