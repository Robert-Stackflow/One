const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {build} = require('esbuild');
async function main() {
  const root = process.cwd(), evidence = path.resolve('work/current/capture-migration');
  await fs.mkdir(evidence, {recursive:true});
  const directory = await fs.mkdtemp(path.join(evidence, 'recording-codecs-'));
  await fs.writeFile(path.join(directory,'.one-fixture'),'One recording codec tests');
  try {
    const {mainOptions} = await import('../scripts/bundle-options.mjs');
    assert.ok(mainOptions.entryPoints.includes('src/main/recording/recording-gif-worker.ts'));
    await build({...mainOptions,entryPoints:{'recording/recording-gif-worker':'src/main/recording/recording-gif-worker.ts'}});
    const entries = [];
    for (const name of ['export','import','import-file','result-hosts']) {
      const outfile = path.join(directory,name+'.mjs');
      await build({entryPoints:['tests/recording/'+name+'.ts'],outfile,bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',define:{__dirname:JSON.stringify(path.resolve('dist/main'))},plugins:name==='result-hosts'?[{name:'host-dialog-fixture',setup(builder){builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const dialog = {showSaveDialog: (...args) => globalThis.__oneRecordingDialog(...args)};'}));}}]:[]});
      entries.push(outfile);
    }
    const env = {...process.env,ONE_RECORDING_TEST_ROOT:root,ONE_RECORDING_TEST_DIRECTORY:directory,TEMP:directory,TMP:directory};
    delete env.ELECTRON_RUN_AS_NODE;
    let result;
    try {
      result = await promisify(execFile)(process.execPath,['--test','--test-concurrency=1',...entries],{cwd:root,env,windowsHide:true,timeout:240000,maxBuffer:2*1024*1024});
    } catch(error) {
      await fs.writeFile(path.join(evidence,'recording-codecs-detail.log'),String(error.stdout||'')+String(error.stderr||''));
      throw Error('Recording codec tests failed; see work/current/capture-migration/recording-codecs-detail.log');
    }
    await fs.writeFile(path.join(evidence,'recording-codecs-detail.log'),result.stdout+result.stderr);
    console.log(result.stdout.split(/\r?\n/).filter(line=>/^# (tests|suites|pass|fail|cancelled|skipped|duration_ms) /.test(line)).join('\n'));
  } finally {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual),await fs.realpath(evidence));
    assert.ok(path.basename(actual).startsWith('recording-codecs-'));
    assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One recording codec tests');
    await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
