const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('work/current/capture-reconstruction');
 const backend=process.argv.includes('--dml')?'dml':'cpu',at=process.argv.indexOf('--device'),device=at<0?'0':process.argv[at+1];
 assert.match(device,/^(?:[0-9]|[12][0-9]|3[01])$/);
 const tag=backend==='cpu'?'cpu':'dml-'+device;
 await fs.mkdir(path.join(root,'ctc-alignment'),{recursive:true});const directory=await fs.mkdtemp(path.join(root,'ctc-runtime-'));
 try{
  const env={...process.env,ONE_CTC_TEST_ROOT:directory};delete env.ELECTRON_RUN_AS_NODE;
  await run(process.execPath,['tests/recognition/paddle-alignment-prepare.cjs'],{env,windowsHide:true,maxBuffer:65536,timeout:60000});
  const entry=path.join(directory,'runtime.cjs');await build({entryPoints:['tests/recognition/paddle-alignment-runtime.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',packages:'external',logLevel:'warning'});
  const result=await run(process.execPath,[entry,...(backend==='dml'?['--dml','--device',device]:[])],{env,windowsHide:true,maxBuffer:128*1024,timeout:240000});
  const report='results-'+tag+'.json',rows=JSON.parse(await fs.readFile(path.join(directory,report),'utf8')),qualified=rows.filter(row=>row.supported);
  const evidence=path.join(root,'ctc-alignment','verified-'+tag);await fs.mkdir(evidence,{recursive:true});
  for(const name of ['cases.json',report,'variable.png','mixed.png','dark.png','perspective.png','rotate-90.png','rotate-180.png'])await fs.copyFile(path.join(directory,name),path.join(evidence,name));
  await fs.writeFile(path.join(evidence,'runtime.log'),result.stdout+result.stderr);
  console.log(JSON.stringify({backend,device,passed:qualified.length,total:rows.length,minMatchedCoverage:Math.min(...qualified.map(row=>row.matchedCoverage)),minMatchedCenterHit:Math.min(...qualified.map(row=>row.centerHit)),defaultEngineChanged:false}));
 }catch(error){await fs.writeFile(path.join(root,'ctc-alignment','failure-'+tag+'.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('CTC alignment runtime failed; see work/current/capture-reconstruction/ctc-alignment/failure-'+tag+'.log');process.exitCode=1;}
 finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('ctc-runtime-'));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
