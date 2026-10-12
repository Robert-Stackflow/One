const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {build}=require('esbuild'),{promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
test('scroll algorithms and capture service preserve source pixels and cancellation boundaries',async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'scroll-unit-'));
  try{
    const base={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
    await Promise.all([
      build({...base,entryPoints:['tests/capture/scroll-core.ts'],outfile:path.join(directory,'core.cjs')}),
      build({...base,entryPoints:['tests/capture/scroll-service.ts'],outfile:path.join(directory,'service.cjs'),plugins:[{name:'native-scroll-fixture',setup(builder){builder.onResolve({filter:/^(electron|\.\/scroll-native)$/},()=>({path:path.resolve('tests/capture/scroll-service-runtime.ts')}));}}]}),
      build({...base,entryPoints:['src/main/capture/scroll-worker.ts'],outfile:path.join(directory,'capture/scroll-worker.cjs')})
    ]);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    let result;try{result=await execFile(process.execPath,['--test','--test-reporter=tap',path.join(directory,'core.cjs'),path.join(directory,'service.cjs')],{env,windowsHide:true,maxBuffer:1024*1024});}catch(error){await fs.writeFile(path.join(root,'scroll-unit-detail.log'),(error.stdout||'')+(error.stderr||''));throw Error(((error.stdout||'')+(error.stderr||'')).slice(-6000));}
    await fs.writeFile(path.join(root,'scroll-unit-detail.log'),result.stdout+result.stderr);assert.match(result.stdout,/# fail 0/);
    console.log(result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('scroll-unit-'));await fs.rm(actual,{recursive:true,force:true});}
});
