import { exposeRecordingWindow } from './recording-common';
import { ipcRenderer } from 'electron';
import type { RecordingRegionAPI } from '../shared/recording/recording-region';
const api: RecordingRegionAPI = {
  state: () => ipcRenderer.invoke('one:recording-region-state'),
  drag: (token, phase, point) =>
    ipcRenderer.invoke('one:recording-region-drag', token, phase, point),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('one:recording-region-changed', listener);
    return () => { ipcRenderer.removeListener('one:recording-region-changed', listener); };
  },
};
exposeRecordingWindow('recordingRegion', api);
