import { t as tr } from '../../shared/capture/i18n';
import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageDimensions } from '../../shared/capture/image-limits';
import { validateImageDocument, type ImageDocument } from '../../shared/capture/image-document';
import { readImageProject, writeImageProject } from './image-project';
import { imageProject } from '../../shared/capture/image-project';
import type { ImageSaveRequest } from '../../shared/capture/image-editor-api';
import { outputLayout } from '../../shared/capture/image-output';
import type {ImageMaterialDetail as Detail} from '../../shared/materials';
import type {InstalledFont} from '../../shared/fonts';
import {IMAGE_PROJECT_FORMAT} from '../../shared/media-project';
type Payload={png:string};
import { decodePng, pngDimensions } from './clipboard';
import { saveImage } from './image-export';
import { chooseWatermarkImage } from './watermark-image';
import { defaultWatermarkPreset, watermarkPreset, type WatermarkPreset } from '../../shared/capture/watermark';
export interface ImageEditorContext {
  /** One supplies the role, restricted preload, icon and common window policies. */
  createWindow(): BrowserWindow;
  register(name:string, handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  confirmClose(window:BrowserWindow):Promise<boolean>;
  fonts():Promise<InstalledFont[]>;
  autosaveProject?(
    id: string,
    project: import('../../shared/capture/image-project').ImageProject,
    original: Buffer,
  ): Promise<void>;
  sensitive?: import('../../shared/recognition/sensitive-api').SensitiveAPI;
  watermark?(): WatermarkPreset;
  saveWatermark?(value: WatermarkPreset): Promise<unknown>;
  recognize?(png: Buffer, title: string): Promise<void>;
  closed?(): void;
  blocked(): boolean;
  dark(): boolean;
  get(id: string): Promise<Detail>;
  current?(id: string, hash: string): boolean;
  protect(path: string): void;
  commit(
    id: string,
    hash: string,
    payload: Payload,
    mode: 'asset' | 'copy',
    valid: () => boolean,
    project?: import('../../shared/capture/image-project').ImageProject,
    original?: Buffer,
  ): Promise<string>;
  background<T>(task: Promise<T>): Promise<T>;
  commitTransient?(
    title: string,
    payload: Payload,
    mode: 'asset' | 'copy',
    valid: () => boolean,
    project?: import('../../shared/capture/image-project').ImageProject,
    original?: Buffer,
  ): Promise<string>;
}
export const IMAGE_EDITOR_URL = 'one://app/index.html?view=image-editor';
export class ImageEditorService {
  window?: BrowserWindow;
  private source?: {
    id: string;
    hash: string;
    name: string;
    size: { width: number; height: number };
    transient: boolean;
  };
  private png?: Buffer;
  private document?: ImageDocument;
  private history?: import('../../shared/capture/image-document').ImageHistoryState;
  private materialId = '';
  private token = '';
  private openedAt = 0;
  private generation = 0;
  private dirty = false;
  private busy = false;
  private closing = false;
  private opening = false;
  constructor(private ctx: ImageEditorContext) {
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      ctx.register('image-project-' + name, (event, ...args) => {
        if (ctx.blocked() || !this.window || event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== IMAGE_EDITOR_URL)
          throw new Error(tr('拒绝访问图片编辑'));
        return ctx.background(Promise.resolve().then(() => {
          if(ctx.blocked() || !this.window || event.sender !== this.window.webContents)
            throw new Error(tr('图片编辑已失效'));
          return fn(...args);
        }));
      });
    handle('state', () => ({
      token: this.token,
      url: 'one-file://image-editor/' + this.token,
      name: this.source?.name || '',
      dark: ctx.dark(),
      width: this.source?.size.width || 0,
      height: this.source?.size.height || 0,
      document: this.document,
      history: this.history,
      watermark: this.ctx.watermark?.() || defaultWatermarkPreset(),
      openedAt: this.openedAt,
    }));
    handle('dirty', (token, value) => {
      if (token !== this.token || typeof value !== 'boolean' || this.busy)
        throw new Error(tr('图片编辑状态无效'));
      this.dirty = value;
    });
    handle('save', (request) => this.save(request));
    handle('project', (token, document, history) => this.saveProject(token, document, history));
    handle('fonts', () => ctx.fonts());
    handle('watermark', (token, value) => {
      if (!token || token !== this.token || this.busy) throw Error('图片编辑已失效');
      return this.ctx.saveWatermark?.(watermarkPreset(value));
    });
    handle('watermark-image', async (token) => {
      if (!token || token !== this.token || this.busy) throw Error('图片编辑已失效');
      const window = this.window!;
      this.busy = true;
      try {
        return await chooseWatermarkImage(
          window,
          () =>
            token === this.token &&
            this.window === window &&
            !window.isDestroyed() &&
            !this.ctx.blocked(),
        );
      } finally {
        if (this.token === token) this.busy = false;
      }
    });
    handle('sensitive', async (token, png) => {
      if (!token || token !== this.token || this.busy || this.ctx.blocked())
        throw Error('图片编辑已失效');
      if (!this.ctx.sensitive) throw Error('敏感文字识别不可用');
      this.busy = true;
      const generation = this.generation;
      try {
        const result = await this.ctx.sensitive.scanSensitive(token, png);
        this.live(generation);
        return result;
      } finally {
        if (generation === this.generation) this.busy = false;
      }
    });
    handle('sensitive-cancel', (token) => {
      if (!token || token !== this.token) throw Error('图片编辑已失效');
      return this.ctx.sensitive?.cancelSensitive(token);
    });
  }
  /** The One session guard checks owner and frame before dispatch. */
  authorize(url:string,owner:number){
    return !!this.token && !!this.png && !this.ctx.blocked() && !!this.window &&
      !this.window.isDestroyed() && this.window.webContents.id===owner &&
      url==='one-file://image-editor/'+this.token;
  }
  resource(request:Request){
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    if(!this.window||!this.authorize(request.url,this.window.webContents.id))return new Response(null,{status:404});
    return new Response(request.method==='HEAD'?null:new Uint8Array(this.png!),{headers:{
      'Content-Type':'image/png','Content-Length':String(this.png!.length),
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app',
    }});
  }
  get hasUnsaved() {
    return this.dirty || this.busy;
  }
  get available() {
    return !this.opening && (!this.window || this.window.isDestroyed()) && !this.ctx.blocked();
  }
  async open(id: string) {
    if (this.opening) throw new Error(tr('正在打开图片，请稍后'));
    this.opening = true;
    try {
      return await this.openImage(id);
    } finally {
      this.opening = false;
    }
  }
  async openTransient(png: Buffer, title: string) {
    if (this.opening) throw new Error(tr('正在打开图片，请稍后'));
    this.opening = true;
    try {
      await this.openImage(randomUUID(), { png, title });
    } finally {
      this.opening = false;
    }
  }
  async openProject(parent?: BrowserWindow, file?: string, materialId = '') {
    if (this.opening) throw Error('正在打开图片，请稍后');
    if (this.ctx.blocked()) throw Error('图片编辑暂不可用');
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      throw Error('请先关闭当前图片编辑，再打开图片工程');
    }
    this.opening = true;
    const generation = this.generation;
    let png: Buffer | undefined;
    try {
      if (!file) {
        const options = {
          title: '打开图片工程',
          properties: ['openFile'] as ['openFile'],
          filters: [{ name: 'One 图片工程', extensions: ['oneimage'] }],
        };
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0]) return;
        file = result.filePaths[0];
      }
      const loaded = await readImageProject(
        file,
        () => generation === this.generation && !this.ctx.blocked(),
      );
      png = loaded.png;
      await this.openImage(randomUUID(), {
        png,
        title: loaded.project.name,
        document: loaded.project.document,
        history: loaded.project.history,
      });
      this.materialId = materialId;
    } finally {
      png?.fill(0);
      this.opening = false;
    }
  }
  private async openImage(
    id: string,
    transient?: {
      png: Buffer;
      title: string;
      document?: ImageDocument;
      history?: import('../../shared/capture/image-document').ImageHistoryState;
    },
  ) {
    if (this.ctx.blocked()) throw new Error(tr('图片编辑暂不可用'));
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      if (this.source?.id !== id) throw new Error(tr('请先关闭当前图片编辑，再打开另一张图片'));
      return;
    }
    const generation = this.generation,
      item = transient
        ? {
            id,
            hash: '',
            title: transient.title,
            payload: { png: transient.png.toString('base64') },
          }
        : await this.ctx.get(id);
    if (generation !== this.generation || this.ctx.blocked()) throw new Error(tr('图片编辑已取消'));
    if (!item.payload.png) throw new Error(tr('请打开图片素材'));
    const header = pngDimensions(item.payload.png);
    imageDimensions(header.width, header.height);
    const { data: png, size } = decodePng(item.payload.png);
    imageDimensions(size.width, size.height);
    try {
      this.document = transient?.document
        ? validateImageDocument(transient.document, size)
        : undefined;
    } catch (error) {
      png.fill(0);
      throw error;
    }
    this.history = transient?.history;
    this.png = png;
    this.token = randomUUID();
    this.openedAt = Date.now();
    this.source = { id, hash: item.hash, name: item.title, size, transient: !!transient };
    let window:BrowserWindow;
    try {window=this.ctx.createWindow();}
    catch(error){this.abort();throw error;}
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    window.webContents.on('render-process-gone', () => this.abort());
    window.on('close', (e) => {
      e.preventDefault();
      if (this.busy) return;
      if (!this.hasUnsaved) {
        this.abort();
        return;
      }
      if (this.closing) return;
      this.closing = true;
      const generation = this.generation;
      void this.ctx.confirmClose(window)
        .then((result) => {
          if (generation === this.generation && result) this.abort();
        })
        .catch(() => {})
        .finally(() => {
          if (generation === this.generation) this.closing = false;
        });
    });
    window.on('closed', () => {
      if (this.window === window) this.abort();
    });
    try {
      await window.loadURL(IMAGE_EDITOR_URL);
      if (!window.isDestroyed() && !this.ctx.blocked()) window.show();
    } catch (e) {
      this.abort();
      throw e;
    }
  }
  private live(generation: number) {
    if (generation !== this.generation || this.ctx.blocked() || !this.source)
      throw new Error(tr('图片编辑已取消'));
    if (
      !this.source.transient &&
      this.ctx.current &&
      !this.ctx.current(this.source.id, this.source.hash)
    )
      throw new Error(tr('原图内容已改变，请重新打开图片'));
  }
  private async save(value: unknown) {
    if (this.busy) throw new Error(tr('正在保存，请稍后'));
    const request = value as ImageSaveRequest;
    if (!request || request.token !== this.token) throw Error('图片编辑请求已失效');
    const mode = request.mode;
    if (!['asset', 'copy', 'export', 'ocr'].includes(mode as string))
      throw new Error(tr('保存方式无效'));
    const generation = this.generation;
    this.live(generation);
    const document = validateImageDocument(request.document, this.source!.size);
    const project = imageProject(
      { format: IMAGE_PROJECT_FORMAT.id, version: 1, name: this.source!.name.slice(0, 180), document, history: request.history },
      this.source!.size,
    );
    if (
      !document.selection ||
      document.selection.x !== 0 ||
      document.selection.y !== 0 ||
      document.selection.width !== document.width ||
      document.selection.height !== document.height
    )
      throw Error('请先应用或取消裁剪选区');
    const payload = { png: request.png },
      header = pngDimensions(payload.png!);
    const layout = outputLayout(document.width, document.height, document.effects);
    if (header.width !== layout.width || header.height !== layout.height)
      throw Error('输出尺寸与编辑文档不符');
    const { data, size } = decodePng(payload.png!);
    try {
      imageDimensions(size.width, size.height);
    } catch (error) {
      data.fill(0);
      throw error;
    }
    if (mode !== 'ocr') data.fill(0);
    this.busy = true;
    try {
      if (this.materialId && this.ctx.autosaveProject)
        await this.ctx.autosaveProject(this.materialId, project, this.png!);
      if (mode === 'ocr') {
        try {
          if (!this.ctx.recognize) throw Error('文字识别不可用');
          await this.ctx.recognize(data, this.source!.name);
          this.live(generation);
          return '已打开文字识别';
        } finally {
          data.fill(0);
        }
      }
      if (mode !== 'export') {
        const result = this.source!.transient
          ? await this.ctx.commitTransient!(
              this.source!.name,
              payload,
              mode as 'asset' | 'copy',
              () => generation === this.generation && !this.ctx.blocked(),
              project,
              this.png!,
            )
          : await this.ctx.commit(
              this.source!.id,
              this.source!.hash,
              payload,
              mode as 'asset' | 'copy',
              () => generation === this.generation && !this.ctx.blocked(),
              project,
              this.png!,
            );
        this.live(generation);
        if (mode === 'asset') this.dirty = false;
        return result;
      }
      const result = await saveImage(
        this.window!,
        { payload },
        (file) => this.ctx.protect(file),
        () => {
          this.live(generation);
          return true;
        },
        {
          title: tr('编辑图片另存为'),
          defaultPath:
            'One-edit-' + new Date().toISOString().replaceAll(':', '-').slice(0, 19) + '.png',
          pngExtension: true,
        },
      );
      if (result !== null && generation === this.generation) this.dirty = false;
      return result;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  private async saveProject(token: unknown, document: unknown, history?: unknown) {
    if (this.busy) throw Error('正在保存，请稍后');
    if (token !== this.token) throw Error('图片编辑请求已失效');
    const generation = this.generation;
    this.live(generation);
    const project = imageProject(
      { format: IMAGE_PROJECT_FORMAT.id, version: 1, name: this.source!.name.slice(0, 180), document, history },
      this.source!.size,
    );
    this.busy = true;
    try {
      const result = await dialog.showSaveDialog(this.window!, {
        title: '保存图片工程',
        defaultPath: 'One-edit.oneimage',
        filters: [{ name: 'One 图片工程', extensions: ['oneimage'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const file = result.filePath.toLowerCase().endsWith('.oneimage')
        ? result.filePath
        : result.filePath + '.oneimage';
      this.ctx.protect(file);
      this.live(generation);
      await writeImageProject(file, project, this.png!, () => {
        this.live(generation);
        return true;
      });
      this.live(generation);
      this.document = project.document;
      this.history = project.history;
      if (this.materialId && this.ctx.autosaveProject)
        await this.ctx.autosaveProject(this.materialId, project, this.png!);
      this.dirty = false;
      return basename(file);
    } finally {
      if (generation === this.generation) this.busy = false;
    }
  }

  abort() {
    if (this.token) void this.ctx.sensitive?.cancelSensitive(this.token).catch(() => {});
    const hadSession = !!this.window || !!this.source;
    this.closing = false;
    this.generation++;
    this.dirty = false;
    this.busy = false;
    this.source = undefined;
    this.document = undefined;
    this.history = undefined;
    this.materialId = '';
    this.token = '';
    this.png?.fill(0);
    this.png = undefined;
    const window = this.window;
    this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    if (hadSession) this.ctx.closed?.();
  }
}
