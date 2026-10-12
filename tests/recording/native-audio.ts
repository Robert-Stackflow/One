import { AudioTestManager } from '../../src/main/recording/audio-test';
import type { AudioTestState } from '../../src/shared/recording/recording';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  open,
  appendFile,
  symlink,
  readdir,
} from 'node:fs/promises';
import { join, basename } from 'node:path';
import { listAudioDrafts, recoverAudioDraft, discardAudioDraft } from '../../src/main/recording/audio-drafts';
import { NativeAudio } from '../../src/main/recording/native-audio';
import { RecordingFile } from '../../src/main/recording/recording-file';
import { audioCapabilities, type AudioProgress } from '../../src/shared/recording/native-audio';
import type { RecordingOptions } from '../../src/shared/recording/recording';
const root = process.env.ONE_RECORDING_TEST_ROOT!,
  directory = process.env.ONE_RECORDING_TEST_DIRECTORY!;
const executable = join(root, 'dist/native/One.RecordingAudio.exe');
const run = async (...args: string[]) => {
  const result = await promisify(execFile)(executable, args, {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, TEMP: directory, TMP: directory },
  });
  return JSON.parse(result.stdout);
};
const evidence: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  scope:
    'Synthetic inputs exercise the real native capture loop and encoders. No system audio or microphone signal is captured or played.',
};
const instances = new Set<NativeAudio>();
const options: RecordingOptions = {
  mode: 'audio',
  container: 'wav',
  sourceId: '',
  systemAudio: true,
  microphone: true,
  microphoneId: '',
  fps: 30,
  maxWidth: 1920,
  audioBitrate: 128000,
};
const fixture = (executable: string, args: string[]) =>
  spawn(executable, ['capture-test', ...args.slice(1)], {
    windowsHide: true,
    stdio: 'pipe',
    env: { ...process.env, TEMP: directory, TMP: directory },
  });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Native audio state timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
