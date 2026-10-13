import {
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, join, resolve, isAbsolute } from 'node:path';
import { PinStore } from './store';
import {
  pinBounds,
  pinSize,
  pinBase,
  initialPinView,
  clampPin,
  zoomPin,
  pinName,
  PIN_VISIBLE_LIMIT,
  PIN_FILE_LIMIT,
  type PinContent,
  type PinPlacement,
  type PinRecord,
  type PinAction,
  type PinGroupAction,
  type PinWindowState,
} from '../../shared/pins';
import { decodePng, writeClipboardPng } from '../capture/clipboard';
import { copyFilesToClipboard } from '../file-clipboard';
import { saveImage } from '../capture/image-export';
import type { Rectangle } from '../../shared/capture/region';
import { atomicWrite } from '../materials/atomic-file';
import { IMAGE_PIXELS } from '../../shared/capture/image-limits';

type Presentation = {
  window: BrowserWindow;
  token: string;
  id: string;
  size?: { width: number; height: number };
};
type Drag = { owner: string; pins: Map<string, Rectangle>; start: { x: number; y: number } };
export const PIN_URL='one://app/index.html?view=pin',PIN_CONTROLS_URL='one://app/index.html?view=pin-controls';
export interface PinContext {
  createWindow(view:'pin'|'pin-controls',options:Electron.BrowserWindowConstructorOptions):BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  mainWindow():BrowserWindow|undefined;dark():boolean;blocked():boolean;
  uiScale():import('../../shared/capture/settings').CapturePreferences['uiScale'];
  icon():Electron.NativeImage;
}
export class PinService {
  private entries = new Map<string, Presentation>();
  private controls?: Presentation;
  private drags = new Map<string, Drag>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private hiddenIds: string[] = [];
  private cycleGroup: string | null | undefined;
  private previews = new Map<string, string>();
  private showing = new Set<string>();
  private store: PinStore;
  private closing=false;
  private stopping?:Promise<void>;
  constructor(
    directory: string,
    private changed: () => void,
    private protect: (file: string) => void,
    private failed: (error: unknown) => void,
    private ctx:PinContext,
  ) {
    this.store = new PinStore(directory);
    const owner = (e: IpcMainInvokeEvent) => {
      const entry = [...this.entries.values(), ...(this.controls ? [this.controls] : [])].find(
        (p) => p.window.webContents === e.sender && !p.window.isDestroyed(),
      );
      if (
        !entry ||
        e.senderFrame !== e.sender.mainFrame ||
        ![PIN_URL,PIN_CONTROLS_URL].includes(e.senderFrame.url) ||
        this.disposed || this.closing || this.ctx.blocked()
      )
        throw Error('拒绝访问贴图');
      return entry;
    };
    ctx.register('pins-window-state', (e) => this.windowState(owner(e)));
    ctx.register('pins-window-action', (e, action: PinAction) => this.action(owner(e).id, action));
    ctx.register('pins-window-drag', (e, phase, group) => {
      const entry = owner(e);
      if (entry === this.controls) throw Error('这个窗口不能移动贴图');
      return this.drag(entry, phase, group);
    });
    ctx.register('pins-window-controls-height', (e, height) => {
      const entry = owner(e);
      if (entry !== this.controls || !Number.isSafeInteger(height) || height < 100 || height > 2000)
        throw Error('贴图面板尺寸无效');
      const bounds = entry.window.getContentBounds(),
        area = screen.getDisplayMatching(bounds).workArea;
      entry.window.setContentBounds({
        ...bounds,
        width: entry.size!.width,
        height: Math.min(height, area.height - 16),
        y: Math.max(
          area.y + 8,
          Math.min(bounds.y, area.y + area.height - Math.min(height, area.height - 16) - 8),
        ),
      });
    });
  }
  authorize(url:string,owner:number){
    return !this.disposed&&!this.closing&&!this.ctx.blocked()&&[...this.entries.values(),...(this.controls?[this.controls]:[])].some(entry=>
      !entry.window.isDestroyed()&&entry.window.webContents.id===owner&&[PIN_URL,PIN_CONTROLS_URL].includes(entry.window.webContents.getURL())&&url==='one-file://pins/'+entry.token);
  }
  async resource(request:Request){
    const entry=[...this.entries.values(),...(this.controls?[this.controls]:[])].find(entry=>request.url==='one-file://pins/'+entry.token&&!entry.window.isDestroyed());
    if(!entry||this.disposed||this.closing)return new Response(null,{status:404});
    try{const png=await this.store.read(entry.id);if(entry.window.isDestroyed()||this.disposed)return new Response(null,{status:404});
      return new Response(new Uint8Array(png),{headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
    }catch(error){this.failed(error);return new Response(null,{status:404});}
  }
  init() {
    return this.store.init();
  }
  workspace() {
    return this.store.snapshot();
  }
  preferencesChanged(){this.notify();}
  async preview(id: string) {
    const p = this.store.get(id);
    if (p.content.kind !== 'image') return null;
    const key = p.content.hash;
    const cached = this.previews.get(key);
    if (cached) return cached;
    const image = nativeImage.createFromBuffer(await this.store.read(id));
    if (image.isEmpty()) throw Error('无法读取贴图预览');
    const size = image.getSize(),
      scale = Math.min(1, 480 / size.width, 300 / size.height);
    const result = image
      .resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
      })
      .toDataURL();
    if (this.previews.size >= 80) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(key, result);
    return result;
  }
  private async hideAll() {
    await this.store.change((w) => {
      for (const p of w.pins) {
        p.view.visible = false;
        p.view.passThrough = false;
      }
    });
    this.drags.clear();
    this.controls?.window.hide();
    for (const p of this.store.snapshot().pins) this.apply(p);
  }
  private async displayOnly(ids: string[]) {
    if (ids.length > PIN_VISIBLE_LIMIT) throw Error('最多同时显示 20 个贴图，请拆分到不同分组');
    for (const id of ids) {
      this.capacity(this.store.get(id));
      if (this.store.get(id).content.kind === 'image') await this.store.read(id);
    }
    const previous = this.store
      .snapshot()
      .pins.filter((p) => p.view.visible)
      .map((p) => p.id);
    await this.hideAll();
    try {
      for (const id of ids) await this.show(id);
    } catch (error) {
      await this.hideAll();
      for (const id of previous) await this.show(id).catch(this.failed);
      throw error;
    } finally {
      this.notify();
    }
  }
  toggleAll() {
    return this.serial(async () => {
      const workspace = this.store.snapshot(),
        visible = workspace.pins.filter((p) => p.view.visible);
      if (visible.length) {
        this.hiddenIds = visible.map((p) => p.id);
        await this.hideAll();
        this.notify();
      } else {
        const restored = this.hiddenIds.filter((id) => workspace.pins.some((p) => p.id === id));
        await this.displayOnly(restored.length ? restored : workspace.pins.map((p) => p.id));
      }
    });
  }
  nextGroup() {
    return this.serial(async () => {
      const w = this.store.snapshot(),
        groups = [null, ...w.groups.map((g) => g.id)].filter((id) =>
          w.pins.some((p) => p.group === id),
        );
      if (!groups.length) return;
      const visible = w.pins.filter((p) => p.view.visible),
        current =
          visible.length && visible.every((p) => p.group === visible[0].group)
            ? visible[0].group
            : this.cycleGroup;
      const index = current === undefined ? -1 : groups.indexOf(current);
      const next = groups[(index + 1) % groups.length];
      await this.displayOnly(w.pins.filter((p) => p.group === next).map((p) => p.id));
      this.cycleGroup = next;
      this.hiddenIds = w.pins.filter((p) => p.group === next).map((p) => p.id);
    });
  }
  windows() {
    return [...this.entries.values()].map((p) => p.window);
  }
  private serial<T>(work: () => Promise<T>) {
    if(this.closing||this.ctx.blocked())return Promise.reject<T>(Error('贴图服务已退出'));
    const next = this.queue
      .catch(() => {})
      .then(() => {
        if (this.disposed) throw Error('贴图服务已退出');
        return work();
      });
    this.queue = next;
    return next;
  }
  private windowState(entry: Presentation): PinWindowState {
    const record = this.store.get(entry.id);
    return {
      record,
      uiScale:this.ctx.uiScale(),
      groups: this.store.snapshot().groups,
      image: record.content.kind === 'image' ? 'one-file://pins/' + entry.token : undefined,
    };
  }
  private notify() {
    for (const e of [...this.entries.values(), ...(this.controls ? [this.controls] : [])]) {
      if (!e.window.isDestroyed())
        e.window.webContents.send('one:pins-window-changed', this.windowState(e));
    }
    this.changed();
  }
  private place(record: PinRecord) {
    const bounds = pinBounds(record.content, record.view);
    const display=screen.getDisplayMatching(bounds),area=record.content.kind==='image'?display.bounds:display.workArea;
    return clampPin(bounds, area);
  }
  private capacity(record: PinRecord) {
    const bounds = pinBounds(record.content, record.view),
      display = screen.getDisplayMatching(bounds);
    if (bounds.width * bounds.height * display.scaleFactor ** 2 > IMAGE_PIXELS)
      throw Error('贴图显示尺寸超过当前屏幕的容量限制，请缩小后重试');
  }
  private apply(record: PinRecord) {
    const entry = this.entries.get(record.id);
    if (!entry || entry.window.isDestroyed()) return;
    const bounds = this.place(record);
    entry.size = { width: bounds.width, height: bounds.height };
    entry.window.setContentBounds(bounds, false);
    entry.window.setOpacity(record.view.opacity);
    entry.window.setIgnoreMouseEvents(record.view.passThrough, { forward: true });
    entry.window.setTitle('One · ' + record.title);
    // Updating geometry/opacity must not raise the image over its controls.
    if (this.controls?.id === record.id && this.controls.window.isVisible())
      this.controls.window.moveTop();
    if (!record.view.visible) entry.window.hide();
    if (!record.view.visible)
      setTimeout(() => {
        if (
          !this.disposed &&
          !entry.window.isDestroyed() &&
          !this.showing.has(record.id) &&
          !this.store.get(record.id).view.visible
        )
          entry.window.destroy();
      }, 250).unref();
  }
  async open(input: { title: string; png?: Buffer; text?: string; files?: string[]; captured?:PinPlacement }) {
    return this.serial(async () => {
      let content: PinContent;
      if (input.png) {
        const { size } = decodePng(input.png.toString('base64'));
        content = { kind: 'image', ...size, hash: await this.store.installImage(input.png) };
      } else if (input.files) {
        if (!input.files.length || input.files.length > PIN_FILE_LIMIT)
          throw Error('文件贴图支持 1–64 个文件');
        const files = [];
        for (const path of [...new Set(input.files)]) {
          if (
            typeof path !== 'string' ||
            !isAbsolute(path) ||
            /[\x00-\x1f]/.test(path) ||
            path.length > 32760
          )
            throw Error('文件路径无效');
          const file = resolve(path),
            info = await stat(file);
          if (!info.isFile() && !info.isDirectory()) throw Error('这个文件类型不能贴出');
          files.push({ path: file, name: basename(file), directory: info.isDirectory() });
        }
        content = { kind: 'files', files };
      } else content = { kind: 'text', text: input.text || '' };
      const point=screen.getCursorScreenPoint(),area=screen.getDisplayNearestPoint(point).workArea;
      const view=initialPinView(content,point,area,input.captured);
      let record: PinRecord;
      try {
        record = await this.store.add(pinName(input.title), content, view);
      } catch (error) {
        await this.store.collect();
        throw error;
      }
      // The content stays recoverable if a renderer cannot be opened.
      await this.show(record.id);
      return record.id;
    });
  }
  private async show(id: string) {
    this.showing.add(id);
    try {
      return await this.showRecord(id);
    } finally {
      this.showing.delete(id);
    }
  }
  private async showRecord(id: string) {
    const record = this.store.get(id);
    this.capacity(record);
    if (
      !record.view.visible &&
      this.store.snapshot().pins.filter((p) => p.view.visible).length >= PIN_VISIBLE_LIMIT
    )
      throw Error('最多同时显示 20 个贴图');
    let entry = this.entries.get(id);
    if (!entry || entry.window.isDestroyed()) {
      for (const old of this.entries.values())
        if (
          !old.window.isDestroyed() &&
          !this.showing.has(old.id) &&
          !this.store.get(old.id).view.visible
        )
          old.window.destroy();
      if (record.content.kind === 'image') {
        const { size } = decodePng((await this.store.read(id)).toString('base64'));
        if (size.width !== record.content.width || size.height !== record.content.height)
          throw Error('贴图原图尺寸不匹配');
      }
      const window = this.ctx.createWindow('pin',{
        ...this.place(record),
        useContentSize: true,
        minWidth:1,minHeight:1,roundedCorners:true,
        frame: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        thickFrame: true,
        hasShadow: true,
        transparent: false,
        backgroundColor: this.ctx.dark() ? '#181818' : '#fff',
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        title: 'One · ' + record.title,
      });
      entry = { window, id, token: randomUUID() };
      this.entries.set(id, entry);
      const presentation = entry;
      // WM_DPICHANGED can resize a window while it crosses monitors. A move
      // must never change the document's requested display scale.
      window.on('resize', () => {
        if (!presentation.size || window.isDestroyed()) return;
        const bounds = window.getContentBounds(),
          size = presentation.size;
        if (Math.abs(bounds.width - size.width) > 1 || Math.abs(bounds.height - size.height) > 1)
          window.setContentBounds({ ...bounds, ...size }, false);
      });
      this.secure(window);
      window.on('close', (event) => {
        if (!this.disposed) {
          event.preventDefault();
          void this.action(id, { kind: 'hide' }).catch(this.failed);
        }
      });
      window.on('closed', () => {
        if (this.entries.get(id)?.window === window) this.entries.delete(id);
      });
      window.webContents.on('render-process-gone', () => {
        if (!window.isDestroyed()) window.destroy();
        void this.serial(async () => {
          await this.store.change((w) => {
            const p = w.pins.find((p) => p.id === id);
            if (p) {
              p.view.visible = false;
              p.view.passThrough = false;
            }
          });
          this.notify();
        }).catch(this.failed);
      });
      try {
        await window.loadURL(PIN_URL);
      } catch (error) {
        window.destroy();
        this.notify();
        throw error;
      }
    }
    await this.store.change((w) => {
      const p = w.pins.find((p) => p.id === id)!;
      p.view.visible = true;
      p.view.passThrough = false;
      const bounds = this.place(p);
      p.view.x = bounds.x;
      p.view.y = bounds.y;
    });
    this.apply(this.store.get(id));
    entry.window.showInactive();
    this.notify();
  }
  private secure(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.on('console-message', (detail) => {
      if (detail.level === 'error') this.failed(Error('贴图：' + detail.message));
    });
  }
  private async openControls(id: string) {
    this.controls?.window.destroy();
    const parent = this.entries.get(id)?.window;
    const point = screen.getCursorScreenPoint(),
      area = screen.getDisplayNearestPoint(point).workArea;
    const width = Math.min(328, area.width - 16),
      height = Math.min(430, area.height - 16);
    const window = this.ctx.createWindow('pin-controls',{
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      x: Math.max(area.x, Math.min(point.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(point.y, area.y + area.height - height)),
      width,
      height,
      useContentSize: true,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      thickFrame: true,
      hasShadow: true,
      backgroundColor: this.ctx.dark() ? '#181818' : '#fff',
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
    });
    this.controls = { window, token: randomUUID(), id, size: { width, height } };
    this.secure(window);
    window.on('closed', () => {
      if (this.controls?.window === window) this.controls = undefined;
    });
    window.on('blur', () => {
      if (!window.isDestroyed()) window.hide();
    });
    await window.loadURL(PIN_CONTROLS_URL);
    if (!window.isDestroyed()) window.show();
  }
  action(id: string, action: PinAction) {
    return this.serial(async () => {
      const record = this.store.get(id);
      if (!action || typeof action !== 'object') throw Error('贴图操作无效');
      if (action.kind === 'controls') {
        await this.openControls(id);
        return;
      }
      if (action.kind === 'show' || action.kind === 'restore') {
        await this.show(id);
        return;
      }
      if (action.kind === 'copy') {
        if (record.content.kind === 'image') await writeClipboardPng(await this.store.read(id));
        else if (record.content.kind === 'text') await clipboard.writeText(record.content.text);
        else {
          await this.files(record);
          copyFilesToClipboard(record.content.files.map((f) => f.path));
        }
        return;
      }
      if (action.kind === 'export') {
        const owner =
          this.entries.get(id)?.window ||
          this.ctx.mainWindow();
        if (!owner) throw Error('工作台已关闭');
        if (record.content.kind === 'image')
          await saveImage(
            owner,
            { payload: { png: (await this.store.read(id)).toString('base64') } },
            this.protect,
            () => !this.disposed,
            { defaultPath: record.title.replace(/[<>:"/\\|?*]/g, '-') + '.png' },
          );
        else if (record.content.kind === 'text') {
          const result = await dialog.showSaveDialog(owner, {
            title: '保存原文',
            defaultPath: record.title.replace(/[<>:"/\\|?*]/g, '-') + '.txt',
            filters: [{ name: '文字', extensions: ['txt'] }],
          });
          if (!result.canceled && result.filePath) {
            this.protect(result.filePath);
            await atomicWrite(result.filePath, record.content.text);
          }
        } else throw Error('文件贴图保存的是原文件引用，请打开文件所在位置');
        return;
      }
      if (['open-file', 'locate-file', 'drag-file'].includes(action.kind)) {
        const index = (action as { index: number }).index;
        if (
          record.content.kind !== 'files' ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= record.content.files.length
        )
          throw Error('文件操作无效');
        const file = record.content.files[index];
        await this.fileExists(file);
        if (action.kind === 'open-file') {
          const error = await shell.openPath(file.path);
          if (error) throw Error(error);
        } else if (action.kind === 'locate-file') shell.showItemInFolder(file.path);
        else {
          const entry = this.entries.get(id);
          if (!entry || !entry.window.isVisible()) throw Error('请先显示文件贴图');
          const image = await appIcon(file.path,this.ctx.icon());
          entry.window.webContents.startDrag({ file: file.path, files: [file.path], icon: image });
        }
        return;
      }
      if (action.kind === 'remove') {
        await this.store.change((w) => {
          w.pins = w.pins.filter((p) => p.id !== id);
        });
        if (this.controls?.id === id) this.controls.window.destroy();
        this.entries.get(id)?.window.destroy();
        this.drags.delete(id);
        await this.store.collect();
        this.notify();
        return;
      }
      const view = record.view,
        previous = pinSize(record.content, view);
      if (
        ['zoom', 'rotate', 'reset'].includes(action.kind) &&
        [...this.drags.values()].some((drag) => drag.pins.has(id))
      )
        return;
      switch (action.kind) {
        case 'hide':
          view.visible = false;
          view.passThrough = false;
          this.drags.delete(id);
          if (this.controls?.id === id) this.controls.window.hide();
          break;
        case 'rotate':
          view.rotation = ((view.rotation + 1) % 4) as 0 | 1 | 2 | 3;
          break;
        case 'flipX':
          view.flipX = !view.flipX;
          break;
        case 'flipY':
          view.flipY = !view.flipY;
          break;
        case 'reset': {
          const base = pinBase(record.content),
            dpi = screen.getDisplayMatching(pinBounds(record.content, view)).scaleFactor;
          view.scale = Math.min(
            1,
            8192 / base.width,
            8192 / base.height,
            Math.sqrt(IMAGE_PIXELS / (base.width * base.height * dpi ** 2)),
          );
          view.rotation = 0;
          view.flipX = view.flipY = false;
          view.opacity = 1;
          view.passThrough = false;
          break;
        }
        case 'zoom':
          record.view = zoomPin(record, action.direction, action.x, action.y);
          break;
        case 'opacity':
          if (!Number.isFinite(action.value) || action.value < 0.2 || action.value > 1)
            throw Error('透明度应为 20–100%');
          view.opacity = action.value;
          break;
        case 'pass':
          if (typeof action.value !== 'boolean' || !view.visible) throw Error('穿透设置无效');
          view.passThrough = action.value;
          if (action.value && this.controls?.id === id) this.controls.window.hide();
          break;
        case 'rename':
          record.title = pinName(action.title);
          break;
        case 'group':
          if (
            action.group !== null &&
            !this.store.snapshot().groups.some((g) => g.id === action.group)
          )
            throw Error('贴图分组不存在');
          record.group = action.group;
          break;
        default:
          throw Error('贴图操作无效');
      }
      if (action.kind === 'rotate' || action.kind === 'reset') {
        const next = pinSize(record.content, record.view);
        record.view.x += Math.round((previous.width - next.width) / 2);
        record.view.y += Math.round((previous.height - next.height) / 2);
      }
      const bounds = this.place(record);
      record.view.x = bounds.x;
      record.view.y = bounds.y;
      this.capacity(record);
      await this.store.change((w) => {
        w.pins[w.pins.findIndex((p) => p.id === id)] = record;
      });
      this.apply(record);
      this.notify();
    });
  }
  private async fileExists(file: Extract<PinContent, { kind: 'files' }>['files'][number]) {
    try {
      const info = await stat(file.path);
      if (info.isDirectory() !== file.directory || (!info.isDirectory() && !info.isFile()))
        throw Error('文件类型已改变');
    } catch {
      throw Error('原文件已移动或删除：' + file.name);
    }
  }
  private async files(record: PinRecord) {
    if (record.content.kind === 'files')
      for (const file of record.content.files) await this.fileExists(file);
  }
  group(id: string | null, action: PinGroupAction) {
    return this.serial(async () => {
      const workspace = this.store.snapshot();
      if (!action || typeof action !== 'object') throw Error('分组操作无效');
      if (action.kind === 'create') {
        await this.store.change((w) =>
          w.groups.push({ id: randomUUID(), name: pinName(action.name) }),
        );
      } else {
        if (id !== null && !workspace.groups.some((g) => g.id === id)) throw Error('分组不存在');
        const pins = workspace.pins.filter((p) => id === null || p.group === id);
        if (action.kind === 'show') {
          const visible = new Set([
            ...workspace.pins.filter((p) => p.view.visible).map((p) => p.id),
            ...pins.map((p) => p.id),
          ]);
          if (visible.size > PIN_VISIBLE_LIMIT) throw Error('最多同时显示 20 个贴图');
          for (const pin of pins) await this.show(pin.id);
        } else if (action.kind === 'hide' || action.kind === 'restore') {
          await this.store.change((w) => {
            for (const p of w.pins)
              if (id === null || p.group === id) {
                if (action.kind === 'hide') p.view.visible = false;
                p.view.passThrough = false;
              }
          });
          if (action.kind === 'hide') {
            this.drags.clear();
            this.controls?.window.hide();
          }
          for (const p of this.store.snapshot().pins) this.apply(p);
        } else if (action.kind === 'rename' && id) {
          await this.store.change((w) => {
            w.groups.find((g) => g.id === id)!.name = pinName(action.name);
          });
        } else if (action.kind === 'remove' && id) {
          await this.store.change((w) => {
            w.groups = w.groups.filter((g) => g.id !== id);
            for (const p of w.pins) if (p.group === id) p.group = null;
          });
        } else throw Error('分组操作无效');
      }
      this.notify();
    });
  }
  private drag(entry: Presentation, phase: unknown, group: unknown) {
    if (phase === 'start') {
      const owner = this.store.get(entry.id);
      if (!owner.view.visible || owner.view.passThrough) throw Error('这个贴图不能移动');
      const pins = new Map<string, Rectangle>();
      for (const p of this.store.snapshot().pins)
        if (
          p.id === entry.id ||
          (group === true && owner.group !== null && owner.group === p.group && p.view.visible)
        ) {
          const window = this.entries.get(p.id)?.window;
          if (window && !window.isDestroyed()) pins.set(p.id, window.getContentBounds());
        }
      this.drags.set(entry.id, { owner: entry.id, pins, start: screen.getCursorScreenPoint() });
      return;
    }
    const drag = this.drags.get(entry.id);
    if (phase === 'move') {
      if (!drag) throw Error('贴图移动参数无效');
      const point = screen.getCursorScreenPoint(),
        dx = point.x - drag.start.x,
        dy = point.y - drag.start.y;
      const area = screen.getDisplayNearestPoint(point).workArea,
        originalOwner = drag.pins.get(entry.id)!;
      const ownerBounds = clampPin(
        { ...originalOwner, x: originalOwner.x + dx, y: originalOwner.y + dy },
        area,
      );
      const offsetX = ownerBounds.x - originalOwner.x,
        offsetY = ownerBounds.y - originalOwner.y;
      for (const [id, original] of drag.pins) {
        const pin = this.entries.get(id);
        if (pin && !pin.window.isDestroyed()) {
          const size = pin.size || { width: original.width, height: original.height };
          pin.window.setContentBounds(
            { x: original.x + offsetX, y: original.y + offsetY, ...size },
            false,
          );
        }
      }
      return;
    }
    if (phase !== 'end') throw Error('贴图移动状态无效');
    this.drags.delete(entry.id);
    if (!drag) return;
    const positions = new Map(
      [...drag.pins.keys()].flatMap((id) => {
        const window = this.entries.get(id)?.window;
        return window && !window.isDestroyed() ? [[id, window.getContentBounds()] as const] : [];
      }),
    );
    return this.serial(async () => {
      await this.store.change((w) => {
        for (const p of w.pins) {
          const pos = positions.get(p.id);
          if (pos) {
            p.view.x = pos.x;
            p.view.y = pos.y;
          }
        }
      });
      this.notify();
    });
  }
  dispose(){
    if(this.stopping)return this.stopping;this.closing=true;
    return this.stopping=this.finish();
  }
  private async finish() {
    await this.queue.catch(this.failed);
    this.disposed = true;
    this.controls?.window.destroy();
    for (const p of this.entries.values()) if (!p.window.isDestroyed()) p.window.destroy();
    this.entries.clear();
    await this.store.flush();
  }
}
async function appIcon(file: string,fallback:Electron.NativeImage) {
  const { app } = await import('electron');
  try {
    const icon = await app.getFileIcon(file, { size: 'normal' });
    if (!icon.isEmpty()) return icon;
  } catch {}
  return fallback;
}
