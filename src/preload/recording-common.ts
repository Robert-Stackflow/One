import { contextBridge, ipcRenderer } from 'electron';
import type { OneAPI } from '../shared/types';

type RecordingWindows = Pick<OneAPI,
  'recordingToolbar' | 'recordingInput' | 'recordingCamera' | 'recordingAnnotation' |
  'recordingRegion' | 'recordingCountdown' | 'recordingPlayer' | 'recordingExport'>;

export const recordingInvoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:' + name, ...args);
export function recordingListen<T>(name: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on('one:' + name, listener);
  return () => { ipcRenderer.removeListener('one:' + name, listener); };
}

/** A recording window receives its own feature API and One's shared presentation services. */
export function exposeRecordingWindow<K extends keyof RecordingWindows>(key: K, api: NonNullable<RecordingWindows[K]>, windowControls = false) {
  const common: Pick<OneAPI, 'appearance' | 'onAppearance' | 'uiFontSource' | 'diagnosticsReport'> = {
    appearance: () => recordingInvoke('appearance'),
    onAppearance: callback => recordingListen('appearance', callback),
    uiFontSource: family => recordingInvoke('ui-font-source', family),
    diagnosticsReport: (kind, detail) => recordingInvoke('diagnostics-report', kind, detail),
  };
  const controls: Pick<OneAPI, 'windowAction' | 'windowState' | 'onWindowState'> = {
    windowAction: action => recordingInvoke('window-action', action),
    windowState: () => recordingInvoke('window-state'),
    onWindowState: callback => recordingListen('window-state', callback),
  };
  contextBridge.exposeInMainWorld('one', { ...common, ...(windowControls ? controls : {}), [key]: api });
}
