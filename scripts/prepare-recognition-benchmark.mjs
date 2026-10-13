import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, readFile, writeFile, rename, unlink, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The application catalog is the single lockfile for adapted official presets.
const roles = { detection: 'det.onnx', detectionConfig: 'det.yml', recognition: 'rec.onnx', recognitionConfig: 'rec.yml', orientation: 'orientation.onnx', orientationConfig: 'orientation.yml' };
const root = resolve(process.env.ONE_PADDLE_PROBE_ROOT || 'work/current/capture-reconstruction');
const prepare = process.argv.includes('--prepare'), run = promisify(execFile);
async function valid(file, artifact) {
  try {
    if ((await stat(file)).size !== artifact.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === artifact.sha256;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
await mkdir(root, { recursive: true });
const bundled = await build({ entryPoints: ['src/main/local-model-catalog.ts'], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { paddleOCRPresets } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const option = process.argv.indexOf('--preset');
if (option >= 0 && (!process.argv[option + 1] || process.argv[option + 1].startsWith('--'))) throw Error('--preset 需要模型 ID');
const requested = process.argv.includes('--all-ocr') ? paddleOCRPresets.map(model => model.id) : option >= 0 ? process.argv[option + 1].split(',') : ['pp-ocrv6-tiny'];
const grouped = new Map();
for (const id of new Set(requested)) {
  const preset = paddleOCRPresets.find(model => model.id === id);
  if (!preset) throw Error('未适配的 OCR 预设：' + id);
  for (const artifact of preset.artifacts) {
    const [, namespace, repository, , revision, remote] = new URL(artifact.url).pathname.split('/'), key = namespace + '/' + repository;
    let model = grouped.get(key);
    if (!model) grouped.set(key, model = { id: key, revision, metadata: key === 'PaddlePaddle/PP-OCRv6_tiny_rec_onnx' ? 'pp-ocrv6-tiny-rec-metadata.json' : repository + '-metadata.json', files: [] });
    const suffix = roles[artifact.role]; if (!suffix) throw Error('无法准备 OCR 文件类型：' + artifact.role);
    const orientation = artifact.role.startsWith('orientation');
    const name = orientation ? 'pp-textline-' + suffix : preset.id + '-' + suffix;
    const candidate = join(root, 'paddle-presets', orientation ? suffix : preset.size + '-' + suffix);
    if (!model.files.some(file => file.remote === remote)) model.files.push({ remote, name, candidate, bytes: artifact.bytes, sha256: artifact.sha256 });
  }
}
const models = [...grouped.values()];
let downloaded = 0, copied = 0;
for (const model of models) {
  for (const artifact of model.files) {
    const file = join(root, artifact.name);
    if (await valid(file, artifact)) continue;
    if (!prepare) throw Error(`基准模型缺失或校验失败：${artifact.name}；显式运行 node scripts/prepare-recognition-benchmark.mjs --prepare 准备模型`);
    if (await valid(artifact.candidate, artifact)) { await copyFile(artifact.candidate, file); copied += artifact.bytes; continue; }
    const part = join(root, artifact.name + '.' + randomUUID() + '.part');
    try {
      await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--proto', '=https', '--proto-redir', '=https', '--max-redirs', '4',
        '--http1.1', '-fsSL', '--connect-timeout', '10', '--max-time', '180',
        `https://huggingface.co/${model.id}/resolve/${model.revision}/${artifact.remote}`, '-o', part], { windowsHide: true, maxBuffer: 64 * 1024, timeout: 190000 });
      if (!await valid(part, artifact)) throw Error('基准模型大小或 SHA-256 校验失败：' + artifact.name);
      await rename(part, file); downloaded += artifact.bytes;
    } finally { await unlink(part).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  const metadata = join(root, model.metadata);
  try {
    const value = JSON.parse(await readFile(metadata, 'utf8'));
    if (value.sha !== model.revision || value.id !== model.id) throw Error('基准模型来源记录与锁定版本不匹配');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(metadata, JSON.stringify({ id: model.id, sha: model.revision, cardData: { license: 'apache-2.0' },
      siblings: model.files.map(artifact => ({ rfilename: artifact.remote, size: artifact.bytes, lfs: { sha256: artifact.sha256 } })) }, null, 2), { flag: 'wx' });
  }
}
console.log(JSON.stringify({ presets: [...new Set(requested)], verifiedFiles: models.reduce((sum, model) => sum + model.files.length, 0), downloadedBytes: downloaded, reusedLocalBytes: copied, source: 'PaddlePaddle', license: 'Apache-2.0', root }));
