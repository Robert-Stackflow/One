import {
  RECORDING_AUDIO_SOURCES,
  type RecordingState,
  type RecordingAudioSource,
} from '../../shared/recording/recording';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import { recordingSourceMix, recordingStereo } from './recording-stereo';

/** Stream source WAVs; the mixed original is disconnected whenever source tracks exist. */
export function recordingAudio(
  master: HTMLMediaElement,
  settings: () => PlaybackSettings,
  error: (value: unknown) => void,
) {
  let token = '',
    disposed = false,
    buffering = false,
    frame = 0,
    context: AudioContext | undefined,
    original: MediaElementAudioSourceNode | undefined,
    originalGain: GainNode | undefined,
    sum: GainNode | undefined,
    stereo: ReturnType<typeof recordingStereo> | undefined,
    mix: ReturnType<typeof recordingSourceMix> | undefined;
  const tracks = new Map<RecordingAudioSource, HTMLAudioElement>(),
    playing = new WeakSet<HTMLAudioElement>();
  function apply() {
    const s = settings();
    stereo?.set(s.left, s.right);
    mix?.set(s.system, s.microphone);
    for (const track of tracks.values()) track.playbackRate = master.playbackRate;
  }
  function fail(value: unknown) {
    if (!disposed) {
      master.pause();
      error(value);
    }
  }
  function sync() {
    if (disposed) return;
    const stopped =
      master.paused || master.ended || master.seeking || buffering || master.muted || !mix;
    for (const track of tracks.values()) {
      track.playbackRate = master.playbackRate;
      const at = Math.min(
        master.currentTime,
        Number.isFinite(track.duration) ? Math.max(0, track.duration - 0.001) : master.currentTime,
      );
      if (track.readyState >= 1 && Math.abs(track.currentTime - at) > (stopped ? 0.001 : 0.08))
        track.currentTime = at;
      if (stopped) track.pause();
      else if (track.paused && !playing.has(track)) {
        playing.add(track);
        void track
          .play()
          .catch((e) => {
            if (
              tracks.get(track.dataset.recordingSource as RecordingAudioSource) === track &&
              !master.paused &&
              !master.seeking &&
              !buffering
            )
              fail(e);
          })
          .finally(() => playing.delete(track));
      }
    }
    if (!stopped && !frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    else if (stopped && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }
  const wait = () => {
      buffering = true;
      sync();
    },
    ready = () => {
      buffering = false;
      sync();
    };
  const events = [
    'play',
    'pause',
    'seeking',
    'seeked',
    'ratechange',
    'timeupdate',
    'ended',
    'volumechange',
  ];
  for (const event of events) master.addEventListener(event, sync);
  master.addEventListener('waiting', wait);
  master.addEventListener('playing', ready);
  function clear() {
    mix?.dispose();
    mix = undefined;
    stereo?.dispose();
    stereo = undefined;
    if (sum) {
      original?.disconnect();
      originalGain?.disconnect();
      originalGain = undefined;
      sum.disconnect();
      sum = undefined;
    }
    for (const track of tracks.values()) {
      track.onerror = track.onloadedmetadata = track.oncanplay = null;
      track.pause();
      track.removeAttribute('src');
      track.load();
      track.remove();
    }
    tracks.clear();
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }
  return {
    update(state: RecordingState) {
      if (token === state.token) return;
      clear();
      token = state.token;
      buffering = false;
      for (const source of RECORDING_AUDIO_SOURCES)
        if (state.audioSources?.[source]) {
          const track = new Audio(state.audioSources[source]);
          track.hidden = true;
          track.preload = 'metadata';
          track.dataset.recordingSource = source;
          track.onloadedmetadata = sync;
          track.oncanplay = sync;
          track.onerror = () =>
            fail(
              '无法播放' + (source === 'system' ? '系统声' : '麦克风') + '轨道，原始素材仍已保留。',
            );
          tracks.set(source, track);
          document.body.append(track);
        }
    },
    async prepare() {
      // Respect a muted master, including silent fixture playback. No output
      // device is opened until the user explicitly requests audible playback.
      if (master.muted || disposed) return;
      if (!context) {
        context = new AudioContext();
        original = context.createMediaElementSource(master);
      }
      if (!sum) {
        sum = context.createGain();
        stereo = recordingStereo(context, sum, context.destination);
        // Keep pulling the video's embedded audio so its playback clock advances.
        // Independent tracks replace its sound, but must not disconnect its clock.
        originalGain = context.createGain();
        originalGain.gain.value = tracks.size ? 0 : 1;
        original!.connect(originalGain);
        originalGain.connect(sum);
        if (tracks.size) {
          const nodes: Partial<Record<RecordingAudioSource, AudioNode>> = {};
          for (const [source, track] of tracks)
            nodes[source] = context.createMediaElementSource(track);
          mix = recordingSourceMix(context, nodes, sum);
        }
      }
      apply();
      await context.resume();
    },
    apply,
    dispose() {
      disposed = true;
      clear();
      for (const event of events) master.removeEventListener(event, sync);
      master.removeEventListener('waiting', wait);
      master.removeEventListener('playing', ready);
      void context?.close();
    },
  };
}
