import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Official Apache-2.0 weights/configs, pinned independently from repository code licenses.
const models = [
  { id: 'PaddlePaddle/PP-OCRv6_tiny_rec_onnx', revision: '2612ab37152ae0a677521bae4e1e3d4fb4cf7c30', metadata: 'pp-ocrv6-tiny-rec-metadata.json',
    files: [
      { remote: 'inference.onnx', name: 'pp-ocrv6-tiny-rec.onnx', bytes: 4462639, sha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6' },
      { remote: 'inference.yml', name: 'pp-ocrv6-tiny-rec.yml', bytes: 55571, sha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1' },
    ] },
  { id: 'PaddlePaddle/PP-OCRv6_tiny_det_onnx', revision: '2ba1506c0380b8f0b03dd142459aac66d4421f6c', metadata: 'PP-OCRv6_tiny_det_onnx-metadata.json',
    files: [
      { remote: 'inference.onnx', name: 'pp-ocrv6-tiny-det.onnx', bytes: 1780590, sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8' },
      { remote: 'inference.yml', name: 'pp-ocrv6-tiny-det.yml', bytes: 883, sha256: '3ac018be6f97499a08faa3bbdeb33640968d9307f6736d152902747a9f259593' },
    ] },
];
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
let downloaded = 0;
for (const model of models) {
  for (const artifact of model.files) {
    const file = join(root, artifact.name);
    if (await valid(file, artifact)) continue;
    if (!prepare) throw Error(`基准模型缺失或校验失败：${artifact.name}；显式运行 node scripts/prepare-recognition-benchmark.mjs --prepare 准备模型`);
    const part = join(root, artifact.name + '.' + randomUUID() + '.part');
    try {
      await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--proto', '=https', '--proto-redir', '=https', '--max-redirs', '4',
        '--http1.1', '-fsSL', '--connect-timeout', '10', '--max-time', '90',
        `https://huggingface.co/${model.id}/resolve/${model.revision}/${artifact.remote}`, '-o', part], { windowsHide: true, maxBuffer: 64 * 1024, timeout: 100000 });
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
console.log(JSON.stringify({ verifiedFiles: 4, downloadedBytes: downloaded, source: 'PaddlePaddle', license: 'Apache-2.0', root }));
