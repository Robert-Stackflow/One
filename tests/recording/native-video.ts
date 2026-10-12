import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile, stat, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeVideo } from '../../src/main/recording/native-video';
import { RecordingFile } from '../../src/main/recording/recording-file';
import { completeVideoPrefix } from '../../src/main/recording/video-fragments';
import { loadNativeCursor } from '../../src/main/recording/native-cursor';
import { cursorFrameAt } from '../../src/shared/recording/recording-cursor';
import { defaultCameraStyle } from '../../src/shared/recording/recording-camera';
import { defaultInputStyle } from '../../src/shared/recording/recording-input';
import {
  emptyAnnotationScene,
  defaultAnnotationStyle,
  AnnotationReplay,
} from '../../src/shared/recording/recording-annotations';
const root = process.env.ONE_RECORDING_TEST_ROOT!,
  directory = process.env.ONE_RECORDING_TEST_DIRECTORY!;
const executable = join(root, 'dist/native/One.RecordingVideo.exe');
const evidence: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  status: 'incomplete',
  scope:
    'Real D3D11 crop/scale/color conversion and Media Foundation H.264/AAC encoding and decoding, synthetic sources; no desktop input or audio devices opened.',
};
const children = new Set<ChildProcessWithoutNullStreams>();
test('private ANI extraction preserves repeated steps, per-step rates and static compatibility', async () => {
  const dwords = (...values: number[]) => {
    const data = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => data.writeUInt32LE(value, i * 4));
    return data;
  };
  const chunk = (tag: string, bytes: Buffer) =>
    Buffer.concat([Buffer.from(tag), dwords(bytes.length), bytes, Buffer.alloc(bytes.length % 2)]);
  const icon = (red: boolean) => {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(2, 2);
    header.writeUInt16LE(1, 4);
    header[6] = header[7] = 8;
    header.writeUInt16LE(2, 10);
    header.writeUInt16LE(3, 12);
    header.writeUInt32LE(328, 14);
    header.writeUInt32LE(22, 18);
    const bitmap = Buffer.alloc(40);
    bitmap.writeUInt32LE(40, 0);
    bitmap.writeInt32LE(8, 4);
    bitmap.writeInt32LE(16, 8);
    bitmap.writeUInt16LE(1, 12);
    bitmap.writeUInt16LE(32, 14);
    const pixels = Buffer.alloc(256);
    for (let i = 0; i < 64; i++) {
      pixels[i * 4 + (red ? 2 : 0)] = 255;
      pixels[i * 4 + 3] = 255;
    }
    return Buffer.concat([header, bitmap, pixels, Buffer.alloc(32)]);
  };
  const file = join(directory, 'private.ani'),
    path = join(directory, 'animated-cursor');
  const body = Buffer.concat([
    Buffer.from('ACON'),
    chunk('anih', dwords(36, 2, 3, 8, 8, 32, 1, 6, 3)),
    chunk('rate', dwords(3, 9, 6)),
    chunk('seq ', dwords(0, 1, 0)),
    chunk(
      'LIST',
      Buffer.concat([Buffer.from('fram'), chunk('icon', icon(true)), chunk('icon', icon(false))]),
    ),
  ]);
  await writeFile(file, chunk('RIFF', body));
  assert.equal(
    (await command(executable, ['cursor-animation-test', path, file])).cursorAnimation,
    true,
  );
  const track = await loadNativeCursor(path, 8, 8, 48000);
  assert.equal(track.shapes.length, 2);
  assert.deepEqual(track.shapes[0].animation, [
    { shape: 1, samples: 2400 },
    { shape: 2, samples: 7200 },
    { shape: 1, samples: 4800 },
  ]);
  assert.deepEqual(
    track.shapes.map((s) => [s.hotspotX, s.hotspotY]),
    [
      [2, 3],
      [2, 3],
    ],
  );
  assert.equal(Buffer.from(track.shapes[0].pixels, 'base64')[0], 255);
  assert.equal(Buffer.from(track.shapes[1].pixels, 'base64')[2], 255);
  assert.equal(cursorFrameAt(track, 2400), 2);
  assert.equal(cursorFrameAt(track, 9600), 1);
  const fallback = join(directory, 'static-cursor');
  assert.equal(
    (await command(executable, ['cursor-static-test', fallback, file])).cursorAnimation,
    false,
  );
  const still = await loadNativeCursor(fallback, 8, 8, 48000);
  assert.equal(still.shapes.length, 1);
  assert.equal(still.shapes[0].animation, undefined);
  assert.equal(still.shapes[0].pixels, track.shapes[0].pixels);
  await writeFile(
    path + '.cursor-1.animation.json',
    '[{"shape":1,"samples":2400},{"shape":64,"samples":7200}]',
  );
  await assert.rejects(loadNativeCursor(path, 8, 8, 48000), /ENOENT/);
  await writeFile(
    path + '.cursor-1.animation.json',
    '[{"shape":1,"samples":0},{"shape":2,"samples":7200}]',
  );
  await assert.rejects(loadNativeCursor(path, 8, 8, 48000), /光标动画/);
  evidence.cursorAnimation = {
    steps: 3,
    frames: 2,
    samples: [2400, 7200, 4800],
    privateANI: true,
    staticFallback: true,
  };
});
test('cursor raster extraction keeps straight alpha, hotspots and XOR masks without reading OS input', async () => {
  const path = join(directory, 'cursor-raster');
  assert.equal((await command(executable, ['cursor-test', path])).cursorTest, true);
  const normal = await readFile(path + '.cursor-1.bin'),
    inverse = await readFile(path + '.cursor-2.bin');
  assert.equal(normal.readUInt32LE(0), 8);
  assert.equal(normal.readUInt32LE(4), 8);
  assert.equal(normal.readUInt32LE(8), 2);
  assert.equal(normal.readUInt32LE(12), 3);
  assert.equal(normal[16], 255);
  assert.equal(normal[17], 0);
  assert.equal(normal[18], 0);
  assert.ok(Math.abs(normal[19] - 128) <= 1);
  assert.equal(normal[20], 0);
  assert.equal(inverse[19], 0);
  assert.equal(inverse[20], 255);
  evidence.cursorRaster = { hotspot: [2, 3], straightAlpha: normal[19], inverseMask: inverse[20] };
});
test('independent cursor track maps crop/scale, hides outside, splits pause/movement and retains click samples', async () => {
  let child: ReturnType<typeof spawn> | undefined;
  const progress: any[] = [];
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'screen:1:0',
      systemAudio: false,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      cursor: true,
      videoEncoder: 'software',
    },
    { kind: 'monitor', handle: 1, pid: 0, crop: { x: 80, y: 40, width: 480, height: 240 } },
    (event) => progress.push(event),
    (exe, args) => {
      const native = [...args];
      native[10] = '240';
      return (child = spawn(exe, ['capture-test', ...native.slice(1)], {
        windowsHide: true,
        stdio: 'pipe',
      }));
    },
  );
  const wait = async (predicate: () => boolean) => {
    const end = Date.now() + 6000;
    while (!predicate()) {
      if (Date.now() > end) throw Error('cursor fixture timed out');
      await delay(20);
    }
  };
  try {
    await video.ready;
    child!.stdin!.write('fixture-cursor 180 100 1 0\n');
    await wait(() => progress.some((e) => e.samples > 4800));
    await video.pause(true);
    const frozen = progress.at(-1).samples;
    child!.stdin!.write('fixture-cursor 240 150 2 1\n');
    await delay(120);
    assert.equal(progress.at(-1).samples, frozen);
    await video.pause(false);
    await delay(110);
    child!.stdin!.write('fixture-cursor 240 150 2 0\n');
    await delay(80);
    child!.stdin!.write('fixture-cursor 240 150 2 1\n');
    await delay(110);
    child!.stdin!.write('fixture-cursor -20 150 2 0\n');
    await delay(100);
    await video.moveRegion(40, 20);
    child!.stdin!.write('fixture-cursor 180 100 2 0\n');
    await delay(100);
    const result = await video.finish(),
      track = video.cursor!;
    assert.ok(
      track.events.some((e) => e.x === 50 && e.y === 30 && e.shape === 1 && e.scale === 0.5),
    );
    assert.ok(
      track.events.some(
        (e) => e.segment === 1 && e.x === 80 && e.y === 55 && e.shape === 2 && !e.click,
      ),
    );
    assert.ok(track.events.some((e) => e.segment === 1 && e.click === 1));
    assert.ok(track.events.some((e) => e.shape === 0));
    assert.ok(track.events.some((e) => e.segment === 2 && e.x === 70 && e.y === 40));
    assert.ok(track.events.every((e) => e.sample <= result.samples));
    assert.equal(track.shapes.length, 2);
    assert.deepEqual(
      track.shapes.map((s) => [s.hotspotX, s.hotspotY]),
      [
        [2, 3],
        [2, 3],
      ],
    );
    evidence.cursorTrack = {
      events: track.events.length,
      shapes: track.shapes.length,
      pausedSample: frozen,
      samples: result.samples,
    };
  } finally {
    await video.dispose();
  }
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test('video recovery excludes a truncated last fragment and rejects missing movie metadata', async () => {
  const box = (name: string, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length);
    header.write(name, 4, 'ascii');
    return Buffer.concat([header, payload]);
  };
  const metadata = Buffer.concat([box('ftyp'), box('moov')]);
  const fragment = Buffer.concat([box('moof'), box('mdat', Buffer.alloc(32, 7))]);
  const good = Buffer.concat([metadata, fragment]);
  const path = join(directory, 'fragment-prefix.mp4');
  for (const suffix of [
    Buffer.alloc(0),
    fragment.subarray(0, 6),
    fragment.subarray(0, fragment.length - 1),
  ]) {
    const bytes = Buffer.concat([good, suffix]);
    await writeFile(path, bytes);
    assert.equal(await completeVideoPrefix(path), good.length);
    assert.deepEqual(await readFile(path), bytes);
  }
  await writeFile(path, Buffer.concat([box('ftyp'), fragment]));
  await assert.rejects(completeVideoPrefix(path), /编码信息/);
  await writeFile(path, Buffer.concat([metadata, fragment.subarray(0, fragment.length - 1)]));
  await assert.rejects(completeVideoPrefix(path), /完整可恢复片段/);
});
async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('Native video timed out');
    await delay(20);
  }
}
const command = async (exe: string, args: string[]) =>
  JSON.parse(
    (
      await promisify(execFile)(exe, args, {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout,
  );
function capture(
  name: string,
  sound = false,
  fps = 30,
  input = 0,
  kind = 'window',
  camera = false,
) {
  const file = join(directory, name + '.mp4');
  const child = spawn(
    executable,
    [
      'capture-test',
      file,
      kind,
      '1',
      '0',
      String(process.pid),
      '80',
      '40',
      '480',
      '240',
      '320',
      String(fps),
      '4000000',
      sound ? 'default' : 'none',
      sound ? 'default' : 'none',
      '128000',
      '0',
      'software',
      String(input),
      camera ? 'fixture-camera' : 'none',
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  children.add(child);
  const events: any[] = [];
  let pending = '',
    diagnostics = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (text) => {
    pending += text;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) if (line) events.push(JSON.parse(line));
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    diagnostics += text;
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      children.delete(child);
      if (code !== 0) {
        evidence.failures = [
          ...((evidence.failures as unknown[]) || []),
          { name, code, diagnostics, events: events.slice(-8) },
        ];
        reject(
          Error((diagnostics || 'Video exited ' + code) + '\n' + JSON.stringify(events.slice(-8))),
        );
      } else resolve();
    });
  });
  void closed.catch(() => {});
  return {
    file,
    events,
    child,
    closed,
    async ready() {
      await Promise.race([
        until(() => events.some((e) => e.kind === 'ready')),
        closed.then(() => {
          throw Error('Video closed before ready');
        }),
      ]);
    },
    async control(verb: string, id: number) {
      child.stdin.write(`${verb} ${id}\n`);
      await Promise.race([
        until(() => events.some((e) => e.kind === 'ack' && e.id === id)),
        closed.then(() => {
          throw Error('Video closed before acknowledgement');
        }),
      ]);
      return events.find((e) => e.kind === 'ack' && e.id === id);
    },
    async stop() {
      child.stdin.write('stop 0\n');
      await closed;
      return events.find((e) => e.kind === 'done');
    },
  };
}

test('camera and screen share timestamps, pause and resume; native JPEG preview stays live and device failure retains both tracks', async () => {
  const video = capture('camera-timing', false, 30, 0, 'screen', true);
  await video.ready();
  const ready = video.events.find((v) => v.kind === 'ready');
  assert.deepEqual([ready.camera.width, ready.camera.height, ready.camera.fps], [320, 240, 30]);
  await until(() => video.events.some((v) => v.kind === 'camera-frame'));
  const jpg = await readFile(video.file + '.camera.jpg');
  assert.equal(jpg[0], 255);
  assert.equal(jpg[1], 216);
  assert.ok(jpg.length < 2 * 1024 * 1024);
  const paused = await video.control('pause', 1),
    serial = video.events.filter((v) => v.kind === 'camera-frame').at(-1).serial;
  await delay(300);
  const marked = await video.control('mark', 2);
  assert.equal(marked.samples, paused.samples);
  assert.ok(
    video.events.filter((v) => v.kind === 'camera-frame').at(-1).serial > serial,
    'preview continues while encoded time is paused',
  );
  await video.control('resume', 3);
  await delay(350);
  video.child.stdin.write('fixture-camera-fail\n');
  await video.closed;
  const done = video.events.find((v) => v.kind === 'done');
  assert.match(done.warning, /摄像头已断开/);
  assert.equal(done.samples, done.cameraSamples);
  const [screen, camera] = await Promise.all([
    command(executable, ['inspect', video.file]),
    command(executable, ['inspect', video.file + '.camera.mp4']),
  ]);
  assert.equal(screen.frames, camera.frames);
  assert.equal(screen.duration, camera.duration);
  assert.equal(camera.width, 320);
  assert.equal(camera.height, 240);
  evidence.cameraClock = {
    screen,
    camera,
    pausedSamples: paused.samples,
    liveJpegBytes: jpg.length,
    deviceFailureRetainsTracks: true,
  };
});

test('camera layouts use acknowledged frame time; independent encrypted camera sealing can retry without changing originals', async () => {
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'window:1:0',
      systemAudio: false,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      videoEncoder: 'software',
      camera: { deviceId: 'fixture-camera', style: defaultCameraStyle() },
    },
    { kind: 'window', handle: 1, pid: 1 },
    () => {},
    (exe, args) =>
      spawn(exe, ['capture-test', ...args.slice(1)], { windowsHide: true, stdio: 'pipe' }),
  );
  const file = new RecordingFile(directory),
    retry = new RecordingFile(directory);
  try {
    await video.ready;
    await until(() => video.cameraSerial > 0);
    const jpeg = await video.cameraPreview();
    assert.equal(jpeg[1], 216);
    await video.pause(true);
    const sample = await video.markCamera();
    await video.layoutCamera({ ...defaultCameraStyle(), mirror: false, x: 0.2 }, () => true);
    await video.layoutCamera({ ...defaultCameraStyle(), mirror: false, x: 0.3 }, () => true);
    const events = video.cameraLayouts();
    const scene = emptyAnnotationScene(video.video!.width, video.video!.height);
    scene.annotations.push({
      id: 'test-brush',
      tool: 'brush',
      start: { x: 20, y: 20 },
      end: { x: 80, y: 30 },
      points: [
        { x: 20, y: 20 },
        { x: 80, y: 30 },
      ],
      ...defaultAnnotationStyle(),
      text: '',
      number: 1,
    });
    await video.annotate(scene, () => true);
    scene.annotations[0].color = '#2477ee';
    await video.annotate(scene, () => true);
    const pausedAnnotations = video.annotationEvents(0);
    assert.equal(pausedAnnotations.length, 2);
    assert.equal(pausedAnnotations[0].sample, sample);
    assert.equal(pausedAnnotations[1].sample, sample);
    assert.equal(new AnnotationReplay(pausedAnnotations).at(sample)[0].color, '#2477ee');
    assert.deepEqual(
      (await readFile(join(video.directory, 'annotations.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      pausedAnnotations,
    );
    await assert.rejects(
      video.annotate(scene, () => false),
      /结束/,
    );
    assert.equal(video.annotationCount, 2);
    assert.throws(() => video.annotationEvents(-1), /页码/);
    assert.equal(events.at(-1)!.sample, sample);
    assert.equal(events.at(-1)!.style.x, 0.3);
    assert.equal(events.filter((v) => v.sample === sample).length, 1, 'same-frame edits coalesce');
    assert.deepEqual(
      JSON.parse(await readFile(join(video.directory, 'camera-layouts.json'), 'utf8')).layouts,
      events,
    );
    await video.pause(false);
    await delay(300);
    await video.annotate({ ...scene, annotations: [] }, () => true);
    const annotationEvents = video.annotationEvents(0);
    assert.ok(annotationEvents[2].sample > sample);
    assert.deepEqual(new AnnotationReplay(annotationEvents).at(annotationEvents[2].sample), []);
    await video.flushAnnotations();
    const done = await video.finish();
    assert.equal(video.cameraSamples, done.samples);
    const raw = await readFile(video.file + '.camera.mp4');
    await file.create();
    file.append = async () => {
      throw Error('Injected camera seal failure');
    };
    await assert.rejects(
      video.sealCamera(file, () => true),
      /Injected camera/,
    );
    assert.ok(video.retryable);
    assert.deepEqual(await readFile(video.file + '.camera.mp4'), raw);
    await retry.create();
    await video.sealCamera(retry, () => true);
    const exported = join(directory, 'camera-export.mp4');
    await retry.export(exported, () => true);
    assert.deepEqual(await readFile(exported), raw);
    evidence.cameraHost = {
      layouts: events,
      annotations: annotationEvents,
      encryptedSealRetry: 'byte-identical',
      bytes: raw.length,
    };
  } finally {
    await Promise.all([video.dispose(), file.dispose(), retry.dispose()]);
  }
});

test('native input timeline filters repeats, maps cropped pixels, excludes pause and keeps a journal', async () => {
  const video = capture('input', false, 30, 13, 'screen');
  const all = () => video.events.filter((e) => e.kind === 'input').flatMap((e) => e.events);
  await video.ready();
  video.child.stdin.write(
    'fixture-input key 65 1\nfixture-input key 65 0\nfixture-input key 16 1\nfixture-input key 65 1\nfixture-input key 65 0\nfixture-input key 16 0\n',
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(all().length, 0, 'ordinary typing and Shift + letter are not shortcuts');
  video.child.stdin.write(
    'fixture-input key 17 1\nfixture-input key 67 1\nfixture-input key 67 1\nfixture-input key 67 0\nfixture-input key 17 0\nfixture-input move 140 100 0\nfixture-input click 140 100 1\nfixture-input wheel 140 100 -1\nfixture-input move 20 20 0\n',
  );
  await until(() => all().length === 5);
  assert.deepEqual(
    all().map((e) => e.kind),
    ['key', 'move', 'click', 'wheel', 'leave'],
  );
  assert.equal(all()[0].vk, 67);
  assert.equal(all()[0].modifiers, 1);
  assert.deepEqual({ x: all()[2].x, y: all()[2].y }, { x: 40, y: 40 });
  const paused = await video.control('pause', 1),
    before = all().length;
  video.child.stdin.write(
    'fixture-input key 112 1\nfixture-input key 112 0\nfixture-input click 140 100 2\n',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(all().length, before);
  await video.control('resume', 2);
  video.child.stdin.write(
    'fixture-input key 113 1\nfixture-input key 113 0\nfixture-input click 160 120 2\n',
  );
  await until(() => all().length === before + 2);
  await video.stop();
  const events = all(),
    done = video.events.find((e) => e.kind === 'done');
  assert.ok(
    events[before].sample >= paused.samples && events[before].sample < paused.samples + 4800,
  );
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].id, i + 1);
    assert.ok(events[i].sample <= done.samples);
    if (i) assert.ok(events[i].sample >= events[i - 1].sample);
  }
  const journal = (await readFile(video.file + '.input.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(journal, events);
  const off = capture('input-off');
  await off.ready();
  off.child.stdin.write('fixture-input key 112 1\nfixture-input click 140 100 1\n');
  await new Promise((resolve) => setTimeout(resolve, 100));
  await off.stop();
  assert.equal(off.events.filter((e) => e.kind === 'input').length, 0);
  await assert.rejects(stat(off.file + '.input.jsonl'));
  const every = capture('input-all', false, 30, 2);
  await every.ready();
  every.child.stdin.write(
    'fixture-input key 16 1\nfixture-input key 65 1\nfixture-input key 65 0\nfixture-input key 16 0\n',
  );
  await until(
    () => every.events.filter((e) => e.kind === 'input').flatMap((e) => e.events).length === 2,
  );
  await every.stop();
  assert.deepEqual(
    every.events
      .filter((e) => e.kind === 'input')
      .flatMap((e) => e.events)
      .map((e) => [e.vk, e.modifiers]),
    [
      [16, 2],
      [65, 2],
    ],
  );
  evidence.input = {
    events: events.length,
    pauseExcluded: true,
    crop: { x: 40, y: 40 },
    fixture:
      'No global hooks installed; deterministic events use the production filter and timeline.',
  };
});
test('input recording can be enabled, changed while paused, and disabled without restarting video', async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'screen:1:0',
      systemAudio: false,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      videoEncoder: 'software',
      cursor: false,
    },
    { kind: 'monitor', handle: 1, pid: 0, crop: { x: 80, y: 40, width: 480, height: 240 } },
    () => {},
    (exe, args) => {
      child = spawn(exe, ['capture-test', ...args.slice(1)], { windowsHide: true, stdio: 'pipe' });
      children.add(child);
      child.once('close', () => children.delete(child!));
      return child;
    },
  );
  try {
    await video.ready;
    await assert.rejects(stat(video.file + '.input.jsonl'));
    child!.stdin.write('fixture-input key 118 1\nfixture-input key 118 0\n');
    await delay(100);
    assert.equal(video.inputCount, 0);
    const style = { ...defaultInputStyle(), keys: 'shortcuts' as const, clicks: true };
    await video.configureInput(style, () => true);
    child!.stdin.write(
      'fixture-input key 118 1\nfixture-input key 118 0\nfixture-input click 140 100 1\n',
    );
    await until(() => video.inputCount === 2);
    await video.pause(true);
    await video.configureInput({ ...style, keys: 'all' }, () => true);
    child!.stdin.write('fixture-input key 65 1\nfixture-input key 65 0\n');
    await delay(100);
    assert.equal(video.inputCount, 2);
    await video.pause(false);
    child!.stdin.write('fixture-input key 65 1\nfixture-input key 65 0\n');
    await until(() => video.inputCount === 3);
    await video.configureInput(defaultInputStyle(), () => true);
    child!.stdin.write(
      'fixture-input key 119 1\nfixture-input key 119 0\nfixture-input click 140 100 1\n',
    );
    await delay(100);
    assert.equal(video.inputCount, 3);
    await assert.rejects(
      video.configureInput({ ...style, keys: 'invalid' }, () => true),
      /无效/,
    );
    await assert.rejects(
      video.configureInput(style, () => false),
      /结束/,
    );
    await video.finish();
    assert.equal(video.inputStyle.keys, 'off');
    assert.equal(video.recordedInput.keys, 'all');
    assert.equal(video.recordedInput.clicks, true);
    const journal = (await readFile(video.file + '.input.jsonl', 'utf8'))
      .trim()
      .split('\n')
      .map((v) => JSON.parse(v));
    assert.deepEqual(journal, video.inputEvents(0));
    const settings = (await readFile(join(video.directory, 'input-settings.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((v) => JSON.parse(v));
    assert.deepEqual(
      settings.map((v) => v.style.keys),
      ['shortcuts', 'all', 'off'],
    );
    assert.ok(settings.every((v, i) => !i || v.sample >= settings[i - 1].sample));
    evidence.liveInput = {
      changes: settings.length,
      events: journal.length,
      pausedExcluded: true,
      offStopsCapture: true,
    };
  } finally {
    await video.dispose();
  }
});

test('live native region movement changes encoded pixels without resizing or restarting the timeline', async () => {
  let child: ReturnType<typeof spawn> | undefined;
  const progress: any[] = [];
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'screen:1:0',
      systemAudio: true,
      microphone: true,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      videoEncoder: 'software',
      cursor: false,
      input: {
        keys: 'off',
        clicks: true,
        trail: true,
        position: 'bottom-left',
        size: 22,
        color: '#ffffff',
        duration: 1400,
        animation: 1,
      },
    },
    { kind: 'monitor', handle: 1, pid: 0, crop: { x: 0, y: 0, width: 160, height: 120 } },
    (event) => progress.push(event),
    (exe, args) =>
      (child = spawn(exe, ['capture-test', ...args.slice(1)], {
        windowsHide: true,
        stdio: 'pipe',
      })),
  );
  try {
    await video.ready;
    assert.equal(video.movableRegion, true);
    child!.stdin.write('fixture-pattern 0\nfixture-input click 40 40 1\n');
    await until(() => video.inputCount === 1);
    await delay(400);
    const first = await video.moveRegion(480, 200);
    child!.stdin.write('fixture-input click 520 240 1\n');
    await until(() => video.inputEvents(0).filter((e) => e.kind === 'click').length === 2);
    assert.deepEqual(
      video
        .inputEvents(0)
        .filter((e) => e.kind === 'click')
        .map((e) => ({ x: e.x, y: e.y })),
      [
        { x: 40, y: 40 },
        { x: 40, y: 40 },
      ],
    );
    await delay(400);
    await video.pause(true);
    const paused = progress.at(-1).samples;
    const second = await video.moveRegion(0, 0);
    assert.equal(second.sample, paused);
    await delay(150);
    await assert.rejects(video.moveRegion(481, 0), /超出/);
    assert.equal(video.terminal, false);
    await video.pause(false);
    await delay(350);
    const result = await video.finish();
    assert.equal(result.warning, '');
    const decoded = await command(executable, ['inspect', video.file]);
    const audio = await command(join(root, 'dist/native/One.RecordingAudio.exe'), ['inspect', video.file]);
    assert.equal(decoded.width, 160);
    assert.equal(decoded.height, 120);
    assert.equal(decoded.frames, (result.samples / 48000) * 30);
    assert.ok(decoded.red >= 8 && decoded.blue >= 8, JSON.stringify(decoded));
    assert.ok(Math.abs(decoded.duration - audio.duration) < 0.1);
    const journal = (await readFile(join(video.directory, 'regions.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(journal, [
      { sample: 0, crop: { x: 0, y: 0, width: 160, height: 120 } },
      first,
      second,
    ]);
    evidence.regionMovement = {
      decoded,
      audioDuration: audio.duration,
      journal,
      inputCoordinates: 'same local point after crop move',
      outsideRejectedWithoutStop: true,
    };
  } finally {
    await video.dispose();
  }
});
after(async () => {
  for (const child of children) child.kill();
  evidence.status =
    evidence.pause &&
    evidence.dualAudio &&
    evidence.host &&
    evidence.recovery &&
    evidence.cameraClock &&
    evidence.cameraHost &&
    evidence.regionMovement
      ? 'passed'
      : 'failed';
  const target = join(root, 'work/current/capture-migration/recording-video-evidence');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'checks.json'), JSON.stringify(evidence, null, 2));
});
test('D3D11 converts cropped BGRA into H.264 frames; paused intervals do not enter output', async () => {
  const video = capture('pause');
  await video.ready();
  await delay(650);
  const paused = await video.control('pause', 1);
  await delay(600);
  const still = await video.control('pause', 2);
  assert.equal(still.samples, paused.samples);
  await video.control('resume', 3);
  await delay(950);
  const result = await video.stop();
  assert.ok(result, 'native done event');
  assert.equal(result.warning, '');
  const decoded = await command(executable, ['inspect', video.file]);
  assert.equal(decoded.width, 320);
  assert.equal(decoded.height, 160);
  assert.equal(decoded.frames, (result.samples / 48000) * 30);
  assert.ok(decoded.red > 10 && decoded.blue > 5, JSON.stringify(decoded));
  assert.ok(decoded.duration > 1.4 && decoded.duration < 2.05, JSON.stringify(decoded));
  const bytes = await readFile(video.file);
  assert.ok(bytes.includes(Buffer.from('moof')), 'fragmented MP4');
  evidence.pause = { pausedSamples: paused.samples, decoded, bytes: bytes.length };
});
test('native video and both WASAPI-format test sources use the same duration and channel alignment', async () => {
  const video = capture('dual-audio', true, 15);
  await video.ready();
  await delay(1250);
  const result = await video.stop();
  assert.equal(result.warning, '');
  const decoded = await command(executable, ['inspect', video.file]);
  const audio = await command(join(root, 'dist/native/One.RecordingAudio.exe'), ['inspect', video.file]);
  assert.ok(Math.abs(decoded.duration - audio.duration) < 0.1, JSON.stringify({ decoded, audio }));
  assert.ok(audio.tones[0][0] > 0.15 && audio.tones[1][1] > 0.15, JSON.stringify(audio));
  assert.ok(audio.tones[0][1] < 0.03 && audio.tones[1][0] < 0.03, JSON.stringify(audio));
  evidence.dualAudio = { decoded, audio };
  for (const source of ['system', 'microphone']) {
    const path = video.file + '.' + source + '.wav',
      raw = await readFile(path),
      tone = await command(join(root, 'dist/native/One.RecordingAudio.exe'), ['inspect', path]);
    assert.equal(raw.length, 44 + result.samples * 4);
    assert.equal(tone.samples, result.samples);
    assert.ok(tone.tones[source === 'system' ? 0 : 1][source === 'system' ? 0 : 1] > 0.15);
    assert.ok(tone.tones[source === 'system' ? 1 : 0].every((v: number) => v < 0.001));
  }
});
test('native video host retains its finished MP4 across cursor-metadata and encrypted-ingestion failure and exports identical bytes on retry', async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'window:1:0',
      systemAudio: false,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      videoEncoder: 'software',
      videoBitrate: 2000000,
      cursor: true,
    },
    { kind: 'window', handle: 1, pid: 1, crop: { x: 80, y: 40, width: 480, height: 240 } },
    () => {},
    (exe, args) =>
      (child = spawn(exe, ['capture-test', ...args.slice(1)], {
        windowsHide: true,
        stdio: 'pipe',
      })),
  );
  const rejected = new RecordingFile(directory),
    retry = new RecordingFile(directory);
  try {
    await video.ready;
    await delay(350);
    child!.stdin.write('stop 0\n');
    await video.done;
    await writeFile(video.file + '.cursor.jsonl', '{}\n');
    const result = await video.finish();
    assert.match(result.warning, /光标信息未能读取，屏幕视频已保留/);
    assert.equal(video.cursor, undefined);
    assert.equal(
      (await video.finish()).warning,
      result.warning,
      'retry retains the metadata warning',
    );
    assert.equal(video.video!.width, 480);
    assert.equal(video.video!.height, 240);
    assert.ok(video.video!.encoder);
    await rejected.create();
    rejected.append = async () => {
      throw Error('Injected disk write failure');
    };
    await assert.rejects(
      video.seal(rejected, () => true),
      /Injected disk/,
    );
    assert.ok(video.retryable);
    const source = await readFile(video.file);
    assert.equal(source.length, result.bytes);
    await retry.create();
    await video.seal(retry, () => true);
    const exported = join(directory, 'host-export.mp4');
    await retry.export(exported, () => true);
    assert.deepEqual(await readFile(exported), source);
    const decoded = await command(executable, ['inspect', exported]);
    assert.equal(decoded.width, 480);
    assert.equal(decoded.frames, (result.samples / 48000) * 30);
    evidence.host = {
      decoded,
      bytes: source.length,
      sealRetry: 'byte-identical',
      corruptCursorRetainsVideo: true,
    };
  } finally {
    await Promise.all([rejected.dispose(), retry.dispose(), video.dispose()]);
  }
});
test('a killed native video recovers only complete MP4 fragments without changing the interrupted original', async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const video = await NativeVideo.create(
    directory,
    {
      mode: 'video',
      container: 'mp4',
      sourceId: 'window:1:0',
      systemAudio: true,
      microphone: true,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      videoEncoder: 'software',
      camera: { deviceId: 'fixture-camera', style: defaultCameraStyle() },
    },
    { kind: 'window', handle: 1, pid: 1 },
    () => {},
    (exe, args) => {
      child = spawn(exe, ['capture-test', ...args.slice(1)], { windowsHide: true, stdio: 'pipe' });
      return child;
    },
  );
  const file = new RecordingFile(directory),
    cameraFile = new RecordingFile(directory);
  try {
    await video.ready;
    await delay(2800);
    child!.kill();
    await assert.rejects(video.done);
    const original = await readFile(video.file);
    const originalCamera = await readFile(video.file + '.camera.mp4');
    // Simulate a torn final journal write; completed lines remain recoverable.
    await appendFile(video.file + '.cursor.jsonl', '{');
    const recovered = await video.recover(() => true);
    assert.ok(recovered.samples >= 48000);
    assert.ok(recovered.warning.includes('中断'));
    assert.deepEqual(await readFile(video.file), original);
    assert.deepEqual(await readFile(video.file + '.camera.mp4'), originalCamera);
    assert.ok(video.cameraSamples > 0);
    assert.ok(video.cursor && video.cursor.events.length > 0);
    assert.ok(video.cursor.events.every((event) => event.sample <= recovered.samples));
    assert.ok(!recovered.warning.includes('光标轨道未能恢复'));
    await cameraFile.create();
    await video.sealCamera(cameraFile, () => true);
    const cameraOutput = join(directory, 'recovered-camera.mp4');
    await cameraFile.export(cameraOutput, () => true);
    const cameraDecoded = await command(executable, ['inspect', cameraOutput]);
    assert.equal(cameraDecoded.frames, (video.cameraSamples * 30) / 48000);
    await file.create();
    await video.seal(file, () => true);
    const output = join(directory, 'recovered.mp4');
    await file.export(output, () => true);
    assert.deepEqual(
      await readFile(output),
      await readFile(join(video.directory, 'recovered.mp4')),
    );
    const decoded = await command(executable, ['inspect', output]);
    const fragments = await command(executable, [
      'inspect',
      join(video.directory, 'complete-fragments.mp4'),
    ]);
    assert.deepEqual(
      decoded,
      fragments,
      'remux preserves every decodable frame and its timestamps',
    );
    const audio = await command(join(root, 'dist/native/One.RecordingAudio.exe'), ['inspect', output]);
    assert.ok(decoded.frames > 25);
    assert.ok(Math.abs(decoded.duration - audio.duration) < 0.2);
    evidence.recovery = {
      originalBytes: original.length,
      retainedBytes: recovered.bytes,
      decoded,
      audio,
      cameraDecoded,
      cursorEvents: video.cursor.events.length,
    };
  } finally {
    await Promise.all([video.dispose(), file.dispose(), cameraFile.dispose()]);
  }
});
