import test from 'node:test';
import { RECORDING_PROJECT_FORMAT } from '../../src/shared/media-project';
import assert from 'node:assert/strict';
import { importedVideoMetadata } from '../../src/shared/recording/recording-import';
import { recordingProject } from '../../src/shared/recording/recording-project';
import { videoReady } from '../../src/shared/recording/native-video';
import { defaultPlayback } from '../../src/shared/recording/recording-playback';
import {
  recordingExportOptions,
  recordingExportPlan,
  exportAudioFilters,
} from '../../src/shared/recording/recording-export';
const stream = {
  codec_type: 'video',
  codec_name: 'h264',
  width: 321,
  height: 181,
  avg_frame_rate: '24000/1001',
  duration: '2.002',
};
const metadata = (
  s = stream,
  format = { duration: '2.002', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
) =>
  JSON.stringify({
    streams: [
      { codec_type: 'video', disposition: { attached_pic: 1 } },
      s,
      { codec_type: 'audio' },
    ],
    format,
  });
const info = importedVideoMetadata(metadata(), 'mp4');
const project = () =>
  recordingProject({
    format: RECORDING_PROJECT_FORMAT.id,
    version: 1,
    origin: 'video',
    seconds: info.seconds,
    video: info.video,
    options: {
      mode: 'video',
      sourceId: 'screen:0:0',
      container: 'mp4',
      systemAudio: true,
      microphone: false,
      microphoneId: '',
      fps: 30,
      maxWidth: 2560,
      cursor: false,
    },
    playback: defaultPlayback(),
    inputs: [],
    annotations: [],
    layouts: [],
  });
test('import metadata and project preserve odd sizes, fractional cadence, audio and original origin', () => {
  assert.equal(info.video.fps, 24000 / 1001);
  assert.equal(info.video.width, 321);
  assert.equal(info.audio, true);
  assert.deepEqual(recordingProject(project()), project());
  assert.throws(() => videoReady(info.video)); // Native capture still has its stricter contract.
  const original = recordingExportPlan(project(), { format: 'gif', quality: 'original' });
  assert.equal(original.width, 321);
  assert.equal(original.height, 181);
  assert.equal(original.fps, 24000 / 1001);
});
test('metadata uses video duration, skips cover art, and handles WebM rates and rotated dimensions', () => {
  const webm = importedVideoMetadata(
    metadata(
      {
        ...stream,
        codec_name: 'vp9',
        duration: 'N/A',
        avg_frame_rate: '0/0',
        r_frame_rate: '25/1',
      } as typeof stream,
      { duration: '1.5', format_name: 'matroska,webm' },
    ),
    'webm',
  );
  assert.equal(webm.seconds, 1.5);
  assert.equal(webm.video.fps, 25);
  const rotated = importedVideoMetadata(
    metadata({ ...stream, side_data_list: [{ rotation: -90 }] } as typeof stream),
    'mp4',
  );
  assert.equal(rotated.video.width, 181);
  assert.equal(rotated.video.height, 321);
});
test('import metadata rejects unsupported, missing, nonfinite and excessive video properties', () => {
  for (const patch of [
    { codec_name: 'hevc' },
    { width: 9000 },
    { avg_frame_rate: '1/0' },
    { duration: '4000' },
    { height: 0 },
  ])
    assert.throws(() => importedVideoMetadata(metadata({ ...stream, ...patch }), 'mp4'));
  for (const text of ['bad', '{}', JSON.stringify({ streams: [] }), ' '.repeat(65537)])
    assert.throws(() => importedVideoMetadata(text, 'mp4'));
  assert.throws(() => importedVideoMetadata(metadata(), 'webm'));
});
test('source ranges, speed, frame count and audio trimming share the same export timeline', () => {
  const p = project();
  p.playback.speed = 2;
  const plan = recordingExportPlan(p, {
    format: 'gif',
    quality: 'original',
    range: { start: 0.5, end: 1.5 },
  });
  assert.equal(plan.start, 0.5);
  assert.equal(plan.seconds, 0.5);
  assert.equal(plan.frames, 12);
  const audio = exportAudioFilters(
    p.playback,
    [{ kind: 'mixed', input: 1 }],
    plan.seconds,
    plan.start,
  );
  assert.match(audio.filter, /atrim=start=0.5,asetpts=PTS-STARTPTS,atempo=2/);
  assert.match(audio.filter, /atrim=duration=0.5/);
  for (const range of [
    { start: 1, end: 1 },
    { start: -1, end: 1 },
    { start: NaN, end: 1 },
    { start: 0, end: 3 },
  ])
    assert.throws(() => recordingExportPlan(p, { format: 'gif', quality: 'original', range }));
  assert.throws(() => recordingExportOptions({ format: 'gif', quality: 'original', range: null }));
});
