// Compare exact results and response time while retaining every real cached row.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {frozen,run,queries}=require('./index-load-memory.cjs');
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-component-memory'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin'));
 const before=path.resolve(process.env.ONE_INDEX_BEFORE||path.join(out,'before.exe')),after=path.resolve(process.env.ONE_INDEX_AFTER||'work/rust-search/release/one-index.exe');
 const fingerprint=async file=>({path:file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
 const binaries={before:await fingerprint(before),after:await fingerprint(after)};
 const cases=[...queries,'"季度"','"report" package','ext:txt;md readme','pic: qq','folder:','D:/Ruida/Downloads',{query:'reprot',fuzzy:false},{query:'jdbg',pinyin:false},{query:'季度',fuzzy:false,pinyin:false},{query:'QQ',foldersOnly:true},'🙂','İstanbul','ß','Résumé','"D:\\"',''];
 const report={date:new Date().toISOString(),binaries,sourceBytes:source.sourceBytes,deltaBytes:source.deltaBytes,snapshotCount:source.count,rounds:[],note:'Same frozen full snapshot plus journal; only copied caches use empty roots. Compare counts, complete ranked top 100, case, metadata, pinyin, launchers, and independent/superseded requests.'};
 for(let n=0;n<2;n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await run(side==='before'?before:after,path.join(profile,'file-index.bin'),source,cases,true);console.log(JSON.stringify({round:n+1,side,count:round[side].count,readyMs:round[side].readyMs,privateMiB:round[side].loaded.private/1024**2}));}
  assert.equal(round.after.count,round.before.count);
  for(let i=0;i<cases.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total,JSON.stringify(cases[i]));assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,JSON.stringify(cases[i]));}
  for(let i=0;i<round.before.launcherQueries.length;i++)assert.deepEqual(round.after.launcherQueries[i].items,round.before.launcherQueries[i].items);
  report.rounds.push(round);
 }
 const avg=(side,get)=>report.rounds.reduce((sum,r)=>sum+get(r[side]),0)/report.rounds.length;
 report.beforePrivateMiB=avg('before',r=>r.loaded.private)/1024**2;report.afterPrivateMiB=avg('after',r=>r.loaded.private)/1024**2;report.privateReductionPercent=100*(1-report.afterPrivateMiB/report.beforePrivateMiB);
 report.peakPrivate={before:avg('before',r=>r.peakPrivate),after:avg('after',r=>r.peakPrivate)};report.load={beforeMs:avg('before',r=>r.readyMs),afterMs:avg('after',r=>r.readyMs)};
 report.timings=cases.map((query,i)=>({query,beforeMs:avg('before',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2),afterMs:avg('after',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2)}));
 report.resultsIdentical=true;report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 assert.ok(report.privateReductionPercent>10,'Expected material memory reduction from compact records and shared directory spelling');assert.ok(report.peakPrivate.after<=report.peakPrivate.before*1.02,'Peak memory regression');assert.ok(report.load.afterMs<=report.load.beforeMs*1.3+1000,'Restore response regression');
 for(const q of report.timings)assert.ok(q.afterMs<=q.beforeMs*1.15+12,'Query regression: '+JSON.stringify(q.query));
 assert.ok(report.timings.reduce((n,q)=>n+q.afterMs,0)<=report.timings.reduce((n,q)=>n+q.beforeMs,0)*1.1,'Aggregate query latency regression');
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:report.rounds[0].after.count,privateReductionPercent:report.privateReductionPercent,beforePrivateMiB:report.beforePrivateMiB,afterPrivateMiB:report.afterPrivateMiB,load:report.load,queries:cases.length,resultsIdentical:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
