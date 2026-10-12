import { exposeRecordingWindow } from './recording-common';
import { ipcRenderer } from 'electron';
import type { RecordingAnnotationAPI } from '../shared/recording/recording-annotations';
const api: RecordingAnnotationAPI = {
  state: () => ipcRenderer.invoke('one:recording-annotation-state'),
  scene: (token, scene) => ipcRenderer.invoke('one:recording-annotation-scene', token, scene),
  frame: (token) => ipcRenderer.invoke('one:recording-annotation-frame', token),
  selected: (token, tool, style) =>
    ipcRenderer.invoke('one:recording-annotation-selected', token, tool, style),
  flushed: (token, id, error) =>
    ipcRenderer.invoke('one:recording-annotation-flushed', token, id, error),
  onChange: (callback) => {
    const listener = (_event: unknown, packet: Parameters<typeof callback>[0]) => callback(packet);
    ipcRenderer.on('one:recording-annotation-changed', listener);
    return () => { ipcRenderer.removeListener('one:recording-annotation-changed', listener); };
  },
};
exposeRecordingWindow('recordingAnnotation', api);
