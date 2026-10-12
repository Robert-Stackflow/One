import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { RecordingState } from '../../shared/recording/recording';
import type { AnnotationCommand } from '../../shared/recording/recording-annotations';
import { recordingTools } from '../../shared/recording/recording-annotations';
import type { RecordingToolbarMenu } from '../../shared/recording/recording-toolbar';
import type { CameraStyle } from '../../shared/recording/recording-camera';
import type { InputStyle } from '../../shared/recording/recording-input';

const URL = recordingWindowURL('recording-toolbar');
const MENU_URL = recordingWindowURL('recording-toolbar-menu');
const WIDTH = 540,
  HEIGHT = 64,
  EXPANDED = 212;
interface Actions {
  state(): RecordingState;
  blocked(): boolean;
  pause(token: string, paused: boolean): Promise<void>;
  stop(token: string): Promise<void>;
  gain(token: string, system: number, microphone: number): Promise<void>;
  camera(token: string): Promise<void>;
  cameraStyle(token: string, style: CameraStyle): Promise<void>;
  inputStyle(token: string, style: InputStyle): Promise<void>;
  region(token: string): Promise<void>;
  annotate(token: string, command: AnnotationCommand): Promise<void>;
  cancel(token: string): Promise<void>;
  failed(message: string): void;
  background<T>(task: Promise<T>): Promise<T>;
}

