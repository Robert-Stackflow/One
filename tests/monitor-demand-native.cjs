const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
 const output=path.resolve('work/monitor-demand');await fs.mkdir(output,{recursive:true});const own=await fs.mkdtemp(path.join(output,'run-')),file=path.join(own,'writer.bin');
 const writer=spawn(process.execPath,['-e','const fs=require("node:fs"),h=fs.openSync(process.argv[1],"wx"),b=Buffer.alloc(65536,41);setInterval(()=>{fs.writeSync(h,b);fs.fsyncSync(h)},100);',file],{windowsHide:true,stdio:'ignore'}),writerExited=new Promise(resolve=>writer.once('exit',resolve));
 const child=spawn(path.resolve(process.env.ONE_MONITOR_EXE||'dist/native/One.Monitor.exe'),['capacity','60000'],{windowsHide:true,stdio:'pipe'}),exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));let buffer='',frames=[],closed=false;
 child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffer+=data;let index;while((index=buffer.indexOf('\n'))>=0){frames.push(JSON.parse(buffer.slice(0,index)));buffer=buffer.slice(index+1);}});child.stderr.resume();
 async function waitFor(test){for(let i=0;i<150;i++){const found=frames.find(test);if(found)return found;await delay(50);}throw Error('The monitor did not provide the requested mode');}
 try{
  const first=await waitFor(frame=>frame.samplingWriters===false);assert.equal(first.processes.length,0);assert.ok(first.volumes.some(v=>v.total>0));assert.ok(first.memoryTotal>0);
  const start=performance.now();child.stdin.write('writers 1 1\n');const sampled=await waitFor(frame=>frame.samplingEpoch===1);const switchMs=performance.now()-start;assert.equal(sampled.samplingWriters,true);assert.ok(sampled.processes.some(p=>p.pid===writer.pid));assert.ok(switchMs<3000,'Mode changes must interrupt the 60-second wait');
  await delay(250);child.stdin.write('writers 1 1\n');const again=await waitFor(frame=>frame.samplingEpoch===1&&frame.created>sampled.created);const a=sampled.processes.find(p=>p.pid===writer.pid),b=again.processes.find(p=>p.pid===writer.pid);assert.ok(b.bytes>a.bytes);assert.equal(a.started,b.started);assert.equal(a.path,b.path);assert.ok(a.path.toLowerCase().endsWith('node.exe'));
  child.stdin.write('writers 0 2\n');const off=await waitFor(frame=>frame.samplingEpoch===2);assert.equal(off.samplingWriters,false);assert.equal(off.processes.length,0);assert.ok(off.volumes.length>0);
  // Queued rapid mode changes may coalesce, but the final epoch must be preserved.
  child.stdin.write('writers 1 3\nwriters 0 4\nwriters 1 5\n');const last=await waitFor(frame=>frame.samplingEpoch===5);assert.equal(last.samplingWriters,true);assert.ok(last.processes.some(p=>p.pid===writer.pid));
  const at=performance.now();child.stdin.end('stop\n');const exit=await Promise.race([exited,delay(3000).then(()=>{throw Error('Monitor shutdown did not wake the wait');})]);closed=true;assert.equal(exit.code,0);
  const report={result:'PASS',capacityOnly:true,sameHelperPid:child.pid,switchMs,writerCounters:true,cachedPathAndIdentity:true,rapidModes:true,capacityContinues:true,stopMs:performance.now()-at};await fs.writeFile(path.join(output,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(!closed)child.kill();writer.kill();await writerExited;await fs.unlink(file).catch(()=>{});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
