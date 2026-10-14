const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),run=promisify(require('node:child_process').execFile);
(async()=>{
 const root=path.resolve('work/current/capture-reconstruction');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'ocr-tiles-'));
 try{
  await build({entryPoints:['src/main/recognition/ocr-tile-worker.ts','src/main/recognition/paddle-worker.ts','src/main/recognition/ocr-worker.ts','src/main/recognition/ocr-engine.ts'],outdir:directory,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',packages:'external',logLevel:'warning'});
  const entry=path.join(directory,'runtime.mjs');await build({entryPoints:['tests/recognition/ocr-tiles-runtime.ts'],outfile:entry,bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning',banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"}});
  const env={...process.env,ONE_OCR_TILES_ROOT:directory};delete env.ELECTRON_RUN_AS_NODE;
  const flags=process.argv.slice(2);assert.ok(flags.every(value=>['--dml','--device1'].includes(value)));
  const result=await run(process.execPath,[entry,...flags],{env,windowsHide:true,maxBuffer:131072,timeout:300000});
  const tag=flags.includes('--dml')?'dml-'+(flags.includes('--device1')?'1':'0'):'cpu';
  const evidence=path.join(root,'ocr-tiles',tag);await fs.mkdir(evidence,{recursive:true});
  for(const name of ['results.json','input.png'])await fs.copyFile(path.join(directory,name),path.join(evidence,name));
  await fs.writeFile(path.join(evidence,'runtime.log'),result.stdout+result.stderr);console.log(result.stdout.trim());
 }catch(error){await fs.writeFile(path.join(root,'ocr-tiles-failure.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('Long-image runtime failed; see work/current/capture-reconstruction/ocr-tiles-failure.log');process.exitCode=1;}
 finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('ocr-tiles-'));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