after(async () => {
  for (const instance of instances) await instance.dispose();
  const target = join(root, 'work/current/capture-migration/recording-audio-evidence');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'checks.json'), JSON.stringify(evidence, null, 2));
});
test('native mixer aligns QPC samples, clips, silences, rejects overflow and keeps pause duration', async () => {
  const result = await run('self-test');
  assert.equal(result.selfTest, true);
  assert.equal(result.checks, 9);
  evidence.mixer = result;
});
test('actual system codecs encode and decode channel-isolated test tones in WAV and M4A', async (t) => {
  const capabilities = audioCapabilities(await run('devices'));
  evidence.capabilities = {
    systemDevices: capabilities.devices.filter((d) => d.kind === 'system').length,
    microphones: capabilities.devices.filter((d) => d.kind === 'microphone').length,
    bitrates: capabilities.bitrates,
  };
  for (const format of ['wav', 'm4a'])
    await t.test(format, async (t) => {
      if (format === 'm4a' && !capabilities.bitrates.includes(128000)) {
        t.skip('AAC 128 kbps is unavailable on this device');
        return;
      }
      const file = join(directory, 'tones.' + format);
      assert.equal((await run('synthetic', file, format)).samples, 48000);
      const decoded = await run('inspect', file);
      assert.equal(decoded.rate, 48000);
      assert.equal(decoded.channels, 2);
      assert.ok(decoded.duration > 0.95 && decoded.duration < 1.1);
      assert.ok(decoded.samples >= 48000 && decoded.samples < 53000);
      assert.ok(decoded.tones[0][0] > 0.28 && decoded.tones[1][1] > 0.28);
      assert.ok(decoded.tones[0][1] < 0.02 && decoded.tones[1][0] < 0.02);
      if (format === 'wav') assert.equal((await stat(file)).size, 192044);
      evidence[format] = decoded;
    });
});
test('the native capture loop freezes its sample clock while paused and serializes stop after pause', async () => {
  const events: AudioProgress[] = [];
  const audio = await NativeAudio.create(
    directory,
    options,
    (event) => events.push(event),
    fixture,
  );
  instances.add(audio);
  try {
    await audio.ready;
    await until(() => (events.at(-1)?.samples || 0) >= 4800);
    await audio.pause(true);
    await until(() => events.at(-1)?.paused === true);
    const frozen = events.at(-1)!.samples,
      count = events.length;
    await until(() => events.length > count + 1);
    assert.equal(events.at(-1)!.samples, frozen);
    await audio.pause(false);
    await until(() => (events.at(-1)?.samples || 0) >= frozen + 4800);
    const pendingPause = audio.pause(true),
      pendingStop = audio.finish();
    await pendingPause;
    const result = await pendingStop;
    assert.ok(result.samples > frozen);
    assert.ok(result.samples < 48000 * 2);
    assert.equal(result.bytes, result.samples * 4 + 44);
    assert.equal(result.warning, '');
    assert.equal(result.late, 0);
    const decoded = await run('inspect', audio.file);
    assert.equal(decoded.samples, result.samples);
    for (const source of ['system', 'microphone'] as const) {
      const raw = await readFile(audio.file + '.' + source + '.wav'),
        tone = await run('inspect', audio.file + '.' + source + '.wav'),
        sealed = new RecordingFile(directory, 1024 ** 3, 'wav');
      assert.equal(raw.length, 44 + result.samples * 4);
      assert.equal(raw.readUInt32LE(40), result.samples * 4);
      assert.equal(tone.samples, result.samples);
      // The fixture restarts its oscillator when resuming. Measure each continuous
      // interval independently: summing their complex phases can cancel valid audio.
      const channel = source === 'system' ? 0 : 1;
      for (const [start, end] of [[0, frozen], [frozen, result.samples]]) {
        const amplitudes = [440, 880].map((frequency) => {
          let real = 0, imaginary = 0;
          for (let sample = start; sample < end; sample++) {
            const value = raw.readInt16LE(44 + sample * 4 + channel * 2) / 32768;
            const angle = (sample - start) * 2 * Math.PI * frequency / 48000;
            real += value * Math.cos(angle);
            imaginary += value * Math.sin(angle);
          }
          return 2 * Math.hypot(real, imaginary) / (end - start);
        });
        assert.ok(amplitudes[channel] > 0.15, `${source} tone missing in ${start}–${end}`);
        assert.ok(amplitudes[1 - channel] < 0.01, `${source} contains the other source tone`);
      }
      assert.ok(tone.tones[source === 'system' ? 1 : 0].every((v: number) => v < 0.001));
      try {
        await sealed.create();
        await audio.sealAudioSource(source, sealed, () => true);
        const chunks: Buffer[] = [];
        for await (const chunk of sealed.read()) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), raw);
      } finally {
        await sealed.dispose();
      }
    }
    evidence.pause = { ...result, decodedDuration: decoded.duration, frozenSamples: frozen };
  } finally {
    await audio.dispose();
    instances.delete(audio);
  }
});
test('failed encrypted ingestion preserves the native result; a retry exports identical WAV bytes', async () => {
  let samples = 0;
  const audio = await NativeAudio.create(
    directory,
    options,
    (event) => {
      samples = event.samples;
    },
    fixture,
  );
  instances.add(audio);
  const file = new RecordingFile(directory, 1024 ** 3, 'wav');
  try {
    await audio.ready;
    await until(() => samples >= 4800);
    await audio.finish();
    const failed = {
      append: async () => {
        throw Error('Injected disk failure');
      },
      finish: async () => {},
    } as unknown as RecordingFile;
    await assert.rejects(
      audio.seal(failed, () => true),
      /Injected disk failure/,
    );
    assert.equal(audio.retryable, true);
    await file.create();
    await audio.seal(file, () => true);
    const chunks: Buffer[] = [];
    for await (const chunk of file.read()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), await readFile(audio.file));
    assert.notDeepEqual(await readFile(file.path), await readFile(audio.file));
    evidence.encryptedRetry = { passed: true, bytes: file.bytes };
  } finally {
    await file.dispose();
    const a = audio.dispose(),
      b = audio.dispose();
    assert.equal(a, b);
    await a;
    instances.delete(audio);
  }
});

