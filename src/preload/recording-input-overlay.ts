import { exposeRecordingWindow, recordingListen } from './recording-common';
import { ipcRenderer } from 'electron';
import type { InputOverlayAPI } from '../shared/recording/recording-input-overlay';
const api: InputOverlayAPI = {
  state: () => ipcRenderer.invoke('one:recording-input-state'),
  onChange: callback => recordingListen('recording-input-changed', callback),
};
exposeRecordingWindow('recordingInput', api);
