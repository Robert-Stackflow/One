import { remembersAnnotationTool, type AnnotationPreferencesHost } from '../../shared/capture/annotation-preferences';
import { recordingWindowURL, type RecordingWindowHost } from './window-host';
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  annotationCommand,
  defaultAnnotationStyle,
  type AnnotationPacket,
  type AnnotationCommand,
  type RecordingAnnotationFrame,
  recordingTools,
} from '../../shared/recording/recording-annotations';
import type { ImageDocument, CaptureTool } from '../../shared/capture/image-document';
const URL = recordingWindowURL('recording-annotation-overlay');
interface Actions extends AnnotationPreferencesHost {
  valid(token: string): boolean;
  scene(value: ImageDocument): Promise<void>;
  frame(): Promise<RecordingAnnotationFrame>;
  failed(message: string): void;
  raised(): void;
  selected(): void;
  controls(): Rectangle[];
}
/** Editable, capture-excluded vector layer. Pointer pass-through is the default. */
export class RecordingAnnotationOverlay {
  window?: BrowserWindow;
  private packet: AnnotationPacket = {
    token: '',
    width: 0,
    height: 0,
    interactive: false,
    tool: 'brush',
    style: defaultAnnotationStyle(),
  };
  private timer?: NodeJS.Timeout;
  private loaded?: Promise<void>;
  private flushTask?: Promise<void>;
  private selectedTool?: CaptureTool;
  private pendingFlush?: {
    id: string;
    resolve(): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  };
  constructor(
    private host: RecordingWindowHost,
    private actions: Actions,
  ) {
    for (const name of ['state', 'scene', 'selected', 'flushed', 'frame'])
      host.register('recording-annotation-' + name, (event, ...args) => {
        const window = this.window;
        if (
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== URL ||
          !this.actions.valid(this.packet.token) ||
          (name !== 'state' && args[0] !== this.packet.token)
        )
          throw Error('录制标注已失效');
        if (name === 'state') return this.packet;
        if (name === 'scene') return this.actions.scene(args[1]);
        if (name === 'frame') return this.actions.frame();
        if (name === 'selected') {
          if (args[1] !== undefined && !recordingTools.includes(args[1]))
            throw Error('标注选择无效');
          const command = annotationCommand({ kind: 'style', style: args[2] });
          if (command.kind === 'style' && args[1]) this.packet.style = command.style;
          this.selectedTool = args[1];
          this.actions.selected();
        }
        if (name === 'flushed' && this.pendingFlush && this.pendingFlush.id === args[1]) {
          const pending = this.pendingFlush;
          this.pendingFlush = undefined;
          clearTimeout(pending.timer);
          if (typeof args[2] !== 'string' || args[2])
            pending.reject(Error(String(args[2]).slice(0, 500)));
          else pending.resolve();
        }
      }, ['recording-annotation-overlay']);
  }
  get interactive() {
    return this.packet.interactive;
  }
  get tool() {
    return this.packet.tool;
  }
  get selection() {
    return this.selectedTool;
  }
  get style() {
    return { ...this.packet.style };
  }
  async open(token: string, width: number, height: number, bounds: () => Rectangle | null) {
    this.close();
    this.shape = '';
    this.packet = {
      token,
      width,
      height,
      interactive: false,
      tool: 'brush',
      style: this.actions.annotationStyles?.().brush || defaultAnnotationStyle(),
    };
    const rect = bounds();
    if (!rect) throw Error('无法定位录制标注区域');
    const window = this.host.createWindow('recording-annotation-overlay', {
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
    window.on('focus', () => this.actions.raised());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (this.window === window) this.actions.failed('标注图层意外关闭，正在保留录制结果');
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.close();
        this.actions.failed('标注图层意外关闭，正在保留录制结果');
      }
    });
    try {
      this.loaded = window.loadURL(URL);
      await this.loaded;
      if (this.window !== window) return;
      this.syncPosition(bounds());
      window.showInactive();
      this.actions.raised();
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
  async command(value: unknown) {
    const command = annotationCommand(value);
    if (!this.window || !this.actions.valid(this.packet.token)) throw Error('录制标注已失效');
    if (command.kind === 'interact') {
      if (this.packet.interactive) await this.flush();
      if (!this.window || !this.actions.valid(this.packet.token)) throw Error('录制标注已失效');
      this.packet.interactive = !this.packet.interactive;
    } else if (command.kind === 'tool') {
      this.packet.tool = command.tool;
      this.selectedTool = undefined;
      this.packet.interactive = true;
      if (remembersAnnotationTool(command.tool)) this.packet.style = this.actions.annotationStyles?.()[command.tool] || defaultAnnotationStyle();
    } else if (command.kind === 'style') {
      this.packet.style = command.style;
      const tool = this.selectedTool || this.packet.tool;
      if (remembersAnnotationTool(tool)) await this.actions.saveAnnotationStyle?.(tool,command.style);
      if (!this.window || !this.actions.valid(this.packet.token)) return;
    }
    this.window.setFocusable(this.packet.interactive);
    // Changing focusability updates native extended styles on Windows.
    this.window.setSkipTaskbar(true);
    this.window.setIgnoreMouseEvents(!this.packet.interactive);
    const current = this.window.getContentBounds();
    this.syncPosition(screen.dipToScreenRect(null, current));
    this.send(command);
    this.actions.raised();
  }
  syncPosition(rect: Rectangle | null) {
    const window = this.window;
    if (!window || window.isDestroyed() || !rect) return;
    const next = screen.screenToDipRect(null, rect),
      old = window.getContentBounds();
    if (
      ['x', 'y', 'width', 'height'].some(
        (key) => next[key as keyof Rectangle] !== old[key as keyof Rectangle],
      )
    )
      window.setContentBounds(next, false);
    // Carve native input holes around controls: a full-monitor annotation window
    // must never intercept toolbar/menu clicks, regardless of activation order.
    let pieces: Rectangle[] = [{ x: 0, y: 0, width: next.width, height: next.height }];
    for (const control of this.actions.controls()) {
      const cut = { ...control, x: control.x - next.x, y: control.y - next.y };
      pieces = pieces.flatMap((r) => {
        const x = Math.max(r.x, cut.x),
          y = Math.max(r.y, cut.y),
          right = Math.min(r.x + r.width, cut.x + cut.width),
          bottom = Math.min(r.y + r.height, cut.y + cut.height);
        if (right <= x || bottom <= y) return [r];
        return [
          { x: r.x, y: r.y, width: r.width, height: y - r.y },
          { x: r.x, y: bottom, width: r.width, height: r.y + r.height - bottom },
          { x: r.x, y, width: x - r.x, height: bottom - y },
          { x: right, y, width: r.x + r.width - right, height: bottom - y },
        ].filter((part) => part.width > 0 && part.height > 0);
      });
    }
    const signature = JSON.stringify(pieces);
    if (signature !== this.shape) {
      window.setShape(pieces);
      this.shape = signature;
    }
  }
  private shape = '';
  private send(command?: AnnotationCommand, flush?: string) {
    this.window?.webContents.send('one:recording-annotation-changed', {
      ...this.packet,
      command,
      flush,
    });
  }
  flush(): Promise<void> {
    if (!this.window) return Promise.resolve();
    if (this.flushTask) return this.flushTask;
    const window = this.window;
    const task = (async () => {
      await this.loaded;
      if (this.window !== window || window.isDestroyed()) throw Error('标注会话已关闭');
      await new Promise<void>((resolve, reject) => {
        const id = randomUUID(),
          timer = setTimeout(() => {
            if (this.pendingFlush?.id === id) {
              this.pendingFlush = undefined;
              reject(Error('标注提交超时，已保留确认过的标注'));
            }
          }, 4000);
        this.pendingFlush = { id, resolve, reject, timer };
        this.send(undefined, id);
      });
    })();
    this.flushTask = task;
    void task
      .finally(() => {
        if (this.flushTask === task) this.flushTask = undefined;
      })
      .catch(() => {});
    return task;
  }
  close() {
    this.selectedTool = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush.timer);
      this.pendingFlush.reject(Error('标注会话已关闭'));
      this.pendingFlush = undefined;
    }
    const window = this.window;
    this.window = undefined;
    this.loaded = undefined;
    this.flushTask = undefined;
    this.packet.token = '';
    this.packet.interactive = false;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
