import { ipcRenderer } from 'electron';
import type { RecorderAPI } from '../shared/recording/recording';
const call = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke('one:recording-' + name, ...args);
const listen = (name: string, callback: () => void) => {
  const listener = () => callback();
  ipcRenderer.on(name, listener);
  return () => { ipcRenderer.removeListener(name, listener); };
};
export const recording: RecorderAPI = {
  pageActive: value => call('page-active', value),
  audioTest: (channel, enabled, device) => call('audio-test', channel, enabled, device),
  onAudioTest: (callback) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      state: import('../shared/recording/recording').AudioTestState,
    ) => callback(state);
    ipcRenderer.on('one:recording-audio-test', listener);
    return () => { ipcRenderer.removeListener('one:recording-audio-test', listener); };
  },
  openProject: () => call('open-project'),
  prepareNext: () => call('prepare-next'),
  openMaterials: () => call('materials'),
  startAvailability: (value) => call('start-availability', value),
  onStart: (cb) => listen('one:recording-start', cb),
  importVideo: () => call('import-video'),
  cancelImport: () => call('cancel-import'),
  openPlayer: () => call('open-player'),
  state: () => call('state'),
  inputEvents: (token, after) => call('input-events', token, after),
  cameras: () => call('cameras'),
  cameraLayouts: (token) => call('camera-layouts', token),
  cursorEvents: (token, after) => call('cursor-events', token, after),
  cursorShapes: (token) => call('cursor-shapes', token),
  annotationEvents: (token, after) => call('annotation-events', token, after),
  chooseRegion: (source, hideMain = true) => call('choose-region', source, hideMain),
  cameraSetup: (device) => call('camera-setup', device),
  beginMicrophoneList: () => call('microphones-begin'),
  endMicrophoneList: (token) => call('microphones-end', token),
  sources: (type) => call('sources', type),
  audioDevices: () => call('audio-devices'),
  nativeStart: (options) => call('native-start', options),
  nativePause: (token, paused) => call('native-pause', token, paused),
  nativeGain: (token, system, microphone) => call('native-gain', token, system, microphone),
  nativeStop: (token) => call('native-stop', token),
  recoverAudio: (id) => call('audio-recover', id),
  discardAudioDraft: (id) => call('audio-discard', id),
  arm: (options) => call('arm', options),
  started: (token, mime) => call('started', token, mime),
  chunk: (token, index, data) => call('chunk', token, index, data),
  heartbeat: (token, seconds) => call('heartbeat', token, seconds),
  paused: (token, paused) => call('paused', token, paused),
  finish: (token, seconds, reason, mime) => call('finish', token, seconds, reason, mime),
  cancel: () => call('cancel'),
  fail: (token, message) => call('fail', token, message),
  save: () => call('save'),
  saveCamera: () => call('save-camera'),
  copySaved: () => call('copy-saved'),
  onChange: (cb) => {
    const a = listen('one:recording-changed', cb),
      b = listen('one:appearance', cb);
    return () => {
      a();
      b();
    };
  },
  onStop: (cb) => listen('one:recording-stop', cb),
};
