const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
 const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
 const directory=await fs.mkdtemp(path.join(root,'recording-page-'));
 try{
  await build({entryPoints:['tests/recording/page-controller.ts'],outfile:path.join(directory,'renderer.js'),bundle:true,platform:'browser',format:'iife',loader:{'.svg':'file','.png':'file','.woff2':'file'},plugins:[{name:'raw-html',setup(builder){builder.onResolve({filter:/\.html\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));builder.onLoad({filter:/.*/,namespace:'raw'},async args=>({contents:await fs.readFile(args.path,'utf8'),loader:'text'}));}}]});
  await fs.copyFile('tests/recording/page-main.cjs',path.join(directory,'main.cjs'));
  await fs.writeFile(path.join(directory,'preload.cjs'),"require('electron').contextBridge.exposeInMainWorld('one',{});");
  await fs.writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="app"><button id="start">Outside</button><div id="heading"></div><main id="page" style="height:760px"></main></div><script src="renderer.js"></script></body></html>');
  const env={...process.env,ONE_RECORDING_PAGE_TEST_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
  let result;try{result=await promisify(execFile)(require('electron'),[path.join(directory,'main.cjs')],{env,windowsHide:true,timeout:45000,maxBuffer:64*1024});}
  catch(error){await fs.writeFile(path.join(root,'recording-page-detail.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Recording page test failed; see work/current/capture-migration/recording-page-detail.log');}
  await fs.writeFile(path.join(root,'recording-page-detail.log'),result.stdout+result.stderr);
  const report=result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));assert.ok(report,'Missing recording page report');assert.equal(JSON.parse(report).result,'PASS');console.log(report);
 }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('recording-page-'));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
