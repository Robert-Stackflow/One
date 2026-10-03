// Full real-cache comparison for literal names and common parent terms.
// No live cache is opened by either helper; names/ranking must remain exact.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {frozen,run}=require('./index-load-memory.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 process.env.ONE_INDEX_AFFINITY='1';
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-literal-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const before=path.resolve(process.env.ONE_INDEX_BEFORE||'work/current/index-before-literal-parent.exe'),after=path.resolve('work/rust-search/release/one-index.exe'),source=await frozen(path.resolve('work/dev-profile/file-index.bin'));
 const cases=['"QQ"','"windows"','"node_modules"','"package"','"node_modules" "package"','"季度报告"'],report={date:new Date().toISOString(),hashes:{before:hash(await fs.readFile(before)),after:hash(await fs.readFile(after)),snapshot:hash(source.bytes),delta:source.delta?hash(source.delta):null},rounds:[],note:'Same frozen real snapshot and delta. Two interleaved fresh helpers, each case twice, pinned to the same processor. Warm filesystem; not a whole-query or cold-storage benchmark.'};
 assert.notEqual(report.hashes.before,report.hashes.after);
 for(let n=0;n<2;n++){
  const round={};for(const side of n%2?['after','before']:['before','after'])round[side]=await run(side==='before'?before:after,path.join(profile,'query.bin'),source,cases);
  assert.equal(round.before.count,round.after.count);
  for(let i=0;i<cases.length;i++){assert.equal(round.before.queries[i].total,round.after.queries[i].total,cases[i]);assert.deepEqual(round.before.queries[i].items,round.after.queries[i].items,cases[i]);}
  report.rounds.push(round);console.log(JSON.stringify({round:n+1,resultsIdentical:true}));
 }
 const mean=(side,i,key)=>report.rounds.flatMap(r=>r[side].queries[i].timings).reduce((sum,t)=>sum+t[key],0)/4;
 report.timings=cases.map((query,i)=>({query,total:report.rounds[0].after.queries[i].total,beforeMs:mean('before',i,'wallMs'),afterMs:mean('after',i,'wallMs'),beforeCpuMs:mean('before',i,'cpuMs'),afterCpuMs:mean('after',i,'cpuMs')}));
 const sum=side=>report.timings.reduce((total,t)=>total+t[side+'CpuMs'],0);report.cpuRatio=sum('after')/sum('before');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 assert.ok(report.cpuRatio<=1.12,'Literal aggregate CPU regression');
 for(const t of report.timings)assert.ok(t.afterCpuMs<=t.beforeCpuMs*1.2+15,'Literal individual CPU regression '+t.query);
 for(const r of report.rounds)assert.ok(r.after.loaded.private<=r.before.loaded.private*1.02+5*1024**2,'Index memory regression');
 report.result='PASS';report.resultsIdentical=true;await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,count:report.rounds[0].after.count,cpuRatio:report.cpuRatio,timings:report.timings}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
