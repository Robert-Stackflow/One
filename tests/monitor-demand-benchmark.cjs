const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {readProcessCounters}=require('./app-memory-benchmark.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
 const out=path.resolve('work/monitor-benchmark');await fs.mkdir(out,{recursive:true});
 const mode=process.env.ONE_MONITOR_MODE||'capacity',name=process.env.ONE_BENCH_NAME||mode,exe=path.resolve(process.env.ONE_MONITOR_EXE||'dist/native/One.Monitor.exe');
 const child=spawn(exe,[mode,'1000'],{windowsHide:true,stdio:'pipe'}),frames=[],errors=[];let buffer='';
 child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffer+=data;let at;while((at=buffer.indexOf('\n'))>=0){try{const raw=JSON.parse(buffer.slice(0,at));frames.push({at:performance.now(),created:raw.created,volumes:raw.volumes.length,processes:raw.processes.length,payloadBytes:Buffer.byteLength(buffer.slice(0,at)),samplingWriters:raw.samplingWriters});}catch(e){errors.push(String(e));}buffer=buffer.slice(at+1);}});child.stderr.resume();
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let finished=false;
 try{
  for(let i=0;i<100&&!frames.length;i++)await delay(50);assert.ok(frames.length,'The helper must return a first sample');
  const process=[{pid:child.pid,name:'One.Monitor.exe'}],before=readProcessCounters(process);
  await delay(10000);const after=readProcessCounters(process);
  const seconds=(after.at-before.at)/1000,cpuSeconds=after.cpuSeconds-before.cpuSeconds;
  const stopAt=performance.now();child.stdin.end('stop\n');const exit=await Promise.race([exited,delay(5000).then(()=>{throw Error('Monitor shutdown timed out');})]);finished=true;assert.equal(exit.code,0);assert.deepEqual(errors,[]);
  const report={name,exe,mode,seconds,cpuSeconds,cpuPercentOneCore:cpuSeconds/seconds*100,privateResidentMiB:after.privateResident/1024**2,privateCommitMiB:after.private/1024**2,frameCount:frames.length,meanPayloadBytes:frames.reduce((n,f)=>n+f.payloadBytes,0)/frames.length,meanProcessCount:frames.reduce((n,f)=>n+f.processes,0)/frames.length,stopMs:performance.now()-stopAt,frames};
  if(mode==='capacity')assert.ok(frames.every(f=>f.processes===0&&f.samplingWriters===false));
  assert.ok(frames.every(f=>f.volumes>0));await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,frames:undefined}));
 }finally{if(!finished)child.kill();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
