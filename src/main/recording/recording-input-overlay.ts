import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { InputStyle, RecordingInput } from '../../shared/recording/recording-input';
import type { RecordingState } from '../../shared/recording/recording';
const URL = recordingWindowURL('recording-input-overlay');
/** Display-only, capture-excluded layer. Never accepts pointer or keyboard focus. */
export class RecordingInputOverlay {
  window?: BrowserWindow;
  private token = '';
  private style?: InputStyle;
  private dimensions = { width: 0, height: 0 };
  private timer?: NodeJS.Timeout;
  private recent: RecordingInput[] = [];
  constructor(
    private host: RecordingWindowHost,
    private state: () => RecordingState,
    private failed: () => void,
  ) {
    host.register('recording-input-state', (event) => {
      if (
        !this.window ||
        event.sender !== this.window.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== URL ||
        this.token !== this.state().token
      )
        throw Error('键鼠回显已失效');
      return this.packet();
    }, ['recording-input-overlay']);
  }
  private packet() {
    const state = this.state();
    return {
      token: this.token,
      style: this.style,
      ...this.dimensions,
      sample: Math.max(Math.round(state.seconds * 48000), this.recent.at(-1)?.sample || 0),
      paused: state.phase !== 'recording',
      events: this.recent,
    };
  }
  async open(
    token: string,
    style: InputStyle,
    width: number,
    height: number,
    bounds: () => Rectangle | null,
  ) {
    this.close();
    this.token = token;
    this.style = style;
    this.dimensions = { width, height };
    const rect = bounds();
    if (!rect) throw Error('无法定位键鼠回显区域');
    const window = this.host.createWindow('recording-input-overlay', {
      ...screen.screenToDipRect(null, rect),
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      fullscreenable: false,
    });
    this.window = window;
    window.setIgnoreMouseEvents(true);
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.failed();
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.close();
        this.failed();
      }
    });
    try {
      await window.loadURL(URL);
      if (this.window !== window) return;
      window.showInactive();
      this.timer = setInterval(() => {
        if (this.window !== window || window.isDestroyed()) return;
        this.syncPosition(bounds());
      }, 100);
      this.timer.unref();
    } catch (error) {
      if (this.window === window) this.close();
      throw error;
    }
  }
  push(events: RecordingInput[]) {
    this.recent.push(...events);
    const end = this.recent.at(-1)?.sample || 0;
    this.recent = this.recent.filter((event) => event.sample >= end - 240000).slice(-512);
    this.changed();
  }
  setStyle(style: InputStyle) {
    this.style = style;
    this.recent = [];
    this.changed();
  }
  syncPosition(rect: Rectangle | null) {
    const window = this.window;
    if (!window || window.isDestroyed() || !rect) return;
    const next = screen.screenToDipRect(null, rect),
      previous = window.getContentBounds();
    if (
      ['x', 'y', 'width', 'height'].some(
        (key) => next[key as keyof Rectangle] !== previous[key as keyof Rectangle],
      )
    )
      window.setContentBounds(next, false);
  }
  changed() {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('one:recording-input-changed', this.packet());
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const window = this.window;
    this.window = undefined;
    this.token = '';
    this.recent = [];
    if (window && !window.isDestroyed()) window.destroy();
  }
}
