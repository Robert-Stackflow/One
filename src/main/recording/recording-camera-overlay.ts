import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { cameraBox, cameraStyle, type CameraStyle } from '../../shared/recording/recording-camera';
import type { CameraPacket } from '../../shared/recording/recording-camera-overlay';
import type { VideoReady } from '../../shared/recording/native-video';
const URL = recordingWindowURL('recording-camera-overlay'),
  PAD = 12;
interface Actions {
  valid(token: string): boolean;
  layout(value: CameraStyle): Promise<void>;
  failed(message: string): void;
}
/** Native camera preview only. Excluded from screen capture so replay stays editable. */
export class RecordingCameraOverlay {
  window?: BrowserWindow;
  private token = '';
  private serial = 0;
  private style?: CameraStyle;
  private video?: VideoReady;
  private camera?: VideoReady;
  private bounds?: () => Rectangle | null;
  private timer?: NodeJS.Timeout;
  private dragging?: {
    point: { x: number; y: number };
    style: CameraStyle;
    box: Rectangle;
    area: Rectangle;
    resize: boolean;
  };
  constructor(
    private host: RecordingWindowHost,
    private actions: Actions,
  ) {
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      host.register('recording-camera-' + name, (event, ...args) => {
        if (
          !this.window ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL ||
          !this.actions.valid(this.token) ||
          (name !== 'state' && args[0] !== this.token)
        )
          throw Error('摄像头画中画已失效');
        return fn(...args);
      }, ['recording-camera-overlay']);
    handle('state', () => this.packet());
    handle('style', async (_token, value) => this.apply(cameraStyle(value)));
    handle('drag', async (_token, phase, resize, point) => {
      if (
        !['start', 'move', 'end'].includes(phase) ||
        typeof resize !== 'boolean' ||
        !point ||
        ![point.x, point.y].every((v) => Number.isFinite(v) && Math.abs(v) < 100000)
      )
        throw Error('摄像头拖动坐标无效');
      const area = this.bounds?.();
      if (!area || !this.style || !this.camera || !this.video) throw Error('录制区域已失效');
      const dip = screen.screenToDipRect(null, area);
      if (phase === 'start') {
        const b = cameraBox(this.style, this.camera, this.video);
        this.dragging = {
          point: { ...point },
          style: { ...this.style },
          box: {
            x: (b.x / this.video.width) * dip.width,
            y: (b.y / this.video.height) * dip.height,
            width: (b.width / this.video.width) * dip.width,
            height: (b.height / this.video.height) * dip.height,
          },
          area: dip,
          resize,
        };
      } else if (this.dragging) {
        const d = this.dragging,
          next = { ...d.style };
        if (resize !== d.resize) throw Error('摄像头拖动方式无效');
        if (resize)
          next.width = Math.max(
            0.1,
            Math.min(0.6, (d.box.width + point.x - d.point.x) / d.area.width),
          );
        else {
          next.x = Math.max(0, Math.min(1, (d.box.x + point.x - d.point.x) / d.area.width));
          next.y = Math.max(0, Math.min(1, (d.box.y + point.y - d.point.y) / d.area.height));
        }
        await this.apply(next);
        if (phase === 'end') this.dragging = undefined;
      }
    });
  }
  private packet(): CameraPacket {
    return {
      token: this.token,
      serial: this.serial,
      url: 'one-file://recording-camera-live/' + this.token + '?serial=' + this.serial,
      style: this.style!,
      width: this.camera!.width,
      height: this.camera!.height,
      videoWidth: this.video!.width,
      videoHeight: this.video!.height,
    };
  }
  private async apply(value: CameraStyle) {
    const token = this.token;
    await this.actions.layout(value);
    if (!this.window || this.token !== token || !this.actions.valid(token)) return;
    this.style = value;
    this.position();
    this.changed();
    if (value.visible) this.window.showInactive();
  }
  get currentStyle() {
    return this.style ? { ...this.style } : undefined;
  }
  async setStyle(value: CameraStyle) {
    if (!this.style) throw Error('摄像头画面尚未就绪');
    await this.apply(cameraStyle(value));
  }
  syncPosition() {
    this.position();
  }
  private position() {
    if (!this.window || !this.style || !this.camera || !this.video) return;
    const area = this.bounds?.();
    if (!area) return;
    const dip = screen.screenToDipRect(null, area),
      b = cameraBox(this.style, this.camera, this.video);
    const rect = {
      x: Math.round(dip.x + (b.x / this.video.width) * dip.width) - PAD,
      y: Math.round(dip.y + (b.y / this.video.height) * dip.height) - PAD,
      width: Math.max(1, Math.round((b.width / this.video.width) * dip.width)) + PAD * 2,
      height: Math.max(1, Math.round((b.height / this.video.height) * dip.height)) + PAD * 2,
    };
    const old = this.window.getContentBounds();
    if (Object.keys(rect).some((k) => rect[k as keyof Rectangle] !== old[k as keyof Rectangle]))
      this.window.setContentBounds(rect, false);
    if (!this.style.visible) this.window.hide();
  }
  async open(
    token: string,
    style: CameraStyle,
    video: VideoReady,
    camera: VideoReady,
    bounds: () => Rectangle | null,
  ) {
    this.close();
    this.token = token;
    this.style = style;
    this.video = video;
    this.camera = camera;
    this.bounds = bounds;
    const window = this.host.createWindow('recording-camera-overlay', {
      width: 320,
      height: 240,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
    });
    this.window = window;
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.actions.failed('摄像头预览意外关闭，正在保留录制结果');
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.close();
        this.actions.failed('摄像头预览意外关闭，正在保留录制结果');
      }
    });
    try {
      this.position();
      await window.loadURL(URL);
      if (this.window !== window) return;
      if (style.visible) window.showInactive();
      this.timer = setInterval(() => this.position(), 100);
      this.timer.unref();
    } catch (error) {
      if (this.window === window) this.close();
      throw error;
    }
  }
  frame(serial: number) {
    this.serial = serial;
    this.changed();
  }
  changed() {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('one:recording-camera-changed', this.packet());
  }
  async toggle() {
    if (!this.style) throw Error('摄像头画面尚未就绪');
    await this.apply({ ...this.style, visible: !this.style.visible });
    if (this.style.visible) this.window?.showInactive();
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
    const window = this.window;
    this.window = undefined;
    this.token = '';
    this.serial = 0;
    this.style = undefined;
    this.bounds = undefined;
    this.dragging = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
