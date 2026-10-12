const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {build}=require('esbuild'),{promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
test('recognition worker and pinned language packs operate with real English and Chinese pixels',async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'recognition-ocr-'));
  try{
    const options={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
    await Promise.all([build({...options,entryPoints:['tests/recognition/ocr-runtime.ts'],outfile:path.join(directory,'test.cjs')}),build({...options,entryPoints:['src/main/recognition/ocr-worker.ts','src/main/recognition/ocr-engine.ts'],outdir:path.join(directory,'recognition'),outExtension:{'.js':'.cjs'}})]);
    const env={...process.env,ONE_RECOGNITION_TEST_ROOT:directory};delete env.NODE_TEST_CONTEXT;
    let result;try{result=await execFile(process.execPath,['--test','--test-reporter=tap',path.join(directory,'test.cjs')],{env,windowsHide:true,maxBuffer:1024*1024,timeout:180000});}catch(error){await fs.writeFile(path.join(root,'recognition-ocr-detail.log'),(error.stdout||'')+(error.stderr||''));throw Error(((error.stdout||'')+(error.stderr||'')).slice(-4500));}
    await fs.writeFile(path.join(root,'recognition-ocr-detail.log'),result.stdout+result.stderr);assert.match(result.stdout,/# fail 0/);
    console.log(result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('recognition-ocr-'));await fs.rm(actual,{recursive:true,force:true});}
});