test('independent source gains mute the system channel and serialize with pause and stop', async () => {
  let samples = 0;
  const audio = await NativeAudio.create(
    directory,
    options,
    (event) => {
      samples = event.samples;
    },
    fixture,
  );
  instances.add(audio);
  try {
    await audio.ready;
    await until(() => samples >= 4800);
    await assert.rejects(audio.gain(NaN, 1), /音量/);
    await assert.rejects(audio.gain(1, 2.01), /音量/);
    const mute = audio.gain(0, 1),
      pause = audio.pause(true);
    await Promise.all([mute, pause]);
    await audio.pause(false);
    const start = samples;
    await until(() => samples >= start + 24000);
    await audio.gain(0, 0.5);
    const reducedAt = samples;
    await until(() => samples >= reducedAt + 9600);
    const level = audio.gain(0, 0.5),
      stop = audio.finish();
    await level;
    const result = await stop;
    const data = await readFile(audio.file);
    let left = 0,
      right = 0;
    for (let i = Math.max(44, data.length - 4800 * 4); i + 3 < data.length; i += 4) {
      left = Math.max(left, Math.abs(data.readInt16LE(i)));
      right = Math.max(right, Math.abs(data.readInt16LE(i + 2)));
    }
    assert.equal(left, 0);
    assert.ok(right > 3000 && right <= 4200, `Microphone peak: ${right}`);
    evidence.independentGain = {
      samples: result.samples,
      mutedSystemPeak: left,
      microphonePeak: right,
      concurrentControls: 'passed',
    };
  } finally {
    await audio.dispose();
    instances.delete(audio);
  }
});
test('an exited helper without ready, reordered time or false acknowledgment rejects instead of hanging', async () => {
  const ready = JSON.stringify({ kind: 'ready', rate: 48000, channels: 2 });
  const progress = (samples: number) =>
    JSON.stringify({
      kind: 'progress',
      samples,
      bytes: 44 + samples * 4,
      paused: false,
      system: 0,
      microphone: 0,
      mixed: 0,
      clipped: false,
    });
  for (const script of [
    'process.exit(0)',
    `console.log(${JSON.stringify(ready)}); console.log(${JSON.stringify(progress(4800))}); console.log(${JSON.stringify(progress(1))}); setInterval(()=>{},1000);`,
    `console.log(${JSON.stringify(ready)});require('node:readline').createInterface({input:process.stdin}).on('line',line=>console.log(JSON.stringify({kind:'ack',id:Number(line.split(' ')[1]),paused:false})));`,
  ]) {
    const audio = await NativeAudio.create(
      directory,
      options,
      () => {},
      () => spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: 'pipe' }),
    );
    instances.add(audio);
    try {
      await assert.rejects(async () => {
        await audio.ready;
        if (script.includes("kind:'ack'")) await audio.pause(true);
        else await audio.done;
      });
    } finally {
      await audio.dispose();
      instances.delete(audio);
    }
  }
  evidence.protocolFailures = 'passed';
});

test('a killed WAV or AAC capture recovers complete PCM frames without modifying the source', async (t) => {
  for (const container of ['wav', 'mp4'] as const)
    await t.test(container, async () => {
      let samples = 0,
        child: ReturnType<typeof fixture>;
      const audio = await NativeAudio.create(
        directory,
        { ...options, container },
        (event) => {
          samples = event.samples;
        },
        (executable, args) => (child = fixture(executable, args)),
      );
      instances.add(audio);
      const file = new RecordingFile(directory, 1024 ** 3, 'wav');
      try {
        await audio.ready;
        await until(() => samples >= 4800);
        child!.kill();
        await assert.rejects(audio.done);
        const source = join(audio.directory, container === 'wav' ? 'capture.wav' : 'recovery.wav');
        const handle = await open(source, 'r+');
        try {
          await handle.write(Buffer.alloc(4), 0, 4, 4);
          await handle.write(Buffer.alloc(4), 0, 4, 40);
        } finally {
          await handle.close();
        }
        await appendFile(source, Buffer.from([17, 18, 19]));
        const original = await readFile(source),
          id = basename(audio.directory);
        const drafts = await listAudioDrafts(directory);
        const draft = drafts.find((value) => value.id === id)!;
        assert.ok(draft.samples >= 4800);
        assert.equal(draft.bytes, original.length - 3);
        await file.create();
        const recovered = await recoverAudioDraft(directory, id, file, () => true);
        assert.equal(recovered.samples, draft.samples);
        const chunks: Buffer[] = [];
        for await (const part of file.read()) chunks.push(part);
        const expected = Buffer.from(original.subarray(0, -3));
        expected.writeUInt32LE(expected.length - 8, 4);
        expected.writeUInt32LE(expected.length - 44, 40);
        assert.deepEqual(Buffer.concat(chunks), expected);
        assert.deepEqual(await readFile(source), original);
        const playable = join(directory, 'recovered-' + container + '.wav');
        await writeFile(playable, expected);
        assert.equal((await run('inspect', playable)).samples, draft.samples);
        const canceled = new RecordingFile(directory, 1024 ** 3, 'wav');
        try {
          await canceled.create();
          await assert.rejects(
            recoverAudioDraft(directory, id, canceled, () => false),
            /取消/,
          );
        } finally {
          await canceled.dispose();
        }
        assert.deepEqual(await readFile(source), original);
        evidence['crashRecovery-' + container] = {
          samples: draft.samples,
          partialTailBytesDiscarded: 3,
          sourceUnchanged: true,
          canceledRecoveryRetainsSource: true,
        };
      } finally {
        await file.dispose();
        await audio.dispose();
        instances.delete(audio);
      }
    });
});

