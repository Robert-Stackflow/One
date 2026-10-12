import {app, nativeImage, screen} from 'electron';
import assert from 'node:assert/strict';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {RecordingSources} from '../../src/main/recording/recording-sources';
import {sourcePreviews} from '../../src/main/recording/recording-sources-protocol';
import {NativeCameraPreview} from '../../src/main/recording/native-camera-preview';
import {audioDevices} from '../../src/main/recording/native-audio';
import {cameraDevices} from '../../src/main/recording/native-video';

const directory = process.env.ONE_RECORDING_TEST_DIRECTORY!;
app.setPath('userData', join(directory, 'profile'));
app.setPath('crashDumps', join(directory, 'crashes'));
const sources = new RecordingSources();
const previews = new Set<NativeCameraPreview>();
const children = new Set<ChildProcessWithoutNullStreams>();
const closed: Promise<void>[] = [];
const temporary = join(directory, 'preview-temp');
function track(child: ChildProcessWithoutNullStreams) {
  children.add(child);
  closed.push(new Promise(resolve => child.once('close', () => {children.delete(child);resolve();})));
  return child;
}
const launch: typeof spawn = ((file: string, args: string[], options: object) => track(spawn(file, args, {
  ...options, env:{...process.env,TEMP:temporary,TMP:temporary},
}) as ChildProcessWithoutNullStreams)) as typeof spawn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => {
  for (const child of children) child.kill();
  void sources.stop().finally(() => app.exit(1));
}, 35000);
void app.whenReady().then(async () => {
  await mkdir(temporary, {recursive:true});
  const valid = {id:'window:123:0',name:'Test source',display_id:'',thumbnail:'data:image/png;base64,',pid:42};
  assert.equal(sourcePreviews([valid], 'window').length, 1);
  for (const rows of [
    [{...valid,thumbnail:'https://invalid.local/image'}], [valid,valid],
    [{...valid,pid:0}], [{...valid,name:'a'.repeat(201)}],
    [{...valid,thumbnail:'data:image/png;base64,'+'a'.repeat(256*1024)}],
  ]) assert.throws(() => sourcePreviews(rows, 'window'));
  assert.throws(() => sourcePreviews([valid], 'screen'));

  // Enumeration opens no recording endpoint; only counts enter the evidence.
  const [audio, cameras] = await Promise.all([audioDevices(), cameraDevices()]);
  assert.equal(audio.rate, 48000);
  assert.equal(audio.channels, 2);
  assert.ok(audio.bitrates.length > 0);
  assert.ok(cameras.every(camera => camera.id && camera.name));

  const catalog = await sources.run('screen', () => true);
  assert.equal(catalog.length, screen.getAllDisplays().length);
  assert.equal(catalog[0].display_id, String(screen.getPrimaryDisplay().id));
  for (const source of catalog) {
    const image = nativeImage.createFromDataURL(source.thumbnail);
    assert.equal(image.isEmpty(), false, 'actual native display preview should decode');
    const size = image.getSize();
    assert.ok(size.width <= 1280 && size.height <= 1280);
  }
  const superseded = sources.run('screen', () => true);
  const cancelled = assert.rejects(superseded, /取消/);
  const replacement = sources.run('screen', () => true);
  await cancelled;
  assert.equal((await replacement).length, catalog.length);
  const pending = sources.run('screen', () => true);
  const stopped = assert.rejects(pending, /取消/);
  await sources.stop();
  await stopped;
  assert.deepEqual(sources.stats(), {jobs:0,processes:[]});
  await assert.rejects(sources.run('screen', () => false), /取消/);

  const camera = new NativeCameraPreview('fixture-camera', launch, true);
  previews.add(camera);
  await camera.ready;
  const jpeg = camera.frame(), image = nativeImage.createFromBuffer(jpeg);
  assert.deepEqual(image.getSize(), {width:320,height:240});
  assert.ok(jpeg.length < 2*1024*1024);
  await delay(220);
  assert.notEqual(camera.frame(), jpeg, 'preview must continue receiving frames');
  await Promise.all([camera.stop(), camera.stop()]);
  assert.throws(() => camera.frame(), /尚未就绪|关闭/);

  const starting = new NativeCameraPreview('fixture-camera', launch, true);
  previews.add(starting);
  const earlyStop = assert.rejects(starting.ready, /关闭/);
  await starting.stop();
  await earlyStop;
  const invalidLaunch: typeof spawn = ((_file: string, _args: string[], options: object) => track(spawn(process.execPath, [
    '-e', 'process.stdout.write(Buffer.from([255,255,255,255]));setInterval(()=>{},100);',
  ], {...options,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}) as ChildProcessWithoutNullStreams)) as typeof spawn;
  const malformed = new NativeCameraPreview('fixture-camera', invalidLaunch, true);
  previews.add(malformed);
  await assert.rejects(malformed.ready, /数据无效/);
  await malformed.stop();
  await Promise.all(closed);
  assert.equal(children.size, 0);
  assert.deepEqual(await readdir(temporary), [], 'preview must not create recording or camera files');
  console.log(JSON.stringify({result:'PASS',audioDevices:audio.devices.length,cameraDevices:cameras.length,displayPreviews:catalog.length,sourceReplacement:true,sourceCancellation:true,cameraJpeg:true,cameraEarlyStop:true,invalidStreamRejected:true,childProcesses:0,recordingFiles:0}));
}).catch(error => {
  process.exitCode = 1;
  console.error(String(error.stack || error).slice(0,3000));
}).finally(async () => {
  clearTimeout(timeout);
  await sources.stop();
  await Promise.all([...previews].map(preview => preview.stop()));
  await Promise.all(closed);
  app.exit(process.exitCode || 0);
});
