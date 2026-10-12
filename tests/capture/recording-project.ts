import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { RecordingFile } from '../../src/main/recording/recording-file';
import {
  saveRecordingProject,
  openRecordingProject,
  recordingProjectPreview,
} from '../../src/main/recording/recording-project';
import { recordingProject, type RecordingProject } from '../../src/shared/recording/recording-project';
import { defaultPlayback } from '../../src/shared/recording/recording-playback';
import './recording-timelines';
import { RECORDING_PROJECT_FORMAT } from '../../src/shared/media-project';

test('One v1 projects preserve the latest editable cursor model and reject unknown versions', () => {
  const project: RecordingProject = {
    format: 'one-recording', version: 1,
    seconds: 1,
    options: {
      mode: 'video',
      container: 'mp4',
      sourceId: 'screen:0:0',
      systemAudio: false,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 1920,
      cursor: true,
    },
    video: { width: 480, height: 240, fps: 30, encoder: 'synthetic' },
    playback: {
      ...defaultPlayback(),
      cursor: { visible: false, size: 2, clicks: true, animation: 1.5, color: '#12ab34' },
    },
    inputs: [],
    annotations: [],
    layouts: [],
    cursor: {
      shapes: [
        {
          id: 1,
          width: 1,
          height: 1,
          hotspotX: 0,
          hotspotY: 0,
          pixels: Buffer.from([255, 0, 0, 128, 0]).toString('base64'),
          animation: [
            { shape: 1, samples: 2400 },
            { shape: 2, samples: 7200 },
            { shape: 1, samples: 4800 },
          ],
        },
        {
          id: 2,
          width: 1,
          height: 1,
          hotspotX: 0,
          hotspotY: 0,
          pixels: Buffer.from([0, 0, 255, 255, 0]).toString('base64'),
        },
      ],
      events: [{ sample: 0, x: 12, y: 24, shape: 1, scale: 0.5, segment: 0, click: 1 }],
    },
  };
  const parsed = recordingProject(project);
  assert.deepEqual(parsed.cursor, project.cursor);
  assert.equal(parsed.playback.cursor!.color, '#12AB34');
  for (const format of [undefined, 'frame-recording', 'one-image'])
    assert.throws(() => recordingProject({...project, format}), /无效/);
  for (const version of [0, 2, 3])
    assert.throws(() => recordingProject({ ...project, version }), /无效/);
  assert.throws(
    () => recordingProject({ ...project, options: { ...project.options, cursor: false } }),
    /光标/,
  );
  assert.throws(
    () =>
      recordingProject({
        ...project,
        cursor: { ...project.cursor, events: [{ ...project.cursor!.events[0], sample: 48001 }] },
      }),
    /光标/,
  );
  assert.throws(
    () =>
      recordingProject({
        ...project,
        cursor: { ...project.cursor, shapes: [{ ...project.cursor!.shapes[0], pixels: 'AAAA' }] },
      }),
    /光标/,
  );
  assert.throws(
    () => recordingProject({ ...project, playback: { ...project.playback, cursor: null } }),
    /光标/,
  );
});

