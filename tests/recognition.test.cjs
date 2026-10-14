const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {build}=require('esbuild'),{promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
test('recognition models, requests, workflow and One encrypted connections preserve their business contracts',async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'recognition-unit-'));
  try{
    const names=['ocr','ocr-workflow','sensitive','translation','formula','connections','text-document','paddle-recognizer','paddle-detector','paddle-orientation','paddle-model-presets','paddle-alignment','ocr-tiles','paddle-runner','image-preview','inline-ocr','text-region','text-correction','text-area','ai-task'];
    await build({entryPoints:names.map(name=>'tests/recognition/'+name+'.ts'),outdir:directory,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning',plugins:[{name:'recognition-runtime',setup(builder){builder.onResolve({filter:/^electron$/},()=>({path:path.resolve('tests/recognition/runtime.ts')}));}}]});
    const env={...process.env,ONE_RECOGNITION_TEST_ROOT:directory};delete env.NODE_TEST_CONTEXT;
    let result;try{result=await execFile(process.execPath,['--test','--test-reporter=tap',...names.map(name=>path.join(directory,name+'.cjs'))],{env,windowsHide:true,maxBuffer:1024*1024});}catch(error){await fs.writeFile(path.join(root,'recognition-unit-detail.log'),(error.stdout||'')+(error.stderr||''));throw Error(((error.stdout||'')+(error.stderr||'')).slice(-4500));}
    await fs.writeFile(path.join(root,'recognition-unit-detail.log'),result.stdout+result.stderr);assert.match(result.stdout,/# fail 0/);
    console.log(result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('recognition-unit-'));await fs.rm(actual,{recursive:true,force:true});}
});
