const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto');
const {frozen,queries}=require('./index-load-memory.cjs'),{mapped}=require('./mapped-index-performance.cjs'),execute=promisify(execFile);
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-scan-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin')),config=path.join(profile,'config.json');await fs.writeFile(config,JSON.stringify(source.config));
 const executables={before:path.join(out,'before.exe'),after:path.resolve('work/rust-search/release/one-index.exe')},images={},builds={};
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),hashes={before:hash(await fs.readFile(executables.before)),after:hash(await fs.readFile(executables.after)),snapshot:hash(source.bytes),delta:source.delta?hash(source.delta):null};
 for(const side of ['before','after']){
  const cache=path.join(profile,side+'.bin');await fs.writeFile(cache,source.bytes);if(source.delta)await fs.writeFile(cache+'.delta',source.delta);
  images[side]=path.join(profile,side+'-map.bin');const result=await execute(executables[side],['mapped-build',cache,images[side],config],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});builds[side]=JSON.parse(result.stdout.trim());
 }
 assert.equal(builds.after.count,builds.before.count);assert.equal(builds.after.bytes,builds.before.bytes);
 const rules=[{path:'D:\\Repositories',priority:'uncommon'},{path:'D:\\Repositories\\One',priority:'high'},{path:'C:\\Users',priority:'high'},{path:'D:\\Ruida',priority:'normal'},{path:'C:\\Windows',priority:'uncommon'}];
 const cases=[...queries.map(query=>({query})),{query:'ext:json package',priorities:rules},{query:'folder: downloads',priorities:rules},{query:'ext:json package',fuzzy:false,pinyin:false},{query:'jdbg',fuzzy:false,pinyin:true},{query:'ext:json package',progressive:true}];
 const report={date:new Date().toISOString(),note:'Immutable diagnostic image, not live app integration. Same full snapshot and delta, interleaved fresh processes, OS file cache warm. Cold-storage performance not measured.',hashes,builds,rounds:[]};
 for(let n=0;n<2;n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await mapped(executables[side],images[side],cases,side==='after');console.log(JSON.stringify({round:n+1,side,count:round[side].count,privateMiB:round[side].settled.private/1024**2}));}
  for(let i=0;i<cases.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total);assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,cases[i].query);}
  assert.deepEqual(round.after.queries.at(-1).partial.items,round.before.queries.at(-1).partial.items);assert.equal(round.after.queries.at(-1).partial.total,round.before.queries.at(-1).partial.total);
  assert.ok(round.after.queries.at(-1).timings.every(t=>t.partialMs<30),'Local results must precede full text validation');
  assert.ok(round.after.settled.private<16*1024**2);assert.ok(round.after.settled.resident<16*1024**2);report.rounds.push(round);
 }
 const avg=(side,i,field)=>report.rounds.flatMap(r=>r[side].queries[i].timings).reduce((s,t)=>s+t[field],0)/4;
 report.timings=cases.map((options,i)=>({options,beforeMs:avg('before',i,'wallMs'),afterMs:avg('after',i,'wallMs'),beforeCpuMs:avg('before',i,'cpuMs'),afterCpuMs:avg('after',i,'cpuMs')}));
 report.result='MEASURED';report.resultsIdentical=true;await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 // Broad path matching should materially improve without slowing every other case.
 const pathCases=report.timings.filter(t=>t.options.query.includes('Repositories/One')||t.options.query.includes('d:\\repositories\\one'));
 assert.ok(pathCases.reduce((s,t)=>s+t.afterMs,0)<pathCases.reduce((s,t)=>s+t.beforeMs,0)*0.85,'Expected lower broad path scan cost');
 const small=report.timings.filter(t=>!pathCases.includes(t));assert.ok(small.reduce((s,t)=>s+t.afterMs,0)<small.reduce((s,t)=>s+t.beforeMs,0)*1.15,'Avoid shifting path savings into other searches');
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:builds.after.count,resultsIdentical:true,concurrency:report.rounds[0].after.concurrency,timings:report.timings}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
