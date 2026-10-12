import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { importRecordingVideo, resolveVideoProbe } from '../../src/main/recording/recording-import';
import { resolveRecordingEncoder } from '../../src/main/recording/recording-encoder';

const directory = join(process.env.ONE_RECORDING_TEST_DIRECTORY!, 'import-files');
const executable = await resolveRecordingEncoder(join(directory,'none'));
const probe = await resolveVideoProbe(join(directory,'none'));
before(async () => { await mkdir(directory); });

for (const container of ['mp4','webm'] as const) {
  test(`${container} import retains original bytes in encrypted storage and produces One v1 metadata`, async () => {
    const source = join(directory, `source.${container}`), store = join(directory, container);
    await mkdir(store);
    await promisify(execFile)(executable, ['-hide_banner','-loglevel','error','-f','lavfi','-i',
      'testsrc2=size=64x48:rate=24000/1001:duration=0.5','-an','-c:v',
      container === 'mp4' ? 'libx264' : 'libvpx-vp9','-threads','1','-y',source],
      {windowsHide:true,timeout:20000,maxBuffer:65536});
    const original = await readFile(source), progress: number[] = [];
    const result = await importRecordingVideo(source,store,probe,new AbortController().signal,()=>true,value=>progress.push(value));
    try {
      assert.equal(result.project.version,1);
      assert.equal(result.project.origin,'video');
      assert.equal(result.project.options.container,container);
      assert.equal(result.project.video?.width,64);
      assert.equal(result.project.video?.height,48);
      assert.ok(Math.abs(result.project.video!.fps-24000/1001)<0.03);
      assert.equal(progress.at(-1),1);
      const parts: Buffer[] = [];
      for await (const bytes of result.file.read()) parts.push(bytes);
      assert.deepEqual(Buffer.concat(parts),original);
      assert.notDeepEqual(await readFile(result.file.path),original);
    } finally { await result.file.dispose(); }
    assert.deepEqual(await readdir(store),[]);
    assert.deepEqual(await readFile(source),original);
  });
}

test('invalid, cancelled and changed imports clean their own encrypted data and retain the source', async () => {
  const source = join(directory,'source.mp4'), original = await readFile(source), store = join(directory,'cancelled');
  await mkdir(store);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(importRecordingVideo(source,store,probe,aborted.signal,()=>true),/取消/);
  let valid = true;
  await assert.rejects(importRecordingVideo(source,store,probe,new AbortController().signal,()=>valid,()=>{valid=false;}),/取消/);
  await assert.rejects(importRecordingVideo(source,store,probe,new AbortController().signal,()=>true,()=>{
    // A synchronous source mutation occurs after copying and before final identity validation.
    appendFileSync(source,Buffer.from([0]));
  }),/发生变化/);
  await writeFile(source,original);
  const invalid = join(directory,'invalid.mp4');
  await writeFile(invalid,Buffer.alloc(24));
  await assert.rejects(importRecordingVideo(invalid,store,probe,new AbortController().signal,()=>true),/不是受支持/);
  assert.deepEqual(await readdir(store),[]);
  assert.deepEqual(await readFile(source),original);
});
