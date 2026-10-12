import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMainInvokeEvent } from 'electron';

export type RecordingWindowRole =
  | 'recording-player'
  | 'recording-export'
  | 'recording-toolbar'
  | 'recording-toolbar-menu'
  | 'recording-input-overlay'
  | 'recording-camera-overlay'
  | 'recording-annotation-overlay'
  | 'recording-region-overlay'
  | 'recording-countdown';

/** One chooses the role's preload, permissions and window policy. The caller loads its own route. */
export interface RecordingWindowHost {
  createWindow(role: RecordingWindowRole, options: Omit<BrowserWindowConstructorOptions, 'webPreferences'>): BrowserWindow;
  register(name: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown, roles: readonly RecordingWindowRole[]): void;
}

export const recordingWindowURL = (role: RecordingWindowRole) => 'one://app/index.html?view=' + role;
