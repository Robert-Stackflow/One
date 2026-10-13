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
  | 'recording-region-outline'
  | 'recording-countdown';

/** One chooses the role's preload, permissions and window policy. The caller loads its own route.
 * recording-region-outline is display-only and must have no preload or IPC API.
 */
export interface RecordingWindowHost {
  createWindow(role: RecordingWindowRole, options: Omit<BrowserWindowConstructorOptions, 'webPreferences'>): BrowserWindow;
  register(name: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown, roles: readonly RecordingWindowRole[]): void;
}

export const recordingWindowURL = (role: RecordingWindowRole) => 'one://app/index.html?view=' + role;

export const recordingPreloads:Record<RecordingWindowRole,string|undefined>={
  'recording-player':'recording-player','recording-export':'recording-export',
  'recording-toolbar':'recording-toolbar','recording-toolbar-menu':'recording-toolbar',
  'recording-input-overlay':'recording-input-overlay','recording-camera-overlay':'recording-camera-overlay',
  'recording-annotation-overlay':'recording-annotation-overlay','recording-region-overlay':'recording-region-overlay',
  'recording-region-outline':undefined,'recording-countdown':'recording-countdown',
};
export const recordingWindowRoles=Object.keys(recordingPreloads) as RecordingWindowRole[];
export const recordingBridgeRoles=recordingWindowRoles.filter(role=>recordingPreloads[role]);
export const recordingResourceHosts=new Set(['recording','recording-camera','recording-system','recording-microphone','recording-camera-live','recording-camera-setup']);
