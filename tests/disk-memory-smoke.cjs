const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
async function model(bundle,folder){
 const {DiskService,ScanTree}=require(bundle),{readProcessCounters}=require('./app-memory-benchmark.cjs'),tree=new ScanTree();let latest;
 const service=new DiskService(p=>{latest=p;tree.apply(JSON.parse(JSON.stringify(p)));});service.start(folder,()=>{});
 const root={path:folder,name:path.basename(folder),parent:null,directory:true,size:0,modified:0},groups=300,perGroup=1000;let bytes=0,files=0;
 for(let group=0;group<groups;group++){
  const dir=path.join(folder,'long-directory-name-'+String(group).padStart(4,'0')),directory={path:dir,parent:folder,name:path.basename(dir),directory:true,size:0,modified:0};let nodes=[root,directory];
  for(let i=0;i<perGroup;i++){const size=1000+i;files++;bytes+=size;directory.size+=size;nodes.push({path:path.join(dir,'File-'+String(i).padStart(5,'0')+'.txt'),parent:dir,name:'File-'+String(i).padStart(5,'0')+'.txt',directory:false,size,modified:0});}
  root.size=bytes;globalThis.diskModelProgress(JSON.parse(JSON.stringify({rootPath:folder,path:dir,nodes,files,directories:group+2,bytes,issues:0})));
 }
 service.stop();global.gc();global.gc();await new Promise(r=>setTimeout(r,20));global.gc();
 const leaf=tree.nodes.get(path.join(folder,'long-directory-name-0299','File-00999.txt'));assert.ok(leaf);assert.equal(tree.nodes.size,300301);assert.equal(tree.root.size,bytes);assert.equal(tree.root.children.length,300);assert.deepEqual(tree.ancestors(leaf).map(n=>n.path),[folder,path.dirname(leaf.path)]);
 const counters=readProcessCounters([{pid:process.pid,name:'model'}]),memory=process.memoryUsage();
 const result={heapUsed:memory.heapUsed,private:counters.private,resident:counters.resident,privateResident:counters.privateResident,rows:tree.nodes.size,files:latest.files,bytes};console.log(JSON.stringify(result));
}
async function main(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/disk-memory-smoke'),folder=path.join(output,'files','shared-root');await fs.mkdir(folder,{recursive:true});
 const sourceNames=['src/main/disk-service.ts','src/shared/scan-tree.ts'],ref=process.env.ONE_DISK_BASELINE_REF||'ff86fe1',before={};
 for(const file of sourceNames)before[path.resolve(file)]=(await run('git',['show',ref+':'+file],{maxBuffer:2*1024*1024})).stdout;
 for(const mode of ['before','after'])await require('esbuild').build({stdin:{contents:"export {DiskService} from './src/main/disk-service'; export {ScanTree} from './src/shared/scan-tree';",resolveDir:path.resolve('.'),loader:'ts'},bundle:true,platform:'node',outfile:path.join(output,mode+'.cjs'),plugins:[{name:'model-native',setup(b){b.onResolve({filter:/^\.\/native-scan$/},()=>({path:'stub',namespace:'model'}));b.onLoad({filter:/.*/,namespace:'model'},()=>({contents:'export function nativeScan(path,progress,complete){globalThis.diskModelProgress=progress;return {kill(){},stop(){}}}',loader:'js'}));if(mode==='before')b.onLoad({filter:/\.ts$/},args=>before[args.path]?{contents:before[args.path],loader:'ts'}:null);}}]});
 const result={baseline:ref,rounds:[]};
 for(let round=0;round<2;round++){const report={};for(const mode of round?['after','before']:['before','after']){const {stdout}=await run(process.execPath,['--expose-gc',__filename,'--model',path.join(output,mode+'.cjs'),folder],{windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});report[mode]=JSON.parse(stdout.trim());}assert.equal(report.before.rows,report.after.rows);assert.equal(report.before.bytes,report.after.bytes);result.rounds.push(report);}
 const average=(mode,key)=>result.rounds.reduce((n,r)=>n+r[mode][key],0)/result.rounds.length;
 result.heapReductionPercent=100*(1-average('after','heapUsed')/average('before','heapUsed'));result.privateReductionPercent=100*(1-average('after','private')/average('before','private'));
 assert.ok(result.heapReductionPercent>20,'full scan models should retain materially less memory');
 result.result='PASS';await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(process.argv[2]==='--model')model(process.argv[3],process.argv[4]).catch(e=>{console.error(e);process.exitCode=1});else main().catch(e=>{console.error(e);process.exitCode=1});