export class RecordingToolbar {
  window?: BrowserWindow;
  private token = '';
  private anchor?: Rectangle;
  private height = HEIGHT;
  private width = WIDTH;
  private maxWidth = 1600;
  private above = false;
  private menuWindow?: BrowserWindow;
  private menuValue?: RecordingToolbarMenu;
  private dragging?: { point: { x: number; y: number }; bounds: Rectangle };
  constructor(
    private host: RecordingWindowHost,
    private actions: Actions,
  ) {
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      host.register('recording-toolbar-' + name, (event, ...args) => {
        const menuSender = !!this.menuWindow && event.sender === this.menuWindow.webContents;
        const window = menuSender ? this.menuWindow : this.window;
        if (
          this.actions.blocked() ||
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== (menuSender ? MENU_URL : URL) ||
          (menuSender &&
            ![
              'state',
              'menu-state',
              'menu-close',
              'menu-fit',
              'annotate',
              'camera-style',
              'input-style',
            ].includes(name)) ||
          !this.token ||
          this.actions.state().token !== this.token
        )
          throw Error('录制操作栏已失效');
        if (!['state', 'menu-state'].includes(name) && args[0] !== this.token)
          throw Error('录制会话已失效');
        return this.actions.background(
          Promise.resolve().then(() => {
            if (
              this.actions.blocked() ||
              (menuSender ? this.menuWindow : this.window) !== window ||
              this.actions.state().token !== this.token
            )
              throw Error('录制操作栏已失效');
            return fn(...args);
          }),
        );
      }, ['recording-toolbar', 'recording-toolbar-menu']);
    handle('state', () => this.actions.state());
    handle('pause', (token, paused) => this.actions.pause(token, paused));
    handle('stop', (token) => this.actions.stop(token));
    handle('gain', (token, system, microphone) => this.actions.gain(token, system, microphone));
    handle('cancel', (token) => this.actions.cancel(token));
    handle('camera', (token) => this.actions.camera(token));
    handle('camera-style', async (token, style) => {
      await this.actions.cameraStyle(token, style);
      this.menuWindow?.moveTop();
    });
    handle('input-style', async (token, style) => {
      await this.actions.inputStyle(token, style);
      this.menuWindow?.moveTop();
    });
    handle('region', (token) => this.actions.region(token));
    handle('annotate', async (token, command) => {
      await this.actions.annotate(token, command);
      this.menuWindow?.moveTop();
    });
    handle('menu-state', () => ({ menu: this.menuValue, state: this.actions.state() }));
    handle('menu-close', () => this.closeMenu());
    handle('fit', (_token, width) => {
      if (!Number.isFinite(width) || width < 200 || width > 4000) throw Error('操作栏尺寸无效');
      const bounds = this.window!.getContentBounds(),
        area = screen.getDisplayMatching(bounds).workArea;
      const next = Math.min(Math.ceil(width), this.maxWidth, area.width - 16);
      if (next === this.width) return;
      this.width = next;
      this.window!.setContentBounds(this.clamp({ ...bounds, width: next }), false);
    });
    handle('menu-fit', (_token, height) => {
      if (!Number.isFinite(height) || height < 20 || height > 4000) throw Error('菜单尺寸无效');
      const window = this.menuWindow;
      if (!window || window.isDestroyed()) return;
      const bounds = window.getContentBounds(),
        area = screen.getDisplayMatching(bounds).workArea;
      const next = Math.min(Math.ceil(height), area.height - 16);
      if (bounds.height === next) return;
      const above = bounds.y < this.window!.getContentBounds().y;
      window.setContentBounds(
        this.clamp({
          ...bounds,
          height: next,
          y: above ? bounds.y + bounds.height - next : bounds.y,
        }),
        false,
      );
    });
    handle('menu', (_token, menu, anchor) => this.openMenu(menu, anchor));
    handle('expand', (_token, expanded, annotations) => {
      if (
        typeof expanded !== 'boolean' ||
        (annotations !== undefined && typeof annotations !== 'boolean')
      )
        throw Error('操作栏布局无效');
      this.closeMenu();
      const bounds = this.window!.getContentBounds();
      const barY = bounds.y + (this.above ? this.height - HEIGHT : 0);
      this.height = expanded ? (annotations ? 120 : EXPANDED) : HEIGHT;
      const area = screen.getDisplayMatching(bounds).workArea;
      this.above = expanded && barY + this.height > area.y + area.height;
      this.window!.setContentBounds(
        this.clamp({
          ...bounds,
          y: barY - (this.above ? this.height - HEIGHT : 0),
          width: this.width,
          height: this.height,
        }),
      );
      return this.above;
    });
    handle('reset-position', () => this.position());
    handle('drag', (_token, phase, point) => {
      if (
        !['start', 'move', 'end'].includes(phase) ||
        !point ||
        ![point.x, point.y].every((n) => Number.isFinite(n) && Math.abs(n) < 100000)
      )
        throw Error('拖动坐标无效');
      if (phase === 'start') {
        this.closeMenu();
        this.dragging = {
          point: { x: point.x, y: point.y },
          bounds: this.window!.getContentBounds(),
        };
      } else if (this.dragging) {
        const { bounds, point: origin } = this.dragging;
        const next = this.clamp({
          ...bounds,
          x: bounds.x + point.x - origin.x,
          y: bounds.y + point.y - origin.y,
        });
        this.window!.setContentBounds({ ...next, width: this.width, height: this.height });
        if (phase === 'end') this.dragging = undefined;
      }
    });
  }
  private clamp(bounds: Rectangle) {
    const area = screen.getDisplayMatching(bounds).workArea;
    return {
      ...bounds,
      x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
      y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))),
    };
  }
  private position() {
    const region = this.anchor || screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(region).workArea;
    const height = this.height;
    const barY =
      this.anchor && region.y + region.height + HEIGHT + 12 <= area.y + area.height
        ? region.y + region.height + 12
        : area.y + area.height - HEIGHT - 20;
    this.above = barY + height > area.y + area.height;
    const next = this.clamp({
      width: this.width,
      height,
      x: region.x + (region.width - this.width) / 2,
      y: barY - (this.above ? height - HEIGHT : 0),
    });
    this.window?.setContentBounds(next);
    return this.above;
  }
  async open(token: string, anchor?: Rectangle) {
    this.close();
    this.token = token;
    this.anchor = anchor;
    this.height = HEIGHT;
    this.above = false;
    this.maxWidth =
      (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea.width - 16;
    this.width = Math.min(
      this.actions.state().options?.mode === 'video' ? 1600 : 350,
      (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea.width - 16,
    );
    const window = this.host.createWindow('recording-toolbar', {
      width: this.width,
      height: HEIGHT,
      useContentSize: true,
      show: false,
      frame: true,
      titleBarStyle: 'hidden',
      thickFrame: true,
      hasShadow: true,
      roundedCorners: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      title: 'One · 录制操作栏',
      backgroundColor: this.actions.state().dark ? '#202020' : '#ffffff',
    });
    this.window = window;
    window.on('resize', () => {
      if (this.window !== window || window.isDestroyed()) return;
      const bounds = window.getContentBounds();
      if (Math.abs(bounds.width - this.width) > 1 || Math.abs(bounds.height - this.height) > 1)
        window.setContentBounds({ ...bounds, width: this.width, height: this.height }, false);
    });
    // Windows "floating" reinserts behind Explorer's taskbar and can lose
    // WS_EX_TOPMOST when that taskbar is temporarily not topmost.
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.actions.failed('录制操作栏意外关闭，正在保留录制结果');
    });
    window.on('close', (event) => {
      if (this.window !== window) return;
      event.preventDefault();
      const task =
        this.actions.state().phase === 'arming'
          ? this.actions.cancel(token)
          : this.actions.stop(token);
      void this.actions.background(task).catch(() => {});
    });
    this.position();
    try {
      await window.loadURL(URL);
      if (this.window === window && !this.actions.blocked()) window.showInactive();
    } catch (error) {
      if (this.window === window) this.close();
      throw error;
    }
  }
  changed() {
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('one:recording-changed');
    this.menuWindow?.webContents.send('one:recording-changed');
  }
  controlBounds() {
    return [this.window, this.menuWindow]
      .filter(
        (window): window is BrowserWindow =>
          !!window && !window.isDestroyed() && window.isVisible(),
      )
      .map((window) => window.getBounds());
  }
  raise() {
    this.window?.moveTop();
    this.menuWindow?.moveTop();
  }
  private async openMenu(value: RecordingToolbarMenu, anchor: Rectangle) {
    if (
      !value ||
      !['tools', 'color', 'stroke', 'font', 'weight', 'more', 'camera', 'input'].includes(
        value.kind,
      ) ||
      ((value.kind === 'tools' || value.tools !== undefined) &&
        (!Array.isArray(value.tools) ||
          (value.kind === 'tools' && !value.tools.length) ||
          value.tools.length > recordingTools.length ||
          value.tools.some((tool) => !recordingTools.includes(tool)))) ||
      !anchor ||
      ![anchor.x, anchor.y, anchor.width, anchor.height].every(
        (n) => Number.isFinite(n) && Math.abs(n) < 3000,
      )
    )
      throw Error('标注菜单无效');
    this.closeMenu();
    this.menuValue = structuredClone(value);
    const token = this.token,
      owner = this.window!,
      origin = owner.getContentBounds(),
      area = screen.getDisplayMatching(origin).workArea;
    const settings = value.kind === 'camera' || value.kind === 'input';
    const width = settings ? 328 : value.kind === 'color' ? 280 : value.kind === 'font' ? 240 : 204,
      height = Math.min(
        area.height - 16,
        settings
          ? value.kind === 'camera'
            ? 490
            : 260
          : value.kind === 'color'
            ? 384
            : value.kind === 'tools'
              ? value.tools!.length * 38 + 16
              : value.kind === 'stroke'
                ? 282
                : value.kind === 'font'
                  ? 168
                  : value.kind === 'weight'
                    ? 130
                    : 172 + (value.tools?.length || 0) * 38,
      ),
      below = origin.y + anchor.y + anchor.height + 6;
    const window = this.host.createWindow('recording-toolbar-menu', {
      width,
      height,
      useContentSize: true,
      show: false,
      frame: true,
      titleBarStyle: 'hidden',
      thickFrame: true,
      hasShadow: true,
      roundedCorners: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: this.actions.state().dark ? '#202020' : '#ffffff',
      title: 'One · 标注选项',
    });
    this.menuWindow = window;
    window.setContentBounds(
      this.clamp({
        x: origin.x + anchor.x,
        y: below + height <= area.y + area.height ? below : origin.y + anchor.y - height - 6,
        width,
        height,
      }),
    );
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    window.on('blur', () => {
      if (this.menuWindow === window) window.webContents.send('one:recording-menu-dismiss');
    });
    window.webContents.on('render-process-gone', () => {
      if (this.menuWindow === window) this.closeMenu();
    });
    try {
      await window.loadURL(MENU_URL);
      if (this.menuWindow === window && this.token === token && !this.actions.blocked())
        window.show();
    } catch (error) {
      if (this.menuWindow === window) this.closeMenu();
      throw error;
    }
  }
  private closeMenu() {
    const window = this.menuWindow;
    this.menuWindow = undefined;
    this.menuValue = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
  close() {
    this.closeMenu();
    const window = this.window;
    this.window = undefined;
    this.token = '';
    this.anchor = undefined;
    this.dragging = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
