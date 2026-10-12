import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingOptions, type RecordingOptions } from '../../src/shared/recording/recording';
import { defaultCameraStyle } from '../../src/shared/recording/recording-camera';
import { defaultInputStyle } from '../../src/shared/recording/recording-input';
const camera: RecordingOptions = {
  mode: 'video',
  container: 'mp4',
  videoSource: 'camera',
  sourceId: '',
  camera: { deviceId: 'fixture-camera', style: defaultCameraStyle() },
  systemAudio: false,
  microphone: false,
  microphoneId: '',
  cursor: false,
  fps: 30,
  maxWidth: 1920,
};
test('standalone camera requires an explicit device and excludes desktop capture and input', () => {
  assert.deepEqual(recordingOptions(camera), camera);
  for (const change of [
    { camera: undefined },
    { sourceId: 'screen:1:0' },
    { regionToken: 'old-selection' },
    { input: defaultInputStyle() },
    { cursor: true },
    { cursor: undefined },
    { container: 'webm' },
    { mode: 'audio' },
    { videoSource: 'screen' },
    { camera: { deviceId: 'none', style: defaultCameraStyle() } },
  ])
    assert.throws(() => recordingOptions({ ...camera, ...change }));
  const legacy = { ...camera, videoSource: undefined, sourceId: 'screen:1:0' };
  assert.equal(recordingOptions(legacy).sourceId, 'screen:1:0');
});
