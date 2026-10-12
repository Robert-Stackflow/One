import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { type BrowserWindow, type Rectangle } from 'electron';
const URL = recordingWindowURL('recording-countdown');
export class RecordingCountdown {
  window?: BrowserWindow;
  private seconds = 0;
  constructor(
    private host: RecordingWindowHost,
    private cancel: () => void,
  ) {
    for (const action of ['state', 'cancel'])
      host.register('recording-countdown-' + action, (event) => {
        if (
          !this.window ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL
        )
          throw Error('倒计时已结束');
        if (action === 'cancel') cancel();
        return this.seconds;
      }, ['recording-countdown']);
  }
  async open(bounds: Rectangle, seconds: number) {
    this.close();
    this.seconds = seconds;
    const window = this.host.createWindow('recording-countdown', {
      ...bounds,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      fullscreenable: false,
    });
    this.window = window;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.cancel();
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.window = undefined;
        this.cancel();
      }
    });
    await window.loadURL(URL);
    if (this.window === window) window.show();
  }
  update(seconds: number) {
    if (seconds !== this.seconds) {
      this.seconds = seconds;
      this.window?.webContents.send('one:recording-countdown-tick', seconds);
    }
  }
  close() {
    const window = this.window;
    this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
