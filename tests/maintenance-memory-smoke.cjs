const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),run=require('node:util').promisify(require('node:child_process').execFile);
async function model(bundle,root,mode){
 const {MaintenanceService}=require(bundle),service=new MaintenanceService(path.join(path.dirname(root),'receipts'),[root]),started=performance.now();let report;
 global.gc();const initial=process.memoryUsage().heapUsed;
 for(let i=0;i<8;i++){report=await service.scan('disk');assert.equal(report.entries[0].count,30003);}
 global.gc();global.gc();const heap=process.memoryUsage().heapUsed;let retainedFiles=0;for(const report of service.reports.values()){const entries=report instanceof Map?report:report.entries;for(const candidate of entries.values())retainedFiles+=candidate.files?.length||0;}
 const result={mode,reportCount:service.reports.size,retainedFiles,retainedBytes:heap-initial,heapUsed:heap,elapsedMs:performance.now()-started};console.log(JSON.stringify(result));service.stop();
}
async function main(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/maintenance-memory-smoke'),root=path.resolve(process.env.ONE_DIRECTORY_FIXTURE_DIR||'work/current/fixtures/directory'),ref='5964815';await fs.mkdir(output,{recursive:true});await require('./directory-fixtures.cjs').largeDirectory(root);const old=(await run('git',['show',ref+':src/main/maintenance-service.ts'],{windowsHide:true,maxBuffer:1024*1024})).stdout;
 const bundles={before:path.resolve('dist/main/maintenance-baseline-test.cjs'),after:path.resolve('dist/main/maintenance-memory-test.cjs')};await require('esbuild').build({stdin:{contents:old,resolveDir:path.resolve('src/main'),loader:'ts'},bundle:true,platform:'node',outfile:bundles.before});await require('esbuild').build({entryPoints:['src/main/maintenance-service.ts'],bundle:true,platform:'node',outfile:bundles.after});const rounds=[];
 for(let i=0;i<(process.env.ONE_MAINT_BASELINE_ONLY?1:2);i++){const round={};for(const mode of process.env.ONE_MAINT_BASELINE_ONLY?['before']:i?['after','before']:['before','after'])round[mode]=JSON.parse((await run(process.execPath,['--expose-gc',__filename,'--model',bundles[mode],root,mode],{windowsHide:true,timeout:60000,maxBuffer:1024*1024})).stdout);rounds.push(round);}
 const baseline=!!process.env.ONE_MAINT_BASELINE_ONLY,result={result:'PASS',baseline,reference:ref,rounds};if(!baseline){assert.ok(rounds.every(r=>r.before.reportCount===6&&r.after.reportCount===1&&r.after.retainedFiles===30003));const average=mode=>rounds.reduce((s,r)=>s+r[mode].retainedBytes,0)/rounds.length;result.reductionPercent=100*(1-average('after')/average('before'));assert.ok(result.reductionPercent>50);}
 await fs.writeFile(path.join(output,baseline?'before.json':'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(process.argv[2]==='--model')model(process.argv[3],process.argv[4],process.argv[5]).catch(e=>{console.error(e);process.exitCode=1;});else main().catch(e=>{console.error(e);process.exitCode=1;});
