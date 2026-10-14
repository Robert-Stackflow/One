const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),run=promisify(require('node:child_process').execFile);
(async()=>{
 const root=path.resolve('work/current/capture-reconstruction');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'ocr-region-'));
 try{
  await build({entryPoints:['src/main/recognition/ocr-tile-worker.ts'],outfile:path.join(directory,'ocr-tile-worker.cjs'),bundle:true,platform:'node',target:'node22',packages:'external',logLevel:'warning'});
  const entry=path.join(directory,'test.mjs');await build({entryPoints:['tests/recognition/ocr-region-runtime.ts'],outfile:entry,bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
  const env={...process.env,ONE_OCR_REGION_ROOT:directory};delete env.ELECTRON_RUN_AS_NODE;
  const result=await run(process.execPath,[entry],{env,windowsHide:true,maxBuffer:65536,timeout:60000});
  await fs.writeFile(path.join(root,'ocr-region-runtime.log'),result.stdout+result.stderr);console.log(result.stdout.trim());
 }catch(error){await fs.writeFile(path.join(root,'ocr-region-runtime.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('OCR-region runtime failed; see work/current/capture-reconstruction/ocr-region-runtime.log');process.exitCode=1;}
 finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('ocr-region-'));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
