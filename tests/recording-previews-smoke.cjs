const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const {execFile} = require('node:child_process'), {promisify} = require('node:util'), {build} = require('esbuild');
async function main() {
  const root = path.resolve('work/current/capture-migration');
  await fs.mkdir(root,{recursive:true});
  const directory = await fs.mkdtemp(path.join(root,'recording-previews-'));
  try {
    const entry = path.join(directory,'test.cjs');
    await build({entryPoints:['tests/recording/previews.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',external:['electron','koffi'],define:{__dirname:JSON.stringify(path.resolve('dist/main'))}});
    const env = {...process.env,ONE_RECORDING_TEST_DIRECTORY:directory};
    delete env.ELECTRON_RUN_AS_NODE;
    let result;
    try {
      result = await promisify(execFile)(require('electron'),[entry],{cwd:process.cwd(),env,windowsHide:true,timeout:45000,maxBuffer:64*1024});
    } catch(error) {
      await fs.writeFile(path.join(root,'recording-previews-detail.log'),String(error.stdout||'')+String(error.stderr||''));
      throw Error('Recording preview tests failed; see work/current/capture-migration/recording-previews-detail.log');
    }
    await fs.writeFile(path.join(root,'recording-previews-detail.log'),result.stdout+result.stderr);
    const report = result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));
    assert.ok(report,'Missing recording preview report');
    assert.equal(JSON.parse(report).result,'PASS');
    console.log(report);
  } finally {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual),await fs.realpath(root));
    assert.ok(path.basename(actual).startsWith('recording-previews-'));
    await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
