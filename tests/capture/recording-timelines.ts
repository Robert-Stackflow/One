import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import {resolve, join, sep} from 'node:path';
import {RecordingFile} from '../../src/main/recording/recording-file';
import {saveRecordingProject, openRecordingProject} from '../../src/main/recording/recording-project';
import {recordingProject} from '../../src/shared/recording/recording-project';
import {defaultPlayback} from '../../src/shared/recording/recording-playback';
import {defaultCameraStyle} from '../../src/shared/recording/recording-camera';
import {defaultInputStyle} from '../../src/shared/recording/recording-input';

test('One v1 saves and reopens editable camera, cursor, input, annotations and GIF edits together', async () => {
  const root = resolve(process.env.ONE_UNIT_OUTPUT_DIR || 'work/current/capture-migration');
  await mkdir(root, {recursive: true});
  const directory = await mkdtemp(join(root, 'timelines-'));
  const files: RecordingFile[] = [];
  // A bounded synthetic media header tests byte preservation, not video decoding.
  const videoBytes = Buffer.alloc(64);
  videoBytes.writeUInt32BE(24, 0);
  videoBytes.write('ftypisom', 4, 'ascii');
  const bytesFor = async (file: RecordingFile) => {
    const chunks: Buffer[] = [];
    for await (const chunk of file.read()) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  try {
    for (let i = 0; i < 2; i++) {
      const file = new RecordingFile(directory);
      files.push(file);
      await file.create();
      await file.append(0, videoBytes);
      await file.finish();
    }
    const camera = defaultCameraStyle();
    const value = recordingProject({
      format: 'one-recording', version: 1, seconds: 1,
      options: {mode: 'video', container: 'mp4', sourceId: 'screen:0:0',
        systemAudio: false, microphone: false, microphoneId: '', fps: 30, maxWidth: 1920, cursor: true},
      video: {width: 480, height: 240, fps: 30, encoder: 'synthetic'},
      camera: {width: 320, height: 240, fps: 30, encoder: 'synthetic'},
      cameraSeconds: 1, cameraStyle: camera,
      inputStyle: {...defaultInputStyle(), keys: 'all'}, recordedInput: defaultInputStyle(),
      playback: {...defaultPlayback(), speed: 1.5,
        gif: {frames: [{source: 0, delay: 10}, {source: 0.5, delay: 20}], direction: 'pingpong', repeat: 2}},
      inputs: [{id: 1, sample: 120, kind: 'key', vk: 65, modifiers: 2}],
      annotations: [{sample: 0, remove: [], order: ['mark'], upsert: [{
        id: 'mark', tool: 'rectangle', start: {x: 5, y: 5}, end: {x: 80, y: 50},
        points: [], color: '#ff0000', width: 3, text: '', strength: 8, number: 1,
      }]}],
      layouts: [{sample: 0, style: camera}, {sample: 120, style: {...camera, x: 0.3}}],
      cursor: {shapes: [{id: 1, width: 1, height: 1, hotspotX: 0, hotspotY: 0,
        pixels: Buffer.from([255, 0, 0, 255, 0]).toString('base64')}],
        events: [{sample: 0, x: 12, y: 24, shape: 1, scale: 1, segment: 0, click: 1}]},
    });
    const path = join(directory, 'timeline.onerec');
    await saveRecordingProject(path, value, [
      {kind: 'screen', file: files[0]}, {kind: 'camera', file: files[1]},
    ], () => true);
    const reopened = await openRecordingProject(path, directory, () => true);
    files.push(reopened.file, reopened.cameraFile!);
    assert.deepEqual(reopened.project, value);
    assert.deepEqual(await bytesFor(reopened.file), videoBytes);
    assert.deepEqual(await bytesFor(reopened.cameraFile!), videoBytes);
    const edited = recordingProject({...reopened.project, playback: {...reopened.project.playback, speed: 2},
      layouts: [...reopened.project.layouts, {sample: 240, style: {...camera, visible: false}}]});
    const editedPath = join(directory, 'edited.onerec');
    await saveRecordingProject(editedPath, edited, [
      {kind: 'screen', file: reopened.file}, {kind: 'camera', file: reopened.cameraFile!},
    ], () => true);
    const again = await openRecordingProject(editedPath, directory, () => true);
    files.push(again.file, again.cameraFile!);
    assert.deepEqual(again.project, edited);
    assert.deepEqual(await bytesFor(again.file), videoBytes);
  } finally {
    await Promise.all(files.map(file => file.dispose()));
    const actual = await realpath(directory);
    assert.ok(actual.startsWith(root + sep) && actual === directory);
    await rm(actual, {recursive: true, force: true});
  }
});
