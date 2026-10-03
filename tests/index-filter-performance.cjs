// Compare complete file-kind filtering on one frozen real index. CPU time is
// recorded alongside response time so scheduling noise remains visible.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {frozen,run,queries}=require('./index-load-memory.cjs');
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-filter-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin'));
 const before=path.join(out,'before.exe'),after=path.resolve(process.env.ONE_INDEX_AFTER||'work/rust-search/release/one-index.exe');
 const filtered=['doc: report','doc:','pic: qq','pic:','video: 2026','video:','audio: music','audio:'],cases=[...filtered,...queries];
 const report={date:new Date().toISOString(),snapshotCount:source.count,sourceBytes:source.sourceBytes,deltaBytes:source.deltaBytes,rounds:[],note:'Full frozen real cache and delta; only verification copies have empty roots. Exact totals, ranked top 100, metadata, match kinds and launcher results must agree.'};
 for(let n=0;n<Number(process.env.ONE_FILTER_ROUNDS||3);n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await run(side==='before'?before:after,path.join(profile,'file-index.bin'),source,cases,true);console.log(JSON.stringify({round:n+1,side,count:round[side].count}));}
  assert.equal(round.after.count,round.before.count);for(let i=0;i<cases.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total,cases[i]);assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,cases[i]);}assert.deepEqual(round.after.launcherQueries.map(q=>q.items),round.before.launcherQueries.map(q=>q.items));report.rounds.push(round);
 }
 const average=(side,get)=>report.rounds.reduce((sum,r)=>sum+get(r[side]),0)/report.rounds.length;
 report.timings=cases.map((query,i)=>({query,...Object.fromEntries(['before','after'].flatMap(side=>['wallMs','cpuMs'].map(metric=>[side+metric,average(side,r=>r.queries[i].timings.reduce((n,t)=>n+t[metric],0)/r.queries[i].timings.length)])))}));
 report.beforePrivateMiB=average('before',r=>r.loaded.private)/1024**2;report.afterPrivateMiB=average('after',r=>r.loaded.private)/1024**2;
 const total=(side,metric)=>report.timings.slice(0,filtered.length).reduce((sum,q)=>sum+q[side+metric],0);
 report.filterWallReductionPercent=100*(1-total('after','wallMs')/total('before','wallMs'));report.filterCpuReductionPercent=100*(1-total('after','cpuMs')/total('before','cpuMs'));report.resultsIdentical=true;report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 assert.ok(report.afterPrivateMiB<=report.beforePrivateMiB*1.02+5,'Index memory regression');for(const q of report.timings){assert.ok(q.afterwallMs<=q.beforewallMs*1.15+12,'Response regression: '+q.query);assert.ok(q.aftercpuMs<=q.beforecpuMs*1.15+16,'CPU regression: '+q.query);}
 assert.ok(report.filterWallReductionPercent>20,'Expected material file-kind response improvement');assert.ok(report.filterCpuReductionPercent>20,'Expected material file-kind CPU improvement');report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:report.rounds[0].after.count,queries:cases.length,filterWallReductionPercent:report.filterWallReductionPercent,filterCpuReductionPercent:report.filterCpuReductionPercent,resultsIdentical:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
