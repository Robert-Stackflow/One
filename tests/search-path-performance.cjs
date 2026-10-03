const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {frozen,run,queries}=require('./index-load-memory.cjs');
async function main(){
 process.env.ONE_INDEX_AFFINITY='1';
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-path-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin')),before=path.join(out,'before.exe'),after=path.resolve('work/rust-search/release/one-index.exe');
 const cases=[...queries.map(query=>({query})),{query:'"D:/Repositories/One" "repositories/one/src"'},{query:'folder: "D:/Repositories/One"'},{query:'ext:json "D:/Repositories/One"'},{query:'"D:/Repositories/One" package'},{query:'re/port'}];
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');const report={date:new Date().toISOString(),note:'Normal mutable engine, full real snapshot plus delta, interleaved fresh processes. Test helpers pinned to the same logical processor; activity app affinity/settings/cache unchanged. No reduction of indexed rows or result limit.',hashes:{before:hash(await fs.readFile(before)),after:hash(await fs.readFile(after)),snapshot:hash(source.bytes),delta:source.delta?hash(source.delta):null},rounds:[]};
 for(let n=0;n<2;n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await run(side==='before'?before:after,path.join(profile,side+'.bin'),source,cases,side==='after');console.log(JSON.stringify({round:n+1,side,count:round[side].count,privateMiB:round[side].loaded.private/1024**2}));}
  assert.equal(round.after.count,round.before.count);for(let i=0;i<cases.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total,cases[i].query);assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,cases[i].query);}assert.deepEqual(round.after.launcherQueries.map(q=>q.items),round.before.launcherQueries.map(q=>q.items));report.rounds.push(round);
 }
 const avg=(side,i,field)=>report.rounds.flatMap(r=>r[side].queries[i].timings).reduce((s,t)=>s+t[field],0)/4;
 report.timings=cases.map((options,i)=>({options,beforeMs:avg('before',i,'wallMs'),afterMs:avg('after',i,'wallMs'),beforeCpuMs:avg('before',i,'cpuMs'),afterCpuMs:avg('after',i,'cpuMs')}));
 report.result='MEASURED';report.resultsIdentical=true;await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 // The optimized trigger is a broad path-only query. Mixed filename terms and
 // type filters are regression cases, not expected sources of the path gain.
 const paths=report.timings.filter(t=>['"D:/Repositories/One"','"d:\\repositories\\one"'].includes(t.options.query)),other=report.timings.filter(t=>!paths.includes(t));
 assert.ok(paths.reduce((s,t)=>s+t.afterCpuMs,0)<paths.reduce((s,t)=>s+t.beforeCpuMs,0)*0.9,'Expected lower path matching CPU cost');
 assert.ok(other.reduce((s,t)=>s+t.afterCpuMs,0)<=other.reduce((s,t)=>s+t.beforeCpuMs,0)*1.12,'Avoid ordinary search CPU regression');
 for(const t of other)assert.ok(t.afterCpuMs<=t.beforeCpuMs*1.2+15,'Individual query CPU regression: '+t.options.query);
 for(const round of report.rounds){assert.ok(round.after.peakPrivate<=round.before.peakPrivate*1.02+2*1024**2);assert.ok(round.after.loaded.private<=round.before.loaded.private*1.02+2*1024**2);}
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',resultsIdentical:true,timings:report.timings}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
