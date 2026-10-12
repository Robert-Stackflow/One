import { exposeRecordingWindow } from './recording-common';
import { ipcRenderer } from 'electron';
import type { RecordingExportRendererAPI } from '../shared/recording/recording-export';
const call = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke('one:recording-export-' + name, ...args);
const api: RecordingExportRendererAPI = {
  payload: () => call('payload'),
  frame: (id, index, rgba) => call('frame', id, index, rgba),
  finish: (id) => call('finish', id),
  fail: (id, message) => call('fail', id, message),
};
exposeRecordingWindow('recordingExport', api);
