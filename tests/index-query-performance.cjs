const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {frozen,run,queries}=require('./index-load-memory.cjs');
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-query-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin'));
 const before=path.join(out,'before.exe'),after=path.resolve(process.env.ONE_INDEX_AFTER||'work/rust-search/release/one-index.exe');
 const cases=[...queries,...(process.env.ONE_QUERY_EXTENDED==='1'?['"季度"','"report" package','ext:txt;md readme','pic: qq','folder:','D:/Ruida/Downloads',{query:'reprot',fuzzy:false},{query:'jdbg',pinyin:false},{query:'季度',fuzzy:false,pinyin:false},{query:'QQ',foldersOnly:true},'🙂','İstanbul','ß','Résumé','"D:\\"','']:[])];
 const report={date:new Date().toISOString(),sourceBytes:source.sourceBytes,deltaBytes:source.deltaBytes,snapshotCount:source.count,rounds:[],note:'Same frozen real index plus delta. Query totals, ranked top 100, metadata and match kinds must be identical; both helpers keep full cache contents. Only copied caches use empty roots.'};
 for(let n=0;n<Number(process.env.ONE_QUERY_ROUNDS||2);n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await run(side==='before'?before:after,path.join(profile,'file-index.bin'),source,cases,true);console.log(JSON.stringify({round:n+1,side,count:round[side].count,privateMiB:round[side].loaded.private/1024**2}));}
  assert.equal(round.after.count,round.before.count);for(let i=0;i<cases.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total,JSON.stringify(cases[i]));assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,JSON.stringify(cases[i]));}for(let i=0;i<round.before.launcherQueries.length;i++)assert.deepEqual(round.after.launcherQueries[i].items,round.before.launcherQueries[i].items);report.rounds.push(round);
 }
 const avg=(side,get)=>report.rounds.reduce((sum,r)=>sum+get(r[side]),0)/report.rounds.length;
 report.timings=cases.map((query,i)=>({query,beforeMs:avg('before',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2),afterMs:avg('after',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2)}));
 report.beforePrivateMiB=avg('before',r=>r.loaded.private)/1024**2;report.afterPrivateMiB=avg('after',r=>r.loaded.private)/1024**2;
 const total=side=>report.timings.reduce((n,q)=>n+q[side+'Ms'],0);report.queryReductionPercent=100*(1-total('after')/total('before'));report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 assert.ok(report.afterPrivateMiB<=report.beforePrivateMiB*1.02+5,'Index memory regression');for(const q of report.timings)assert.ok(q.afterMs<=q.beforeMs*1.15+12,'Query regression: '+JSON.stringify(q.query));assert.ok(report.queryReductionPercent>20,'Expected material query improvement across the same cases');
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:report.rounds[0].after.count,queries:cases.length,queryReductionPercent:report.queryReductionPercent,beforePrivateMiB:report.beforePrivateMiB,afterPrivateMiB:report.afterPrivateMiB,resultsIdentical:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
