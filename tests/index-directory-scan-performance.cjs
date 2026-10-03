// Same owned wide tree, interleaved fresh scans. Measures native helper memory
// and scan progress; does not rebuild the live app's filesystem index.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {client}=require('./helpers/index-client.cjs'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-directory-scan-performance'),profile=path.join(out,'profile'),root=path.join(profile,'wide-'+('r'.repeat(100)));await fs.mkdir(root,{recursive:true});
 const before=path.resolve(process.env.ONE_INDEX_BEFORE||'work/current/index-before-bounded-walker.exe'),after=path.resolve('work/rust-search/release/one-index.exe');const hashes={before:hash(await fs.readFile(before)),after:hash(await fs.readFile(after))};assert.notEqual(hashes.before,hashes.after);
 const count=50000,names=Array.from({length:count},(_,n)=>'scan-needle-'+String(n).padStart(5,'0')+'-'+('x'.repeat(100)));let at=0;
 await Promise.all(Array.from({length:24},async()=>{for(;;){const n=at++;if(n>=count)return;await fs.mkdir(path.join(root,names[n]));}}));
 const settings={roots:[root],excluded:[],maxEntries:100000},report={date:new Date().toISOString(),directories:count,hashes,rounds:[],note:'Two interleaved fresh native scans over the same 50k empty directories with a shared long parent. Hot filesystem cache; excludes fixture creator and live app.'};
 async function scan(exe,cache,config=settings){
  const started=performance.now(),probe=await client(exe,[cache],config);
  try{
   if(config.maxEntries>count)assert.equal(probe.state().error,'');else assert.equal(probe.state().error,'索引已达到 '+config.maxEntries+' 项上限');assert.equal(probe.state().issues,0);const first=probe.states.find(state=>state.running&&state.count>0);assert.ok(first);
   const memory=probe.memory();const result=await probe.request({type:'query',scope:894,query:'folder: scan-needle',currentFolder:root,fuzzy:false,pinyin:false});
   assert.equal(probe.count,Math.min(config.maxEntries,count+1));assert.equal(result.result.total,probe.count-1);
   if(config.maxEntries>count)assert.deepEqual(result.result.items.map(row=>row.path),names.slice(0,100).map(name=>path.join(root,name)));
   for(const n of config.maxEntries>count?[0,127,49151,count-1]:[]){const value=await probe.request({type:'metadata',path:path.join(root,names[n])});assert.equal(value.result.directory,true);}
   return{count:probe.count,readyMs:probe.readyMs,firstProgressMs:first.at-started,progressReports:probe.states.filter(state=>state.running&&state.count>0).length,memory,total:result.result.total,items:result.result.items};
  }finally{await probe.stop();}
 }
 for(let n=0;n<2;n++){
  const round={};for(const side of n%2?['after','before']:['before','after'])round[side]=await scan(side==='before'?before:after,path.join(profile,side+'-'+n+'.bin'));
  assert.deepEqual(round.after.items,round.before.items);assert.equal(round.after.total,round.before.total);report.rounds.push(round);await fs.writeFile(path.join(out,'measurement.json'),JSON.stringify(report,null,2));
 }
 report.capped=await scan(after,path.join(profile,'capped.bin'),{...settings,maxEntries:1000});assert.equal(report.capped.count,1000);
 const mean=(side,get)=>report.rounds.reduce((sum,round)=>sum+get(round[side]),0)/report.rounds.length;
 report.peakPrivate={before:mean('before',r=>r.memory.peakPrivate),after:mean('after',r=>r.memory.peakPrivate)};report.scan={beforeMs:mean('before',r=>r.readyMs),afterMs:mean('after',r=>r.readyMs)};report.firstProgress={beforeMs:mean('before',r=>r.firstProgressMs),afterMs:mean('after',r=>r.firstProgressMs)};
 await fs.writeFile(path.join(out,'measurement.json'),JSON.stringify(report,null,2));
 assert.ok(report.peakPrivate.after<=report.peakPrivate.before*1.1+2*1024**2,'Fresh scan private memory regression');assert.ok(report.scan.afterMs<=report.scan.beforeMs*1.3+250,'Fresh scan latency regression');assert.ok(report.firstProgress.afterMs<=report.firstProgress.beforeMs*1.3+60,'First scan progress regression');
 report.result='PASS';report.completeResults=true;report.cappedScanStops=true;await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,count,scan:report.scan,firstProgress:report.firstProgress,peakPrivate:report.peakPrivate}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
