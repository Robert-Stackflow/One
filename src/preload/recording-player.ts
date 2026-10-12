import { exposeRecordingWindow } from './recording-common';
import { ipcRenderer } from 'electron';
import type { RecordingPlayerAPI } from '../shared/recording/recording-playback';
const call = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke('one:recording-player-' + name, ...args);
const api: RecordingPlayerAPI = {
  state: () => call('state'),
  inputEvents: (token, after) => call('input-events', token, after),
  annotationEvents: (token, after) => call('annotation-events', token, after),
  cameraLayouts: (token) => call('camera-layouts', token),
  cursorEvents: (token, after) => call('cursor-events', token, after),
  cursorShapes: (token) => call('cursor-shapes', token),
  edit: (token, value) => call('edit', token, value),
  save: (token, camera) => call('save', token, camera),
  saveProject: (token) => call('save-project', token),
  export: (token, options) => call('export', token, options),
  previewGif: (token, options, complete) => call('preview-gif', token, options, complete),
  cancelExport: (token, id) => call('cancel-export', token, id),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('one:recording-changed', listener);
    return () => { ipcRenderer.removeListener('one:recording-changed', listener); };
  },
};
exposeRecordingWindow('recordingPlayer', api, true);
