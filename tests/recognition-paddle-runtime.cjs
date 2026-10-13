// Explicit local-model benchmark; prepare pinned model/config files before running. Never downloads implicitly.
const { build } = require('esbuild'), fs = require('node:fs/promises'), path = require('node:path');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
(async () => {
  const root = path.resolve(process.env.ONE_PADDLE_PROBE_ROOT || 'work/current/capture-reconstruction');
  await Promise.all(['pp-ocrv6-tiny-rec.onnx', 'pp-ocrv6-tiny-rec.yml', 'pp-ocrv6-tiny-det.onnx', 'pp-ocrv6-tiny-det.yml'].map(name => fs.stat(path.join(root, name))));
  const entry = path.join(root, 'paddle-runtime.cjs');
  await build({ entryPoints: ['tests/recognition/paddle-runtime.ts'], outfile: entry, bundle: true, platform: 'node',
    format: 'cjs', packages: 'external', logLevel: 'warning' });
  const env = { ...process.env, ONE_PADDLE_PROBE_ROOT: root };
  const result = await promisify(execFile)(process.execPath, [entry], { env, windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 });
  process.stdout.write(result.stdout);
})().catch(error => { console.error(String(error.stderr || error.message).slice(0, 4000)); process.exitCode = 1; });
