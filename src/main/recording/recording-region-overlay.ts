import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { moveRecordingRegion, type RecordingRegionState } from '../../shared/recording/recording-region';
const URL = recordingWindowURL('recording-region-overlay');
interface Actions {
  valid(token: string): boolean;
  crop(): Rectangle | undefined;
  bounds(): Rectangle | null;
  move(x: number, y: number): Promise<void>;
  changed(): void;
  failed(message: string): void;
}
/** A pass-through frame and a separate small handle: the recording centre never intercepts input. */
export class RecordingRegionOverlay {
  window?: BrowserWindow;
  handle?: BrowserWindow;
  private token = '';
  private moving = false;
  private message = '';
  private enabled = false;
  private drag?: {
    point: { x: number; y: number };
    crop: Rectangle;
    scale: { x: number; y: number };
    source: { width: number; height: number };
  };
  constructor(
    private host: RecordingWindowHost,
    private actions: Actions,
  ) {
    for (const name of ['state', 'drag'])
      host.register('recording-region-' + name, async (event, ...args) => {
        const window = this.handle;
        if (
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL ||
          !this.actions.valid(this.token) ||
          (name !== 'state' && args[0] !== this.token)
        )
          throw Error('录制区域控制已失效');
        if (name === 'state') return this.state();
        if (
          !this.enabled ||
          !['start', 'move', 'end'].includes(args[1]) ||
          !args[2] ||
          ![args[2].x, args[2].y].every((n) => Number.isFinite(n) && Math.abs(n) < 100000)
        )
          throw Error('录制区域拖动无效');
        const phase = args[1],
          point = args[2];
        if (phase === 'start') {
          if (this.moving) throw Error('录制区域正在移动');
          const crop = this.actions.crop(),
            bounds = this.actions.bounds();
          if (!crop || !bounds) throw Error('录制区域已失效');
          const display = screen.getDisplayMatching(screen.screenToDipRect(null, bounds));
          // Freeze the source coordinate scale for the whole gesture. Entering another
          // DPI domain cannot resize the selection or rebind the active capture source.
          const physical = screen.dipToScreenRect(null, display.bounds);
          this.drag = {
            point,
            crop,
            scale: {
              x: physical.width / display.bounds.width,
              y: physical.height / display.bounds.height,
            },
            source: { width: physical.width, height: physical.height },
          };
          this.message = '';
          return;
        }
        const drag = this.drag;
        if (!drag || this.moving) return;
        const next = moveRecordingRegion(
          drag.crop,
          {
            x: (point.x - drag.point.x) * drag.scale.x,
            y: (point.y - drag.point.y) * drag.scale.y,
          },
          drag.source,
        );
        if (phase === 'end') this.drag = undefined;
        const current = this.actions.crop();
        if (current?.x === next.x && current?.y === next.y) return;
        this.moving = true;
        const token = this.token;
        try {
          await this.actions.move(next.x, next.y);
        } catch (error) {
          this.message = (error as Error).message;
          this.drag = undefined;
          throw error;
        } finally {
          if (this.token === token) {
            this.moving = false;
            this.sync();
          }
        }
      }, ['recording-region-overlay']);
  }
  get active() {
    return this.enabled;
  }
  private state(): RecordingRegionState {
    return {
      token: this.token,
      enabled: this.enabled,
      crop: this.actions.crop()!,
      message: this.message,
    };
  }
  async open(token: string) {
    this.close();
    this.token = token;
    const bounds = this.actions.bounds();
    if (!bounds) throw Error('无法定位录制区域');
    const create = (handle: boolean) => {
      const window = this.host.createWindow(handle ? 'recording-region-overlay' : 'recording-region-outline', {
        ...screen.screenToDipRect(null, bounds),
        show: false,
        frame: handle,
        ...(handle ? { titleBarStyle: 'hidden' as const, roundedCorners: true } : {}),
        thickFrame: handle,
        transparent: !handle,
        backgroundColor: handle ? '#ffffff' : '#00000000',
        hasShadow: handle,
        minimizable: false,
        maximizable: false,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        fullscreenable: false,
      });
      window.setIgnoreMouseEvents(!handle);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.webContents.on('will-attach-webview', (e) => e.preventDefault());
      window.webContents.on('render-process-gone', () => {
        if (window === this.window || window === this.handle)
          this.actions.failed('录制区域边框意外关闭，正在保留录制');
      });
      window.on('closed', () => {
        if (window === this.window || window === this.handle) {
          this.close();
          this.actions.failed('录制区域边框意外关闭，正在保留录制');
        }
      });
      return window;
    };
    const window = (this.window = create(false)),
      handle = (this.handle = create(true));
    try {
      // Display-only frame has no preload, token, or IPC privileges.
      await Promise.all([window.loadURL(recordingWindowURL('recording-region-outline')), handle.loadURL(URL)]);
      if (this.window !== window) return;
      this.sync();
      window.showInactive();
    } catch (error) {
      if (this.window === window) this.close();
      throw error;
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    this.drag = undefined;
    if (this.enabled) {
      this.sync();
      this.handle?.showInactive();
      this.handle?.moveTop();
    } else this.handle?.hide();
    this.actions.changed();
  }
  sync() {
    const window = this.window,
      handle = this.handle,
      bounds = this.actions.bounds();
    if (!window || !handle || !bounds || window.isDestroyed() || handle.isDestroyed()) return;
    const rect = screen.screenToDipRect(null, bounds);
    // The centre is absent at the OS level, rather than relying on an alpha
    // surface the size of the recording. Keep the visible frame outside the crop.
    const edge = 2,
      frameWidth = rect.width + edge * 2,
      height = rect.height + edge * 2;
    window.setContentBounds(
      { x: rect.x - edge, y: rect.y - edge, width: frameWidth, height },
      false,
    );
    window.setShape([
      { x: 0, y: 0, width: frameWidth, height: edge },
      { x: 0, y: height - edge, width: frameWidth, height: edge },
      { x: 0, y: edge, width: edge, height: rect.height },
      { x: frameWidth - edge, y: edge, width: edge, height: rect.height },
    ]);
    const area = screen.getDisplayMatching(rect).bounds,
      width = Math.min(184, area.width);
    handle.setContentBounds(
      {
        x: Math.round(
          Math.max(
            area.x,
            Math.min(rect.x + (rect.width - width) / 2, area.x + area.width - width),
          ),
        ),
        y: Math.round(Math.max(area.y, rect.y - 42)),
        width,
        height: 36,
      },
      false,
    );
    handle.webContents.send('one:recording-region-changed');
  }
  raise() {
    this.window?.moveTop();
    if (this.enabled) this.handle?.moveTop();
  }
  close() {
    const windows = [this.window, this.handle];
    this.window = this.handle = undefined;
    this.token = '';
    this.enabled = false;
    this.drag = undefined;
    this.message = '';
    this.moving = false;
    for (const window of windows) if (window && !window.isDestroyed()) window.destroy();
  }
}
