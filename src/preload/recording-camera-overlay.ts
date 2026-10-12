import { exposeRecordingWindow, recordingListen } from './recording-common';
import { ipcRenderer } from 'electron';
import type { CameraOverlayAPI } from '../shared/recording/recording-camera-overlay';
const api: CameraOverlayAPI = {
  state: () => ipcRenderer.invoke('one:recording-camera-state'),
  style: (token, value) => ipcRenderer.invoke('one:recording-camera-style', token, value),
  drag: (token, phase, resize, point) =>
    ipcRenderer.invoke('one:recording-camera-drag', token, phase, resize, point),
  onChange: callback => recordingListen('recording-camera-changed', callback),
};
exposeRecordingWindow('recordingCamera', api);
