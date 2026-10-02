const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{readProcessCounters}=require('./app-memory-benchmark.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(exe,cache,root){
 const child=spawn(exe,[cache],{windowsHide:true}),exited=new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(Error('Index exit '+code)));child.once('error',reject);});child.stderr.resume();let buffer='',state,serial=0;const pending=new Map(),snapshots=[];
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(value.state)state=value.state;else if(pending.has(value.id)){const request=pending.get(value.id);pending.delete(value.id);value.error?request.reject(Error(value.error)):request.resolve(value.result);}}});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n'),query=text=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});send({type:'query',id,query:text,fuzzy:true,pinyin:true});});
 const settings={roots:[root],excluded:[],maxEntries:150000},sample=()=>readProcessCounters([{pid:child.pid,name:path.basename(exe)}]);
 try{
  for(let round=0;round<4;round++){
   state=undefined;const at=performance.now();send({type:round?'rebuild':'init',settings});const until=at+120000;
   while(!state||state.running||state.count!==100001){if(child.exitCode!==null)throw Error('Index exited during rescan');if(performance.now()>until)throw Error('Rescan timeout '+JSON.stringify(state));await delay(30);}
   const result=await query('"record-000123"');assert.equal(result.total,1);assert.match(result.items[0].name,/End\.TXT$/);assert.ok(result.items[0].path.startsWith(root));await delay(300);const memory=sample();snapshots.push({round,elapsedMs:performance.now()-at,...memory});console.log(JSON.stringify({round,privateMB:memory.private/1024**2,count:state.count}));
  }
  send({type:'stop'});child.stdin.end();await exited;
  return{exe,snapshots,growthMB:(Math.max(...snapshots.slice(1).map(s=>s.private))-snapshots[0].private)/1024**2};
 }finally{if(child.exitCode===null)child.kill();}
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-rescan-memory');await fs.mkdir(out,{recursive:true});const owned=await fs.mkdtemp(path.join(out,'fixture-')),root=path.join(owned,'files');await fs.mkdir(root);
 try{
  const filler='lowercase-'.repeat(11);for(let first=0;first<100000;first+=100){await Promise.all(Array.from({length:Math.min(100,100000-first)},(_,i)=>fs.writeFile(path.join(root,`record-${String(first+i).padStart(6,'0')}-${filler}End.TXT`),'')));if(first%20000===0)console.log('Created files: '+(first+100));}
  const before=await run(process.env.ONE_RESCAN_BEFORE,path.join(owned,'before.bin'),root),after=await run(path.resolve(process.env.ONE_RESCAN_AFTER||'dist/native/One.Index.exe'),path.join(owned,'after.bin'),root);
  const beforeMiB=before.snapshots[0].private/1024**2,afterMiB=after.snapshots[0].private/1024**2;
  const report={files:100000,before,after,beforeMiB,afterMiB,result:'MEASURED'};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));assert.ok(after.growthMB<12,JSON.stringify({before:before.growthMB,after:after.growthMB}));assert.ok(afterMiB<=beforeMiB*1.05+2,'Unique filename memory regression');report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,beforeMiB,afterMiB,beforeGrowthMB:before.growthMB,afterGrowthMB:after.growthMB}));
 }finally{const resolved=await fs.realpath(owned),parent=await fs.realpath(out);assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(resolved).startsWith('fixture-'));await fs.rm(resolved,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
