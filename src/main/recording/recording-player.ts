import type { BrowserWindow } from 'electron';
import type { PlaybackSettings, PlaybackState } from '../../shared/recording/recording-playback';
import type { RecordingInput } from '../../shared/recording/recording-input';
import type { AnnotationEvent } from '../../shared/recording/recording-annotations';
import type { CameraLayout } from '../../shared/recording/recording-camera';
import type { CursorEvent, CursorShape } from '../../shared/recording/recording-cursor';
import { recordingWindowURL, type RecordingWindowHost } from './window-host';
const URL = recordingWindowURL('recording-player');
interface Actions {
  state(): PlaybackState;
  blocked(): boolean;
  inputEvents(after: number): RecordingInput[];
  annotationEvents(after: number): AnnotationEvent[];
  cameraLayouts(): CameraLayout[];
  cursorEvents(after: number): CursorEvent[];
  cursorShapes(): CursorShape[];
  edit(value: PlaybackSettings): void;
  save(camera: boolean, owner: BrowserWindow): Promise<string | null>;
  saveProject(owner: BrowserWindow): Promise<string | null>;
  export(options: unknown, owner: BrowserWindow): Promise<string | null>;
  previewGif(
    options: unknown,
    complete: unknown,
  ): Promise<import('../../shared/recording/recording-export').GifPreview | null>;
  cancelExport(id: unknown): Promise<void>;
  background<T>(task: Promise<T>): Promise<T>;
}
/** A playback-only window. It cannot enumerate devices or start/control capture. */
export class RecordingPlayer {
  window?: BrowserWindow;
  private token = '';
  private loading?: Promise<void>;
  constructor(
    private host: RecordingWindowHost,
    private actions: Actions,
  ) {
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      host.register('recording-player-' + name, (event, ...args) => {
        const window = this.window,
          state = this.actions.state();
        if (
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL ||
          !this.token ||
          state.token !== this.token ||
          !['ready', 'saving'].includes(state.phase) ||
          this.actions.blocked() ||
          (name !== 'state' && args[0] !== this.token)
        )
          throw Error('录制结果窗口已失效');
        return this.actions.background(
          Promise.resolve().then(() => {
            if (
              this.window !== window ||
              this.actions.state().token !== this.token ||
              !['ready', 'saving'].includes(this.actions.state().phase) ||
              this.actions.blocked()
            )
              throw Error('录制结果窗口已失效');
            return fn(...(name === 'state' ? args : args.slice(1)));
          }),
        );
      }, ['recording-player']);
    handle('state', () => this.actions.state());
    handle('input-events', (after) => this.actions.inputEvents(after));
    handle('annotation-events', (after) => this.actions.annotationEvents(after));
    handle('camera-layouts', () => this.actions.cameraLayouts());
    handle('cursor-events', (after) => this.actions.cursorEvents(after));
    handle('cursor-shapes', () => this.actions.cursorShapes());
    handle('edit', (value) => this.actions.edit(value));
    handle('save-project', () => this.actions.saveProject(this.window!));
    handle('export', (options) => this.actions.export(options, this.window!));
    handle('preview-gif', (options, complete) => this.actions.previewGif(options, complete));
    handle('cancel-export', (id) => this.actions.cancelExport(id));
    handle('save', (camera) => {
      if (camera !== undefined && typeof camera !== 'boolean') throw Error('录制轨道无效');
      return this.actions.save(!!camera, this.window!);
    });
  }
  async open() {
    const state = this.actions.state();
    if (this.actions.blocked() || !['ready', 'saving'].includes(state.phase) || !state.url)
      throw Error('请先完成录制');
    if (this.window && !this.window.isDestroyed() && this.token === state.token) {
      const window = this.window;
      await this.loading;
      if (this.window === window && !this.actions.blocked()) {
        window.show();
        window.focus();
      }
      return;
    }
    this.close();
    this.token = state.token;
    const window = this.host.createWindow('recording-player', {
      width: 1100,
      height: 800,
      minWidth: 680,
      minHeight: 520,
      show: false,
      title: 'One · 录制结果',
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      thickFrame: true,
      hasShadow: true,
      autoHideMenuBar: true,
      backgroundColor: state.dark ? '#181818' : '#FFFFFF',
    });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined;
        this.token = '';
      }
    });
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.close();
    });
    try {
      const loading = window.loadURL(URL);
      this.loading = loading;
      await loading;
      if (
        this.window === window &&
        this.actions.state().token === this.token &&
        !this.actions.blocked()
      )
        window.show();
    } catch (error) {
      if (this.window === window) this.close();
      throw error;
    }
  }
  changed() {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('one:recording-changed');
  }
  close() {
    const window = this.window;
    this.window = undefined;
    this.token = '';
    this.loading = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