test('recording project persists exact originals and edits; rejects corruption and cancels atomically', async () => {
  const root = resolve(process.env.ONE_UNIT_OUTPUT_DIR || 'work/current/capture-migration');
  await mkdir(root, {recursive: true});
  const directory = await mkdtemp(join(root, 'project-')),
    marker = join(directory, '.one-recording-project-test'),
    path = join(directory, 'result.onerec');
  await writeFile(marker, 'synthetic-only');
  const wave = Buffer.alloc(44 + 960, 0);
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
  wave.writeUInt32LE(wave.length - 44, 40);
  wave.fill(0x19, 44);
  const source = new RecordingFile(directory, undefined, 'wav'),
    stems: RecordingFile[] = [];
  try {
    await source.create();
    await source.append(0, wave);
    await source.finish();
    const value: RecordingProject = {
      format: 'one-recording', version: 1,
      seconds: 0.005,
      options: {
        mode: 'audio',
        container: 'wav',
        sourceId: '',
        systemAudio: true,
        microphone: false,
        microphoneId: '',
        fps: 30,
        maxWidth: 1920,
      },
      playback: { ...defaultPlayback(), speed: 1.5, left: 0.4, right: 1.7 },
      inputs: [],
      annotations: [],
      layouts: [],
    };
    await saveRecordingProject(path, value, [{ kind: 'screen', file: source }], () => true);
    const initial = await readFile(path),
      restored = await openRecordingProject(path, directory, () => true);
    assert.equal(initial.toString('ascii', 0, 8), RECORDING_PROJECT_FORMAT.magic);
    const metadataEnd = 12 + initial.readUInt32LE(8);
    const identity = JSON.parse(initial.toString('utf8', 12, metadataEnd));
    assert.equal(identity.project.format, 'one-recording');
    assert.equal(identity.project.version, 1);
    const rejectedPath = join(directory, 'renamed.onerec');
    for (const magic of ['FRAMEREC', 'ONEIMAGE']) {
      const rejected = Buffer.from(initial);
      rejected.write(magic, 0, 'ascii');
      await writeFile(rejectedPath, rejected);
      await assert.rejects(openRecordingProject(rejectedPath, directory, () => true), /不是受支持/);
    }
    for (const patch of [{format: undefined}, {format: 'frame-recording'}, {version: 2}, {version: 3}]) {
      const metadata = Buffer.from(JSON.stringify({
        ...identity, project: {...identity.project, ...patch},
      }));
      const header = Buffer.from(initial.subarray(0, 12));
      header.writeUInt32LE(metadata.length, 8);
      await writeFile(rejectedPath, Buffer.concat([header, metadata, initial.subarray(metadataEnd)]));
      await assert.rejects(openRecordingProject(rejectedPath, directory, () => true), /无效/);
    }
    assert.equal(
      (await recordingProjectPreview(path, new Request('https://fixture/'))).status,
      404,
    );
    const previewPath = join(directory, 'poster.onerec');
    await saveRecordingProject(
      previewPath,
      {
        ...value,
        options: { ...value.options, mode: 'video', container: 'mp4', sourceId: 'screen:0:0' },
        video: { width: 480, height: 240, fps: 30, encoder: 'synthetic' },
      },
      [{ kind: 'screen', file: source }],
      () => true,
    );
    const range = await recordingProjectPreview(
      previewPath,
      new Request('https://fixture/', {
        headers: { Range: 'bytes=4-19' },
      }),
    );
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('Content-Range'), `bytes 4-19/${wave.length}`);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      wave.subarray(4, 20),
      'preview excludes the project manifest',
    );
    const head = await recordingProjectPreview(
      previewPath,
      new Request('https://fixture/', { method: 'HEAD' }),
    );
    assert.equal(head.headers.get('Content-Length'), String(wave.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(
      (
        await recordingProjectPreview(
          previewPath,
          new Request('https://fixture/', {
            headers: { Range: 'bytes=999999-' },
          }),
        )
      ).status,
      416,
    );
    assert.deepEqual(restored.project, recordingProject(value));
    assert.equal(restored.cameraFile, undefined);
    const chunks: Buffer[] = [];
    for await (const data of restored.file.read()) chunks.push(data);
    assert.deepEqual(Buffer.concat(chunks), wave);
    await restored.file.dispose();
    let calls = 0;
    await assert.rejects(
      saveRecordingProject(path, value, [{ kind: 'screen', file: source }], () => ++calls < 3),
      /取消/,
    );
    assert.deepEqual(
      await readFile(path),
      initial,
      'cancelled overwrite preserves the existing project',
    );
    const bad = Buffer.from(initial);
    bad[bad.length - 1] ^= 1;
    await writeFile(join(directory, 'corrupt.onerec'), bad);
    await assert.rejects(
      openRecordingProject(join(directory, 'corrupt.onerec'), directory, () => true),
      /校验/,
    );
    await writeFile(join(directory, 'extra.onerec'), Buffer.concat([initial, Buffer.from([0])]));
    await assert.rejects(
      openRecordingProject(join(directory, 'extra.onerec'), directory, () => true),
      /多余数据/,
    );
    calls = 0;
    await assert.rejects(
      openRecordingProject(path, directory, () => ++calls < 3),
      /取消/,
    );
    assert.equal(
      (await readdir(directory)).filter((v) => v.endsWith('.sealed')).length,
      1,
      'partial imports are cleaned',
    );
    assert.equal(
      (await readdir(directory)).some((v) => v.endsWith('.part')),
      false,
      'failed saves leave no stage',
    );
    assert.throws(() => recordingProject({ ...value, version: 99 }), /无效/);
    const withSources: RecordingProject = {
      ...value,
      version: 1,
      sources: ['system', 'microphone'],
      options: { ...value.options, microphone: true },
      playback: { ...value.playback, system: 0, microphone: 1.4 },
    };
    for (const byte of [0x12, 0x34]) {
      const file = new RecordingFile(directory, undefined, 'wav'),
        data = Buffer.from(wave);
      stems.push(file);
      data.fill(byte, 44);
      await file.create();
      await file.append(0, data);
      await file.finish();
    }
    const stemPath = join(directory, 'sources.onerec');
    await saveRecordingProject(
      stemPath,
      withSources,
      [
        { kind: 'screen', file: source },
        { kind: 'system', file: stems[0] },
        { kind: 'microphone', file: stems[1] },
      ],
      () => true,
    );
    const restoredSources = await openRecordingProject(stemPath, directory, () => true);
    try {
      assert.deepEqual(restoredSources.project, recordingProject(withSources));
      for (const [i, name] of (['system', 'microphone'] as const).entries()) {
        const chunks: Buffer[] = [];
        for await (const chunk of restoredSources.audioFiles[name]!.read()) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks)[44], i ? 0x34 : 0x12);
      }
    } finally {
      await Promise.all([
        restoredSources.file.dispose(),
        ...Object.values(restoredSources.audioFiles).map((f) => f.dispose()),
      ]);
    }
    const sourceContainer = await readFile(stemPath),
      metadataLength = sourceContainer.readUInt32LE(8),
      manifest = JSON.parse(sourceContainer.subarray(12, 12 + metadataLength).toString('utf8')),
      stemOffset = 12 + metadataLength + manifest.assets[0].bytes;
    sourceContainer.writeUInt32LE(44100, stemOffset + 24);
    manifest.assets[1].sha256 = createHash('sha256')
      .update(sourceContainer.subarray(stemOffset, stemOffset + manifest.assets[1].bytes))
      .digest('hex');
    const metadata = Buffer.from(JSON.stringify(manifest));
    assert.equal(metadata.length, metadataLength);
    metadata.copy(sourceContainer, 12);
    const wrongRate = join(directory, 'wrong-rate.onerec');
    await writeFile(wrongRate, sourceContainer);
    await assert.rejects(
      openRecordingProject(wrongRate, directory, () => true),
      /格式/,
    );
    await assert.rejects(
      saveRecordingProject(
        stemPath,
        { ...withSources, seconds: 0.01 },
        [
          { kind: 'screen', file: source },
          { kind: 'system', file: stems[0] },
          { kind: 'microphone', file: stems[1] },
        ],
        () => true,
      ),
      /时长/,
    );
    assert.throws(() => recordingProject({ ...withSources, playback: {...withSources.playback, system: undefined} }), /播放设置/);
    assert.throws(
      () => recordingProject({ ...withSources, sources: ['system', 'system'] }),
      /声源/,
    );
    assert.throws(
      () => recordingProject({ ...withSources, playback: { ...withSources.playback, system: 3 } }),
      /播放设置/,
    );
    assert.throws(
      () =>
        recordingProject({
          ...value,
          inputs: [{ id: 1, sample: 0, kind: 'key', vk: 65, modifiers: 0 }],
        }),
      /键鼠/,
    );
    assert.throws(
      () => recordingProject({ ...value, playback: { ...value.playback, speed: 99 } }),
      /无效/,
    );
  } finally {
    await source.dispose();
    await Promise.all(stems.map((file) => file.dispose()));
    const actual = await realpath(directory);
    if (!actual.startsWith(root + sep) || (await readFile(marker, 'utf8')) !== 'synthetic-only')
      throw Error('Unsafe project fixture cleanup');
    await rm(actual, { recursive: true, force: true });
  }
});
