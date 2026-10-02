const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
let MaintenanceService,output;
const nativeStub=`
function task(kind,signal){return new Promise((resolve,reject)=>{const job={kind,signal,resolve:value=>{signal?.removeEventListener('abort',abort);resolve(value);},reject};const abort=()=>reject(new Error('aborted'));if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});globalThis.maintenanceJobs.push(job);});}
export function nativeMaintenance(kind,signal){return task(kind,signal);}
export function nativeCacheFiles(root,age,signal){return task('disk',signal);}
export function nativeCacheRemove(root,files,progress,signal){return task('apply',signal);}
`;
before(async()=>{output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','maintenance');await fs.mkdir(output,{recursive:true});await require('esbuild').build({entryPoints:['src/main/maintenance-service.ts'],outfile:path.join(output,'service.cjs'),bundle:true,platform:'node',plugins:[{name:'controlled-native',setup(b){b.onResolve({filter:/^\.\/native-scan$/},()=>({path:'native',namespace:'controlled'}));b.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:nativeStub,loader:'js'}));}}]});({MaintenanceService}=require(path.join(output,'service.cjs')));});
async function waitFor(kind){for(let i=0;i<100;i++){const job=global.maintenanceJobs.find(j=>j.kind===kind);if(job)return job;await new Promise(r=>setTimeout(r,2));}throw Error('No pending '+kind);}
function service(name){global.maintenanceJobs=[];const service=new MaintenanceService(path.join(output,name),[path.join(output,'files')]);service.ps=async()=>({tasks:[],shortcuts:[]});return service;}
const result=(count=0)=>({files:Array.from({length:count},(_,i)=>({path:'file-'+i,size:10,mtime:1,root:'root'})),skipped:0,truncated:false});
test('cancel only the requested scan; other tabs finish, partial reports never commit and restart works',async()=>{
 const s=service('isolated'),disk=s.scan('disk'),failure=assert.rejects(disk,/扫描已停止/),registry=s.scan('registry'),startup=s.scan('startup');const cancelled=await waitFor('disk');await s.cancel('disk');await failure;assert.equal(cancelled.signal.aborted,true);assert.equal(s.reports.size,0);assert.equal((await waitFor('registry')).signal.aborted,false);assert.equal((await waitFor('startup')).signal.aborted,false);
 (await waitFor('registry')).resolve([]);(await waitFor('startup')).resolve([]);const reports=await Promise.all([registry,startup]);assert.deepEqual(reports.map(r=>r.kind),['registry','startup']);global.maintenanceJobs=[];const next=s.scan('disk');(await waitFor('disk')).resolve(result());await next;assert.equal(s.reports.size,3);await assert.rejects(s.cancel('invalid'),/类型/);await s.cancel('disk');s.stop();
});
test('duplicate scans share work, cancellation preserves last complete report, and replacement retains one report per tab',async()=>{
 const s=service('replacement');const first=s.scan('disk'),duplicate=s.scan('disk');(await waitFor('disk')).resolve(result(1));const [a,b]=await Promise.all([first,duplicate]);assert.equal(a.id,b.id);assert.equal(global.maintenanceJobs.length,1);
 global.maintenanceJobs=[];const pending=s.scan('disk'),failure=assert.rejects(pending,/扫描已停止/),duplicateFailure=assert.rejects(s.scan('disk'),/扫描已停止/);await waitFor('disk');await s.cancel('disk');await Promise.all([failure,duplicateFailure]);assert.equal(s.reports.has(a.id),true);
 for(let i=0;i<10;i++){global.maintenanceJobs=[];const next=s.scan('disk');(await waitFor('disk')).resolve(result(1));await next;assert.equal(s.reports.size,1);}assert.equal(s.reports.has(a.id),false);await assert.rejects(s.apply(a.id,[a.entries[0].id]),/结果已过期/);s.stop();
});
test('scan cancellation and report replacement never abort an already accepted action',async()=>{
 const s=service('action');const pending=s.scan('disk');(await waitFor('disk')).resolve(result(1));const report=await pending;global.maintenanceJobs=[];const action=s.apply(report.id,[report.entries[0].id]),job=await waitFor('apply');const scan=s.scan('disk'),failure=assert.rejects(scan,/扫描已停止/);await waitFor('disk');await s.cancel('disk');await failure;assert.equal(job.signal.aborted,false);
 global.maintenanceJobs=[job];const next=s.scan('disk');(await waitFor('disk')).resolve(result());await next;assert.equal(s.reports.has(report.id),false);assert.equal(job.signal.aborted,false);job.resolve({items:1,bytes:10,failedCount:0,failed:[]});assert.equal((await action).succeeded,1);assert.equal((await s.receipts()).length,1);s.stop();
});
