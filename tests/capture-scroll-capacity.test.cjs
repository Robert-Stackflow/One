const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {build}=require('esbuild'),{promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
test('long screenshots use bounded disk-backed export beyond ordinary image limits',async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'scroll-capacity-'));
  try{
    await build({bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning',entryPoints:['tests/capture/scroll-capacity.ts'],outfile:path.join(directory,'capacity.cjs')});
    const env={...process.env,TEMP:directory,TMP:directory};delete env.NODE_TEST_CONTEXT;
    let result;try{result=await execFile(process.execPath,['--test',path.join(directory,'capacity.cjs')],{env,windowsHide:true,maxBuffer:256*1024,timeout:180000});}
    catch(error){await fs.writeFile(path.join(root,'scroll-capacity-detail.log'),(error.stdout||'')+(error.stderr||''));throw Error(((error.stdout||'')+(error.stderr||'')).slice(-5000));}
    await fs.writeFile(path.join(root,'scroll-capacity-detail.log'),result.stdout+result.stderr);assert.match(result.stdout,/# fail 0/);
    console.log(result.stdout.split('\n').filter(line=>/^# (tests|pass|fail|\{)/.test(line)).join('\n'));
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('scroll-capacity-'));await fs.rm(actual,{recursive:true,force:true});}
});