test('draft deletion rejects directory traversal and junctions outside its owned root', async () => {
  const outside = join(directory, 'outside'),
    base = join(directory, 'draft-root'),
    id = 'audio-11111111-1111-4111-8111-111111111111';
  await mkdir(outside);
  await mkdir(base);
  await writeFile(join(outside, '.one-audio'), 'One native audio');
  await symlink(outside, join(base, id), 'junction');
  await assert.rejects(discardAudioDraft(base, '../outside'));
  await assert.rejects(discardAudioDraft(base, id), /目录/);
  assert.equal(await readFile(join(outside, '.one-audio'), 'utf8'), 'One native audio');
  assert.deepEqual(await listAudioDrafts(base), []);
  evidence.draftOwnership = 'passed';
});

test('live sound tests sample both channels without files, replace devices and release each helper', async () => {
  const monitorDirectory = join(directory, 'monitor');
  await mkdir(monitorDirectory);
  const states: AudioTestState[] = [],
    children = new Set<ReturnType<typeof spawn>>();
  const manager = new AudioTestManager(
    (state) => states.push(state),
    () => true,
    (file, args) => {
      const child = spawn(file, ['monitor-test', ...args.slice(1)], {
        windowsHide: true,
        stdio: 'pipe',
        cwd: monitorDirectory,
      });
      children.add(child);
      child.once('close', () => children.delete(child));
      return child;
    },
  );
  try {
    await Promise.all([manager.set('system', true, ''), manager.set('microphone', true, '')]);
    await until(() =>
      ['system', 'microphone'].every((channel) =>
        states.some((state) => state.channel === channel && state.level > 0.1),
      ),
    );
    assert.ok(states.every((state) => state.level >= 0 && state.level <= 1));
    await manager.set('system', true, 'second-device');
    assert.equal(
      children.size,
      2,
      'device changes release the previous capture before opening another',
    );
    await manager.set('microphone', false, '');
    assert.equal(children.size, 1, 'channels stop independently');
    await manager.stopAll();
    assert.equal(children.size, 0);
    assert.deepEqual(
      await readdir(monitorDirectory),
      [],
      'sound tests never create recordings or projects',
    );
    const pending = manager.set('system', true, '');
    await manager.stopAll();
    await pending;
    assert.equal(children.size, 0, 'leaving the page cancels queued device requests');
    evidence.liveMeters = {
      channels: 2,
      peak: Math.max(...states.map((state) => state.level)),
      noFiles: true,
      helpersReleased: true,
    };
  } finally {
    await manager.stopAll();
    for (const child of children) child.kill();
  }
});
test('live sound tests reject invalid inputs and blocked or unavailable endpoints', async () => {
  const blocked = new AudioTestManager(
    () => {},
    () => false,
    () => {
      throw Error('must not launch');
    },
  );
  for (const args of [
    ['other', true, ''],
    ['system', 'true', ''],
    ['system', true, 'bad\n'],
  ])
    await assert.rejects(blocked.set(...(args as [unknown, unknown, unknown])), /参数无效/);
  await assert.rejects(blocked.set('system', true, ''), /当前无法测试/);
  const states: AudioTestState[] = [];
  const unavailable = new AudioTestManager(
    (state) => states.push(state),
    () => true,
    (file) =>
      spawn(file, ['inspect', join(directory, 'missing.wav')], {
        windowsHide: true,
        stdio: 'pipe',
      }),
  );
  await assert.rejects(unavailable.set('microphone', true, ''));
  assert.ok(states.some((state) => state.status === 'error' && !!state.message));
  await unavailable.stopAll();
});
