const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const observed=`const native=require(['node','child_process'].join(':')),custom=Symbol.for('nodejs.util.promisify.custom');
function record(child,args){const item={child,args,closed:false};child.on('close',()=>{item.closed=true;item.closedAt=performance.now();});globalThis.maintenanceChildren.push(item);return child;}
export function spawn(...args){return record(native.spawn(...args),args[1]);}
export function execFile(...args){return record(native.execFile(...args),args[1]);}
execFile[custom]=(...args)=>{const pending=native.execFile[custom](...args);record(pending.child,args[1]);return pending;};`;
async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/maintenance-cancel-native'),root=path.resolve(process.env.ONE_DIRECTORY_FIXTURE_DIR||'work/current/fixtures/directory');await fs.mkdir(output,{recursive:true});await require('./directory-fixtures.cjs').largeDirectory(root);await require('esbuild').build({entryPoints:['src/main/maintenance-service.ts'],outfile:'dist/main/maintenance-cancel-test.cjs',bundle:true,platform:'node',plugins:[{name:'observed-processes',setup(b){b.onResolve({filter:/^node:child_process$/},()=>({path:'process',namespace:'observed'}));b.onLoad({filter:/.*/,namespace:'observed'},()=>({contents:observed,loader:'js'}));}}]});
 global.maintenanceChildren=[];const {MaintenanceService}=require('../dist/main/maintenance-cancel-test.cjs'),service=new MaintenanceService(path.join(output,'receipts'),[root]);
 try{
  const before=await service.scan('disk');assert.equal(before.entries[0].count,30003);const prior=global.maintenanceChildren.length,pending=service.scan('disk'),failure=assert.rejects(pending,/扫描已停止/),registry=service.scan('registry');let cleanup;
  for(let i=0;i<200;i++){cleanup=global.maintenanceChildren.slice(prior).find(item=>item.args[0]==='cleanup');if(cleanup)break;await new Promise(r=>setTimeout(r,2));}assert.ok(cleanup?.child.pid&&!cleanup.closed,'Own native cleanup scanner must be live before cancellation');const at=performance.now();await service.cancel('disk');await failure;const cancelMs=performance.now()-at;assert.ok(service.reports.has(before.id),'Previous complete report remains actionable');const unaffected=await registry;assert.equal(unaffected.kind,'registry');
  for(let i=0;i<100&&!cleanup.closed;i++)await new Promise(r=>setTimeout(r,10));assert.equal(cleanup.closed,true);assert.ok(cleanup.child.killed);assert.equal(global.maintenanceChildren.slice(prior).filter(item=>!item.closed).length,0);
  const recovery=await service.scan('disk');assert.equal(recovery.entries[0].count,30003);assert.equal(service.reports.has(before.id),false);assert.equal(service.reports.size,2);const result={result:'PASS',files:30003,cancelMs,nativeScannerExitMs:cleanup.closedAt-at,liveOwnedProcessConfirmed:true,nativeScannerClosed:true,otherTabCompleted:true,previousReportPreserved:true,restartCompleted:true,processes:global.maintenanceChildren.length};await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{service.stop();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
