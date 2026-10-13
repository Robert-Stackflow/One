// Explicit local-model benchmark; prepare pinned model/config files before running. Never downloads implicitly.
const { build } = require('esbuild'), fs = require('node:fs/promises'), path = require('node:path');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
(async () => {
  const root = path.resolve(process.env.ONE_PADDLE_PROBE_ROOT || 'work/current/capture-reconstruction');
  await Promise.all(['pp-ocrv6-tiny-rec.onnx', 'pp-ocrv6-tiny-rec.yml', 'pp-ocrv6-tiny-det.onnx', 'pp-ocrv6-tiny-det.yml'].map(name => fs.stat(path.join(root, name))));
  const entry = path.join(root, 'paddle-runtime.cjs');
  await build({ entryPoints: ['tests/recognition/paddle-runtime.ts'], outfile: entry, bundle: true, platform: 'node',
    format: 'cjs', packages: 'external', logLevel: 'warning' });
  await build({ entryPoints: ['src/main/recognition/paddle-worker.ts'], outfile: path.join(root,'paddle-worker.cjs'), bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'warning' });
  const env = { ...process.env, ONE_PADDLE_PROBE_ROOT: root };
  if(process.argv.includes('--electron-worker-only')){
    const electronEntry=path.join(root,'paddle-electron-runtime.cjs');
    await build({entryPoints:['tests/recognition/paddle-electron-runtime.ts'],outfile:electronEntry,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'warning'});
    const profile=await fs.mkdtemp(path.join(root,'electron-local-inference-'));env.ONE_PADDLE_PROFILE=profile;delete env.ELECTRON_RUN_AS_NODE;
    try{const result=await promisify(execFile)(require('electron'),[electronEntry],{env,windowsHide:true,timeout:120000,maxBuffer:64*1024});process.stdout.write(result.stdout);}
    finally{const actual=await fs.realpath(profile);if(path.dirname(actual)!==await fs.realpath(root)||!path.basename(actual).startsWith('electron-local-inference-'))throw Error('Unsafe benchmark cleanup path');await fs.rm(actual,{recursive:true,force:true});}
    return;
  }
  const result = await promisify(execFile)(process.execPath, [entry,...process.argv.slice(2)], { env, windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 });
  process.stdout.write(result.stdout);
})().catch(error => { console.error(String(error.stderr || error.message).slice(0, 4000)); process.exitCode = 1; });
