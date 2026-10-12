import { exposeRecordingWindow } from './recording-common';
import { ipcRenderer } from 'electron';
import type { RecordingToolbarAPI } from '../shared/recording/recording-toolbar';
const call = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke('one:recording-toolbar-' + name, ...args);
const api: RecordingToolbarAPI = {
  state: () => call('state'),
  pause: (token, paused) => call('pause', token, paused),
  stop: (token) => call('stop', token),
  gain: (token, system, microphone) => call('gain', token, system, microphone),
  cancel: (token) => call('cancel', token),
  camera: (token) => call('camera', token),
  cameraStyle: (token, style) => call('camera-style', token, style),
  inputStyle: (token, style) => call('input-style', token, style),
  region: (token) => call('region', token),
  annotate: (token, command) => call('annotate', token, command),
  menu: (token, menu, anchor) => call('menu', token, menu, anchor),
  menuState: () => call('menu-state'),
  closeMenu: (token) => call('menu-close', token),
  fit: (token, width) => call('fit', token, width),
  fitMenu: (token, height) => call('menu-fit', token, height),
  onDismissMenu: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('one:recording-menu-dismiss', listener);
    return () => { ipcRenderer.removeListener('one:recording-menu-dismiss', listener); };
  },
  expand: (token, expanded, annotations) => call('expand', token, expanded, annotations),
  resetPosition: (token) => call('reset-position', token),
  drag: (token, phase, point) => call('drag', token, phase, point),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('one:recording-changed', listener);
    return () => { ipcRenderer.removeListener('one:recording-changed', listener); };
  },
};
exposeRecordingWindow('recordingToolbar', api);
