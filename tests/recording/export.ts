import test, { after } from 'node:test';
import { RECORDING_PROJECT_FORMAT } from '../../src/shared/media-project';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir, stat, mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  markExportScratch,
  cleanExportScratchDirectory,
  cleanInterruptedExports,
} from '../../src/main/recording/recording-export-cleanup';
import { join, dirname } from 'node:path';
import { resolveVideoProbe } from '../../src/main/recording/recording-import';
import {
  RecordingEncoder,
  resolveRecordingEncoder,
  checkRecordingEncoder,
} from '../../src/main/recording/recording-encoder';
import {
  recordingExportPlan,
  exportAudioFilters,
  type RecordingExportFormat,
  type RecordingExportQuality,
} from '../../src/shared/recording/recording-export';
import { defaultPlayback } from '../../src/shared/recording/recording-playback';
import type { RecordingProject } from '../../src/shared/recording/recording-project';
const directory = process.env.ONE_RECORDING_TEST_DIRECTORY!,
  run = promisify(execFile),
  executable = await resolveRecordingEncoder(join(directory, 'none'));
const project: RecordingProject = {
  format: RECORDING_PROJECT_FORMAT.id,
  version: 1,
  seconds: 0.4,
  options: {
    mode: 'video',
    container: 'mp4',
    sourceId: 'screen:0:0',
    systemAudio: false,
    microphone: false,
    microphoneId: '',
    fps: 30,
    maxWidth: 1920,
  },
  video: { width: 64, height: 48, fps: 30, encoder: 'fixture' },
  playback: defaultPlayback(),
  inputs: [],
  annotations: [],
  layouts: [],
};
const progress: Record<string, unknown> = {
  status: 'incomplete',
  checkedAt: new Date().toISOString(),
  scope:
    'Synthetic raw frames and generated PCM only; real FFmpeg encoders, file transaction and process cleanup.',
};
function rgba(width: number, height: number, index: number) {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    bytes[i * 4] = index % 2 ? 20 : 220;
    bytes[i * 4 + 1] = 50;
    bytes[i * 4 + 2] = index % 2 ? 220 : 20;
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}
test('export presets preserve source originals and apply explicit resolution, FPS and compression', () => {
  const large = {
      ...project,
      video: { ...project.video!, width: 2560, height: 1440, fps: 60 as const },
    },
    light = recordingExportPlan(large, { format: 'mp4', quality: 'light' }),
    standard = recordingExportPlan(large, { format: 'mp4', quality: 'standard' }),
    original = recordingExportPlan(large, { format: 'mp4', quality: 'original' });
  assert.deepEqual(
    [light.width, light.height, light.fps, light.crf, light.audioBitrate],
    [960, 540, 15, 30, 96000],
  );
  assert.deepEqual(
    [standard.width, standard.height, standard.fps, standard.crf],
    [1920, 1080, 30, 23],
  );
  assert.deepEqual(
    [original.width, original.height, original.fps, original.webpQuality, original.colors],
    [2560, 1440, 60, 100, 256],
  );
  const fast = recordingExportPlan(
    { ...project, playback: { ...project.playback, speed: 4 } },
    { format: 'webp', quality: 'original' },
  );
  assert.equal(fast.frames, 3);
  assert.equal(fast.seconds, 0.1);
  assert.equal(fast.fps, 30);
  assert.throws(() => recordingExportPlan(project, { format: 'png', quality: 'standard' }), /格式/);
  for (const speed of [0.25, 0.5, 1, 2, 4]) {
    const mix = exportAudioFilters(
      { ...project.playback, speed, left: 0.25, right: 1.5, system: 0, microphone: 2 },
      [
        { kind: 'system', input: 1 },
        { kind: 'microphone', input: 2 },
      ],
    );
    assert.ok(mix.filter.includes('volume=0[source0]'));
    assert.ok(mix.filter.includes('volume=2[source1]'));
    assert.ok(mix.filter.includes('normalize=0'));
    assert.ok(mix.filter.includes('c0=0.25*c0|c1=1.5*c1'));
    assert.equal(
      (mix.filter.match(/atempo=([\d.]+)/g) || []).reduce(
        (product, part) => product * Number(part.slice(7)),
        1,
      ),
      speed,
    );
  }
  progress.presets = true;
});
test('all three formats and quality tiers encode complete real files from sequential bounded frames', async () => {
  const results = [];
  for (const format of ['gif', 'webp', 'mp4'] as RecordingExportFormat[]) {
    await checkRecordingEncoder(executable, format);
    for (const quality of ['light', 'standard', 'original'] as RecordingExportQuality[]) {
      const plan = recordingExportPlan(project, { format, quality }),
        path = join(directory, quality + '.' + format),
        encoder = await RecordingEncoder.create(executable, plan, path, project.playback, []);
      try {
        for (let i = 0; i < plan.frames; i++)
          await encoder.frame(i, rgba(plan.width, plan.height, i));
        await encoder.finish();
        const bytes = await readFile(path);
        assert.ok(bytes.length > 30);
        if (format === 'webp') {
          assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
          assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
          const frames = [];
          let offset = 12;
          while (offset + 8 <= bytes.length) {
            const size = bytes.readUInt32LE(offset + 4);
            if (bytes.toString('ascii', offset, offset + 4) === 'ANMF')
              frames.push(bytes.readUIntLE(offset + 20, 3));
            offset += 8 + size + (size % 2);
          }
          assert.equal(frames.length, plan.frames);
          assert.ok(Math.abs(frames.reduce((sum, n) => sum + n, 0) - 400) <= 1);
        } else {
          const { stdout } = await run(
            join(dirname(executable), 'ffprobe.exe'),
            [
              '-v',
              'error',
              '-count_frames',
              '-show_entries',
              'stream=width,height,nb_read_frames',
              '-of',
              'json',
              path,
            ],
            { windowsHide: true, maxBuffer: 65536 },
          );
          const stream = JSON.parse(stdout).streams[0];
          assert.equal(stream.width, plan.width);
          assert.equal(stream.height, plan.height);
          assert.equal(Number(stream.nb_read_frames), plan.frames);
          const { stdout: pixels } = await run(
            executable,
            [
              '-v',
              'error',
              '-i',
              path,
              '-frames:v',
              '1',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgba',
              'pipe:1',
            ],
            { windowsHide: true, maxBuffer: 256 * 1024, encoding: 'buffer' },
          );
          assert.ok(
            pixels[0] > 180 && pixels[1] < 80 && pixels[2] < 70,
            format + ' preserves frame colors',
          );
        }
        results.push({ format, quality, frames: plan.frames, bytes: bytes.length });
      } finally {
        await encoder.cancel();
      }
    }
  }
  progress.formats = results;
});
test('edited GIF encoder writes exact variable delays, loop metadata and independently decodable frames', async () => {
  const probe = await resolveVideoProbe(join(process.env.ONE_RECORDING_TEST_ROOT!, 'dist/native'));
  const cases = [];
  for (const repeat of [-1, 0, 3]) {
    const edit = {
      frames: [
        { source: 0, delay: 2 },
        { source: 0.3, delay: 17 },
        { source: 0.1, delay: 6000 },
      ],
      direction: 'forward' as const,
      repeat,
    };
    const plan = recordingExportPlan(
      { ...project, playback: { ...project.playback, gif: edit } },
      { format: 'gif', quality: 'original' },
    );
    const path = join(directory, `edited-${repeat}.gif`),
      encoder = await RecordingEncoder.create('', plan, path, project.playback, []);
    try {
      for (let i = 0; i < plan.frames; i++)
        await encoder.frame(i, rgba(plan.width, plan.height, i));
      await encoder.finish();
      const bytes = await readFile(path);
      assert.equal(bytes.toString('ascii', 0, 6), 'GIF89a');
      assert.equal(bytes.at(-1), 0x3b);
      const loop = bytes.indexOf(Buffer.from('NETSCAPE2.0'));
      if (repeat < 0) assert.equal(loop, -1);
      else {
        assert.ok(loop > 0);
        assert.equal(bytes.readUInt16LE(loop + 13), repeat);
      }
      const { stdout } = await run(
        probe,
        [
          '-v',
          'error',
          '-show_frames',
          '-show_entries',
          'frame=width,height,duration_time,pkt_duration_time',
          '-of',
          'json',
          path,
        ],
        { windowsHide: true, maxBuffer: 65536 },
      );
      const frames = JSON.parse(stdout).frames;
      assert.deepEqual(
        frames.map((f: any) => Math.round(Number(f.duration_time ?? f.pkt_duration_time) * 100)),
        [2, 17, 6000],
      );
      assert.ok(frames.every((f: any) => f.width === 64 && f.height === 48));
      assert.equal(encoder.bytes, bytes.length);
      cases.push({ repeat, frames: frames.length, bytes: bytes.length });
    } finally {
      await encoder.cancel();
    }
  }
  progress.editedGif = cases;
});
test('edited GIF cancellation, invalid frames and destination races preserve existing files', async () => {
  const path = join(directory, 'protected.gif');
  const plan = recordingExportPlan(
    {
      ...project,
      playback: {
        ...project.playback,
        gif: { frames: [{ source: 0, delay: 10 }], direction: 'forward', repeat: -1 },
      },
    },
    { format: 'gif', quality: 'standard' },
  );
  await writeFile(path, 'original');
  const cancelled = await RecordingEncoder.create('', plan, path, project.playback, []);
  await assert.rejects(cancelled.frame(1, rgba(64, 48, 0)), /顺序/);
  await assert.rejects(cancelled.frame(0, new Uint8Array(1)), /尺寸/);
  const rejected = assert.rejects(
    cancelled.frame(0, rgba(64, 48, 0)).then(() => {
      throw Error('合成导出已取消');
    }),
    /中断|取消/,
  );
  await cancelled.cancel();
  await rejected;
  assert.equal(await readFile(path, 'utf8'), 'original');
  await assert.rejects(stat(cancelled.stage), /ENOENT/);
  const changed = await RecordingEncoder.create('', plan, path, project.playback, []);
  try {
    await changed.frame(0, rgba(64, 48, 0));
    await writeFile(path, 'user replacement');
    await assert.rejects(changed.finish(), /发生变化/);
    assert.equal(await readFile(path, 'utf8'), 'user replacement');
    await assert.rejects(stat(changed.stage), /ENOENT/);
  } finally {
    await changed.cancel();
  }
  const single = await RecordingEncoder.create(
    '',
    plan,
    join(directory, 'single.gif'),
    project.playback,
    [],
  );
  try {
    await single.frame(0, rgba(64, 48, 0));
    await single.finish();
  } finally {
    await single.cancel();
  }
  const data = await readFile(join(directory, 'single.gif'));
  assert.equal(data.at(-1), 0x3b);
  assert.equal(data.indexOf(Buffer.from('NETSCAPE2.0')), -1);
  progress.editedGifTransactions = true;
});
test('GIF identical-frame optimization preserves exact duration, including 16-bit delay overflow', async () => {
  const probe = await resolveVideoProbe(join(process.env.ONE_RECORDING_TEST_ROOT!, 'dist/native'));
  const sizes: number[] = [];
  for (const [optimize, delay, speed, expected] of [
    [false, 10, 1, [10, 10, 10]],
    [true, 10, 1, [30]],
    [true, 6000, 0.25, [48000, 24000]],
  ] as const) {
    const gif = {
      direction: 'forward' as const,
      repeat: 0,
      frames: [0, 0.1, 0.2].map((source) => ({ source, delay })),
      output: { colors: 16 as const, optimize },
    };
    const plan = recordingExportPlan(
      { ...project, playback: { ...project.playback, speed, gif } },
      { format: 'gif', quality: 'original' },
    );
    const path = join(directory, `optimized-${optimize}-${delay}.gif`),
      encoder = await RecordingEncoder.create('', plan, path, project.playback, []);
    try {
      for (let i = 0; i < plan.frames; i++)
        await encoder.frame(i, rgba(plan.width, plan.height, 0));
      await encoder.finish();
      const data = await readFile(path);
      sizes.push(data.length);
      const { stdout } = await run(
        probe,
        [
          '-v',
          'error',
          '-show_frames',
          '-show_entries',
          'frame=duration_time,pkt_duration_time',
          '-of',
          'json',
          path,
        ],
        { windowsHide: true, maxBuffer: 65536 },
      );
      assert.deepEqual(
        JSON.parse(stdout).frames.map((f: any) =>
          Math.round(Number(f.duration_time ?? f.pkt_duration_time) * 100),
        ),
        expected,
      );
    } finally {
      await encoder.cancel();
    }
  }
  assert.ok(sizes[1] < sizes[0]);
  progress.optimizedGif = { sizes, exactDurations: true };
});
test('GIF preview capacity and cancellation clear pending optimized frames without replacing files', async () => {
  const gif = {
    direction: 'forward' as const,
    repeat: 0,
    frames: [{ source: 0, delay: 10 }],
    output: { colors: 16 as const, optimize: true },
  };
  const plan = recordingExportPlan(
    { ...project, playback: { ...project.playback, gif } },
    { format: 'gif', quality: 'standard' },
  );
  const path = join(directory, 'preview-limit.gif');
  await writeFile(path, 'existing');
  const encoder = await RecordingEncoder.create(
    '',
    plan,
    path,
    project.playback,
    [],
    undefined,
    undefined,
    undefined,
    32,
  );
  try {
    await assert.rejects(encoder.frame(0, rgba(plan.width, plan.height, 0)), /容量/);
  } finally {
    await encoder.cancel();
  }
  assert.equal(await readFile(path, 'utf8'), 'existing');
  await assert.rejects(stat(encoder.stage), /ENOENT/);
  const pendingPlan = {
    ...plan,
    frames: 2,
    seconds: 0.2,
    timeline: [...plan.timeline!, ...plan.timeline!],
  };
  const pending = await RecordingEncoder.create('', pendingPlan, path, project.playback, []);
  await pending.frame(0, rgba(plan.width, plan.height, 0));
  await pending.cancel();
  await assert.rejects(stat(pending.stage), /ENOENT/);
  assert.equal(await readFile(path, 'utf8'), 'existing');
  progress.previewQuota = true;
});
test('a completely still recording retains a WebP animation duration without changing pixels', async () => {
  const plan = recordingExportPlan(project, { format: 'webp', quality: 'standard' }),
    path = join(directory, 'still.webp'),
    encoder = await RecordingEncoder.create(executable, plan, path, project.playback, []);
  try {
    for (let i = 0; i < plan.frames; i++) await encoder.frame(i, rgba(plan.width, plan.height, 0));
    await encoder.finish();
  } finally {
    await encoder.cancel();
  }
  const bytes = await readFile(path),
    offset = bytes.indexOf(Buffer.from('ANMF'));
  assert.ok(offset >= 0);
  assert.equal(bytes.readUIntLE(offset + 20, 3), 400);
  assert.equal(bytes.toString('ascii', 30, 34), 'ANIM');
  progress.stillWebp = { animated: true, durationMs: 400 };
});
test('cancellation, rejected frames and changed destinations never replace an existing target; retry succeeds', async () => {
  const path = join(directory, 'keep.mp4'),
    original = Buffer.from('existing user output'),
    plan = recordingExportPlan(project, { format: 'mp4', quality: 'standard' });
  await writeFile(path, original);
  const cancelled = await RecordingEncoder.create(executable, plan, path, project.playback, []);
  await assert.rejects(cancelled.frame(1, rgba(plan.width, plan.height, 0)), /顺序/);
  await assert.rejects(cancelled.frame(0, new Uint8Array(1)), /尺寸/);
  await cancelled.frame(0, rgba(plan.width, plan.height, 0));
  await cancelled.cancel();
  assert.deepEqual(await readFile(path), original);
  await assert.rejects(stat(cancelled.stage), /ENOENT/);
  const changed = await RecordingEncoder.create(executable, plan, path, project.playback, []);
  try {
    for (let i = 0; i < plan.frames; i++) await changed.frame(i, rgba(plan.width, plan.height, i));
    await writeFile(path, 'changed by user while exporting');
    await assert.rejects(changed.finish(), /发生变化/);
    assert.equal(await readFile(path, 'utf8'), 'changed by user while exporting');
  } finally {
    await changed.cancel();
  }
  const retry = await RecordingEncoder.create(executable, plan, path, project.playback, []);
  try {
    for (let i = 0; i < plan.frames; i++) await retry.frame(i, rgba(plan.width, plan.height, i));
    await retry.finish();
  } finally {
    await retry.cancel();
  }
  assert.equal((await readFile(path)).toString('ascii', 4, 8), 'ftyp');
  assert.equal(
    (await readdir(directory)).filter((name) => name.startsWith('.One-compose-')).length,
    0,
  );
  progress.transactions = {
    cancelPreservesTarget: true,
    rejectedFrames: true,
    concurrentTargetChange: true,
    retry: true,
    noStages: true,
  };
});
test('interrupted export cleanup removes only owned unpublished output and decrypted scratch', async () => {
  const id = randomUUID(),
    scratch = await mkdtemp(join(directory, 'compose-')),
    target = join(directory, 'published.mp4'),
    stage = join(directory, '.One-compose-' + id + '.part');
  await markExportScratch(scratch, id, target);
  await writeFile(join(scratch, 'system.wav'), 'private temporary PCM');
  await writeFile(stage, 'unpublished partial');
  await writeFile(target, 'published user file');
  const foreign = await mkdtemp(join(directory, 'compose-'));
  await writeFile(
    join(foreign, '.one-compose'),
    JSON.stringify({ version: 1, id, stage: target }),
  );
  await cleanInterruptedExports(directory);
  await assert.rejects(stat(scratch), /ENOENT/);
  await assert.rejects(stat(stage), /ENOENT/);
  assert.equal(await readFile(target, 'utf8'), 'published user file');
  assert.ok((await stat(foreign)).isDirectory());
  assert.equal(
    await cleanExportScratchDirectory(directory, directory, id),
    false,
    'never remove the root',
  );
  progress.crashCleanup = {
    ownedStage: true,
    privateInputs: true,
    publishedTargetPreserved: true,
    foreignMarkerPreserved: true,
  };
});
test('MP4 mixes independent stems before channel gains and applies pitch-preserving playback speed', async () => {
  const samples = 19200,
    wave = Buffer.alloc(44 + samples * 4);
  wave.write('RIFF');
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(2, 22);
  wave.writeUInt32LE(48000, 24);
  wave.writeUInt32LE(192000, 28);
  wave.writeUInt16LE(4, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++)
    for (let channel = 0; channel < 2; channel++)
      wave.writeInt16LE(
        Math.round(Math.sin((i * Math.PI * 2 * 1000) / 48000) * 6000),
        44 + i * 4 + channel * 2,
      );
  const system = join(directory, 'system.wav'),
    microphone = join(directory, 'microphone.wav');
  await writeFile(system, wave);
  await writeFile(microphone, wave);
  const edited = {
      ...project,
      playback: { ...project.playback, speed: 2, system: 0, microphone: 1, left: 0, right: 0.5 },
    },
    plan = recordingExportPlan(edited, { format: 'mp4', quality: 'original' }),
    path = join(directory, 'mixed.mp4');
  const encoder = await RecordingEncoder.create(executable, plan, path, edited.playback, [
    { kind: 'system', path: system },
    { kind: 'microphone', path: microphone },
  ]);
  try {
    for (let i = 0; i < plan.frames; i++) await encoder.frame(i, rgba(plan.width, plan.height, i));
    await encoder.finish();
  } finally {
    await encoder.cancel();
  }
  const { stdout: pcm } = await run(
    executable,
    ['-v', 'error', '-i', path, '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { windowsHide: true, maxBuffer: 128 * 1024, encoding: 'buffer' },
  );
  let left = 0,
    right = 0,
    crossings = 0,
    previous = 0;
  const count = Math.min(8000, pcm.length / 4);
  for (let i = 1000; i < count; i++) {
    const l = pcm.readInt16LE(i * 4),
      r = pcm.readInt16LE(i * 4 + 2);
    left += l * l;
    right += r * r;
    if (previous < 0 && r >= 0) crossings++;
    previous = r;
  }
  assert.ok(right > 1000000);
  assert.ok(left < right * 0.001, 'left channel mute is baked into output');
  const frequency = crossings / ((count - 1000) / 48000);
  assert.ok(frequency > 900 && frequency < 1100, '2x tempo retains the 1 kHz pitch');
  progress.audio = { leftMuted: true, independentSystemMute: true, speed: 2, frequency };
});
after(async () => {
  progress.status =
    progress.presets &&
    progress.formats &&
    progress.stillWebp &&
    progress.transactions &&
    progress.audio &&
    progress.crashCleanup &&
    progress.editedGif &&
    progress.editedGifTransactions &&
    progress.optimizedGif &&
    progress.previewQuota
      ? 'passed'
      : 'incomplete';
  const target = process.env.ONE_RECORDING_TEST_ROOT!;
  await writeFile(
    join(target, 'work/current/capture-migration/recording-codec-evidence.json'),
    JSON.stringify(progress, null, 2),
  );
});
