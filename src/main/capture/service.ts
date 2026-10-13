import { annotationStylePreference, type AnnotationPreferencesHost } from '../../shared/capture/annotation-preferences';
import { flushDesktopComposition } from './native';
import { type BrowserWindow, clipboard, desktopCapturer, screen } from 'electron';
import { ScrollNative, captureMonitorBounds } from './scroll-native';
import { chooseWatermarkImage } from './watermark-image';
import { watermarkPreset, type WatermarkPreset } from '../../shared/capture/watermark';
import { randomUUID } from 'node:crypto';
import {
  captureWindowInfo,
  physicalCursor,
  movePhysicalCursor,
  disableWindowTransitions,
} from './native';
import { CaptureProbe } from './capture-probe';
import {
  captureCandidates,
  capturePoint,
  desktopCapturePoint,
  previewCapturePoint,
} from '../../shared/capture/capture-detection';
import { decodePng, pngDimensions } from './clipboard';
import { displaySignature, type Region, type Rectangle } from '../../shared/capture/region';
import { captureRequest, type CaptureAction, type CaptureData } from '../../shared/capture/capture-session';
import { imageDimensions } from '../../shared/capture/image-limits';
import { CAPTURE_WINDOWS, windowPlacements } from '../../shared/capture/capture-window-layout';
import { captureWindowFrames } from './capture-window-frames';
import { freezeCaptureSnapshot, checkSnapshotRefresh, type CaptureSnapshot as Snapshot } from './capture-snapshot';
import {
  captureDesktopFrames,
  desktopSignature,
  type DesktopMonitor,
} from './capture-desktop-frames';
import { outputLayout } from '../../shared/capture/image-output';
import {
  workflowsFrom,
  type CaptureWorkflow,
  type CaptureResult,
} from '../../shared/capture/capture-workflow';
import { CaptureDelivery } from './capture-delivery';
import {capturePinBounds} from '../../shared/capture/pin-placement';
import { customCaptureSelection, type CustomCapture } from '../../shared/capture/custom-capture';

export const CAPTURE_URL='one://app/index.html?view=capture';

interface CaptureRun {
  token: string;
  overlay: BrowserWindow;
  shot: Snapshot;
  purpose: 'capture' | 'region';
  regionHint?: 'recording' | 'scroll';
  selected: boolean;
  initialSelection?: Rectangle;
  autoCopy?: boolean;
  selectionMode?: 'rectangle' | 'free' | 'polygon';
  workflows: CaptureWorkflow[];
  workflowId: string;
  delivery: CaptureDelivery;
  busy: 'refresh' | 'output' | 'watermark' | 'sensitive' | null;
  probe: CaptureProbe;
  detectionRevision: number;
  remoteCompatible: boolean;
  imageRevision: number;
  nextImageRevision: number;
  candidate?: { shot: Snapshot; revision: number };
  ended: boolean;
  startupError?: string;
  painted(): void;
  refresh(): Promise<Snapshot>;
  finish(value: Region | null): void;
}
export interface CaptureHost extends AnnotationPreferencesHost {
  createWindow(options:Electron.BrowserWindowConstructorOptions):BrowserWindow;
  register(name:string,handler:(event:Electron.IpcMainInvokeEvent,...args:any[])=>unknown):void;
  fonts():Promise<import('../../shared/fonts').InstalledFont[]>;
  uiScale():import('../../shared/capture/settings').CapturePreferences['uiScale'];
  blocked():boolean;
  archive?(
    png: Buffer,
    document?: import('../../shared/capture/image-document').ImageDocument,
    original?: Buffer,
    history?: import('../../shared/capture/image-document').ImageHistoryState,
  ): Promise<void>;
  sensitive?: import('../../shared/recognition/sensitive-api').SensitiveAPI;
  timing?(value: { acquireMs: number; displayMs: number; totalMs: number; warmed: boolean }): void;
  remoteCompatible?(): boolean;
  watermark(): WatermarkPreset;
  saveWatermark(value: WatermarkPreset): Promise<void>;
  deliver(
    window: BrowserWindow,
    png: Buffer,
    action: CaptureAction,
    workflow?: CaptureWorkflow,
    owner?: string,
    captured?: import('../../shared/pins').PinPlacement,
  ): Promise<boolean>;
  cancelWorkflow?(owner: string): Promise<void>;
  workflows(): { workflows: CaptureWorkflow[]; workflowId: string };
  failed(error: unknown): void;
}
interface PreparedCapture {
  overlay: BrowserWindow;
  loaded: Promise<void>;
  data: Promise<CaptureData | null>;
  provide(value: CaptureData | null): void;
  probe: CaptureProbe;
  capture?: { displayId: number; signature: string; native: ScrollNative };
}
/** A session owns its original, selection, annotations and output until confirmed or cancelled. */
export class CaptureService {
  private selectedFonts=new Set<string>();
  private pending=new Set<Promise<unknown>>();
  private closing=false;
  private stopping?:Promise<void>;
  private warm?: PreparedCapture;
  private captureNative?: ScrollNative;
  private choices = new Map<
    string,
    { id: string; pid: number; hwnd: number; name: string; created: number }
  >();
  private generation = 0;
  private listing = 0;
  private run?: CaptureRun;
  private acquisition?: AbortController;
  private outcome?: CaptureResult;
  active = false;
  constructor(private readonly host: CaptureHost) {
    const register=(name:string,handler:(event:Electron.IpcMainInvokeEvent,...args:any[])=>unknown)=>host.register(name,(event,...args)=>{
      if(this.closing||host.blocked())throw Error('截图服务已关闭');
      const value=handler(event,...args);
      // A warmed renderer may wait for capture-data until the next capture.
      if(name!=='capture-data'&&value instanceof Promise){this.pending.add(value);void value.then(()=>this.pending.delete(value),()=>this.pending.delete(value));}
      return value;
    });
    const session = (event: Electron.IpcMainInvokeEvent) => {
      const current = this.run;
      if (
        !current || current.ended ||
        event.sender !== current.overlay.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== CAPTURE_URL
      )
        throw Error('截图会话已关闭');
      return current;
    };
    register('capture-data', (e) => {
      const warm = this.warm;
      if (
        warm &&
        e.sender === warm.overlay.webContents &&
        e.senderFrame === e.sender.mainFrame &&
        e.senderFrame.url === CAPTURE_URL
      )
        return warm.data.then((value) => {
          if (!value) throw Error('截图已取消');
          return value;
        });
      return this.data(session(e));
    });
    register('capture-ready', async (e, token, failure) => {
      const current = session(e);
      if (token !== current.token) throw Error('截图会话已关闭');
      if (failure) current.startupError = String(failure).slice(0, 500);
      else {
        try {
          // Canvas commands being submitted is earlier than Chromium publishing
          // the composited frame. Flush a tiny copy while the window stays hidden
          // so show() cannot briefly expose the window's empty dark background.
          const frame = await e.sender.capturePage(
            { x: 0, y: 0, width: 1, height: 1 },
            { stayHidden: true },
          );
          if (frame.isEmpty()) throw Error('截图界面首帧合成失败');
        } catch (error) {
          current.startupError = error instanceof Error ? error.message : String(error);
        }
      }
      current.painted();
    });
    register('capture-fonts', (e) => {
      session(e);
      return host.fonts();
    });
    register('capture-select-font',async(event,token,family)=>{
      const current=session(event);
      if(token!==current.token||typeof family!=='string'||family.length>256)throw Error('字体选择无效');
      const fonts=await host.fonts();
      if(this.run!==current||current.ended||this.closing||host.blocked())throw Error('截图会话已关闭');
      if(!fonts.some(font=>font.family===family))return false;
      this.selectedFonts.add(family);return true;
    });
    register('capture-color', (e, token, value: unknown) => {
      const current = session(e);
      if (token !== current.token || current.busy || typeof value !== 'string')
        throw Error('截图取色已失效');
      const rgb = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/.exec(value);
      if (!/^#[0-9a-f]{6}$/i.test(value) && !(rgb && rgb.slice(1).every((v) => Number(v) <= 255)))
        throw Error('颜色值无效');
      clipboard.writeText(value);
    });
    register('capture-watermark', (e, token, value) => {
      if (token !== session(e).token) throw Error('截图会话已结束');
      return this.host.saveWatermark(watermarkPreset(value));
    });
    register('capture-annotation-style', (e, token, tool, value) => {
      if (token !== session(e).token) throw Error('截图会话已结束');
      const preference = annotationStylePreference(tool,value);
      return this.host.saveAnnotationStyle?.(preference.tool,preference.style);
    });
    register('capture-watermark-image', async (e, token) => {
      const current = session(e);
      if (token !== current.token || current.busy) throw Error('截图会话已结束');
      current.busy = 'watermark';
      try {
        return await chooseWatermarkImage(
          current.overlay,
          () => this.run === current && !current.overlay.isDestroyed(),
        );
      } finally {
        current.busy = null;
      }
    });
    register('capture-sensitive', async (e, token, png) => {
      const current = session(e);
      if (token !== current.token || current.busy || current.ended) throw Error('截图会话已结束');
      if (!this.host.sensitive) throw Error('敏感文字识别不可用');
      current.busy = 'sensitive';
      try {
        const result = await this.host.sensitive.scanSensitive(token, png);
        if (this.run !== current || current.ended || current.overlay.isDestroyed())
          throw Error('截图会话已结束');
        return result;
      } finally {
        current.busy = null;
      }
    });
    register('capture-sensitive-cancel', (e, token) => {
      if (token !== session(e).token) throw Error('截图会话已结束');
      return this.host.sensitive?.cancelSensitive(token);
    });
    register('capture-detect', async (event, token, value: unknown) => {
      const current = session(event);
      if (token !== current.token || current.busy) throw Error('截图定位已失效');
      this.checkDisplay(current.shot);
      const physical = current.shot.physical,
        size = current.shot.size;
      const point = capturePoint(value, size.width, size.height);
      if (!physical) return [];
      const revision = ++current.detectionRevision;
      const update = (value: unknown[], partial: boolean) => {
        if (
          this.run !== current ||
          current.busy ||
          current.detectionRevision !== revision ||
          current.overlay.isDestroyed()
        )
          return;
        const candidates = captureCandidates(value, physical, size.width, size.height, point);
        current.overlay.webContents.send('one:capture-candidates', {
          point,
          candidates,
          partial,
        });
      };
      const raw = await current.probe.query(
        desktopCapturePoint(point, physical, size.width, size.height),
        update,
      );
      if (this.run !== current || current.detectionRevision !== revision || current.busy) return [];
      return captureCandidates(raw, physical, size.width, size.height, point);
    });
    const cursorPosition = (event: Electron.IpcMainInvokeEvent, token: string, value: unknown) => {
      const current = session(event);
      const physical = current.shot.physical,
        size = current.shot.size;
      if (token !== current.token || current.busy || !current.overlay.isFocused())
        throw Error('截图不能移动鼠标');
      this.checkDisplay(current.shot);
      const sourcePoint = capturePoint(value, size.width, size.height);
      const point = physical
        ? desktopCapturePoint(sourcePoint, physical, size.width, size.height)
        : screen.dipToScreenPoint(
            previewCapturePoint(
              sourcePoint,
              current.overlay.getContentBounds(),
              size.width,
              size.height,
            ),
          );
      const viewport = current.overlay.getContentBounds();
      const bounds = screen.dipToScreenRect(current.overlay, viewport);
      const ratio =
        screen.getDisplayMatching(viewport).scaleFactor *
        current.overlay.webContents.getZoomFactor();
      return {
        point,
        client: { x: (point.x - bounds.x) / ratio, y: (point.y - bounds.y) / ratio },
      };
    };
    register('capture-cursor-target', (event, token, value: unknown) => {
      return cursorPosition(event, token, value).client;
    });
    register('capture-cursor', (event, token, value: unknown) => {
      const { point } = cursorPosition(event, token, value);
      movePhysicalCursor(point.x, point.y);
    });
    register('capture-complete', async (event, value: unknown) => {
      const current = session(event);
      if (value === null) {
        if (current.busy === 'output') throw Error('截图正在输出');
        current.finish(null);
        return { completed: true, receipts: [] };
      }
      if (current.busy) throw Error('截图正在输出');
      const size = current.shot.size;
      const request = captureRequest(
        value,
        current.token,
        size.width,
        size.height,
        current.purpose === 'region',
      );
      const workflow = request.workflowId
        ? current.workflows.find((w) => w.id === request.workflowId)
        : undefined;
      if (
        request.actions.includes('translate') &&
        (!workflow || JSON.stringify(workflow.actions) !== JSON.stringify(request.actions))
      )
        throw Error('翻译仅能通过已配置的动作流程执行，请重新选择流程');
      if (current.purpose === 'region') {
        this.checkDisplay(current.shot);
        const r = request.selection;
        current.finish({
          displayId: current.shot.displayId,
          sourceId: current.shot.sourceId,
          signature: current.shot.signature,
          rect: {
            x: r.x / size.width,
            y: r.y / size.height,
            width: r.width / size.width,
            height: r.height / size.height,
          },
          pixels: { width: r.width, height: r.height },
          screen: size,
        });
        return { completed: true, receipts: [] };
      }
      const layout = outputLayout(
        request.selection.width,
        request.selection.height,
        request.effects!,
      );
      const header = pngDimensions(request.png!);
      if (header.width !== layout.width || header.height !== layout.height)
        throw Error('截图输出尺寸与选区不符');
      const png = decodePng(request.png!);
      let physicalPin: Rectangle | undefined;
      if (request.actions.includes('pin')) {
        try {
          this.checkDisplay(current.shot);
          physicalPin = capturePinBounds(current.shot.pinPhysical ?? current.shot.physical, size, request.selection, layout);
        } catch {
          // Saved pixels remain usable; changed screens use the pin service's default placement.
        }
      }
      const dipPin=physicalPin?screen.screenToDipRect(null,physicalPin):undefined;
      const captured=dipPin&&physicalPin?{...dipPin,scale:physicalPin.width/layout.width/screen.getDisplayMatching(dipPin).scaleFactor}:undefined;
      current.busy = 'output';
      current.detectionRevision++;
      try {
        const result = await current.delivery.execute(
          png.data,
          request.actions,
          (action) => {
            if (this.run !== current || current.ended || current.overlay.isDestroyed())
              return Promise.resolve(false);
            return this.host.deliver(current.overlay, png.data, action, workflow, current.token,captured);
          },
          request.actions.includes('translate')
            ? JSON.stringify([workflow!.id, workflow!.translationTarget,physicalPin])
            : physicalPin?JSON.stringify(physicalPin):'',
        );
        this.outcome = structuredClone(result);
        if (result.error) this.host.failed(Error(result.error));
        if (result.completed && this.run === current) {
          const original = request.originalPng ? decodePng(request.originalPng).data : undefined;
          try {
            await this.host.archive?.(
              png.data,
              request.document,
              request.document ? original || current.shot.png : undefined,
              request.history,
            );
          } finally {
            original?.fill(0);
          }
          current.finish(null);
        }
        return result;
      } catch (error) {
        this.host.failed(error);
        throw error;
      } finally {
        png.data.fill(0);
        current.busy = null;
      }
    });
    register('capture-refresh', async (event, token) => {
      const current = session(event);
      if (token !== current.token || current.busy) throw Error('当前截图不能刷新');
      current.busy = 'refresh';
      current.candidate = undefined;
      current.detectionRevision++;
      const old = current.shot;
      const hidden = current.remoteCompatible && !!old.physical && current.overlay.isVisible();
      const focused = hidden && current.overlay.isFocused();
      if (hidden) current.overlay.hide();
      // Window WGC owns the target surface. Monitor WGC must hide the overlay
      // in remote mode; the local-only mode can use capture exclusion instead.
      try {
        if (this.run !== current || current.overlay.isDestroyed()) throw Error('截图已取消');
        const shot = freezeCaptureSnapshot(await current.refresh());
        checkSnapshotRefresh(old, shot);
        if (this.run !== current) throw Error('截图已取消');
        current.candidate = { shot, revision: ++current.nextImageRevision };
        return this.data(current, shot, current.candidate.revision);
      } finally {
        current.busy = null;
        if (hidden && this.run === current && !current.overlay.isDestroyed()) {
          if (focused) {
            current.overlay.show();
            current.overlay.focus();
          } else current.overlay.showInactive();
        }
      }
    });
    register('capture-refresh-ready', (event, token, revision, accepted) => {
      const current = session(event), candidate = current.candidate;
      if (token !== current.token || current.busy || !candidate || candidate.revision !== revision ||
          typeof accepted !== 'boolean') throw Error('刷新候选快照已失效');
      if (accepted) {
        current.shot = candidate.shot;
        current.imageRevision = candidate.revision;
      }
      current.candidate = undefined;
    });
  }
  private data(current: CaptureRun, shot = current.shot, revision = current.imageRevision): CaptureData {
    const size = shot.size;
    return {
      token: current.token,
      image: `one-file://capture/${current.token}/${revision}`,
      revision,
      capturedAt: shot.capturedAt,
      watermark: this.host.watermark(),
      annotationStyles: this.host.annotationStyles?.(),
      uiScale:this.host.uiScale(),
      name: shot.name,
      width: size.width,
      height: size.height,
      purpose: current.purpose,
      regionHint: current.regionHint,
      selected: current.selected,
      initialSelection: current.initialSelection,
      autoCopy: current.autoCopy,
      selectionMode: current.selectionMode,
      composition: shot.composition,
      layers: shot.layers?.map((layer, i) => ({
        image: `one-file://capture/${current.token}/${revision}/layer/${i}`,
        name: layer.name,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      })),
      workflows: structuredClone(current.workflows),
      workflowId: current.workflowId,
      detection: !!shot.physical,
      pointer: this.pointer(shot),
      origin: shot.physical
        ? { x: shot.physical.x, y: shot.physical.y }
        : { x: 0, y: 0 },
    };
  }
  private pointer(shot: Snapshot) {
    if (!shot.physical) return null;
    const cursor = physicalCursor(),
      bounds = shot.physical,
      size = shot.size;
    if (
      cursor.x < bounds.x ||
      cursor.y < bounds.y ||
      cursor.x >= bounds.x + bounds.width ||
      cursor.y >= bounds.y + bounds.height
    )
      return null;
    return {
      x: Math.min(size.width - 1, Math.floor(((cursor.x - bounds.x) * size.width) / bounds.width)),
      y: Math.min(
        size.height - 1,
        Math.floor(((cursor.y - bounds.y) * size.height) / bounds.height),
      ),
    };
  }
  screens() {
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      name: d.label || '显示器 ' + (i + 1),
      width: Math.ceil(d.size.width * d.scaleFactor),
      height: Math.ceil(d.size.height * d.scaleFactor),
    }));
  }
  cancel() {
    this.selectedFonts.clear();
    if (this.run) void this.host.cancelWorkflow?.(this.run.token).catch(() => {});
    if (this.run) void this.host.sensitive?.cancelSensitive(this.run.token).catch(() => {});
    this.generation++;
    this.listing++;
    this.choices.clear();
    this.acquisition?.abort();
    this.captureNative?.stop();
    this.run?.probe.close();
    this.run?.finish(null);
    if (this.run && !this.run.overlay.isDestroyed()) this.run.overlay.destroy();
    this.discardWarm();
  }
  image(path: string): Buffer | undefined {
    const current = this.run;
    if (!current || current.ended) return;
    for (const { shot, revision } of [
      { shot: current.shot, revision: current.imageRevision },
      ...(current.candidate ? [current.candidate] : []),
    ]) {
      if (path === `/${current.token}/${revision}`) return shot.png;
      const base = `/${current.token}/${revision}/layer/`;
      if (path.startsWith(base)) {
        const index = path.slice(base.length);
        if (/^(?:[0-9]|[12][0-9]|3[01])$/.test(index))
          return shot.layers?.[Number(index)]?.png;
      }
    }
  }
  allowsFont(owner:number,family:string){return !this.closing&&!this.host.blocked()&&!this.run?.ended&&this.run?.overlay.webContents.id===owner&&this.selectedFonts.has(family);}
  authorize(url:string,owner:number){
    const current=this.run;
    if(this.closing||this.host.blocked()||!current||current.ended||current.overlay.isDestroyed()||current.overlay.webContents.id!==owner||current.overlay.webContents.getURL()!==CAPTURE_URL)return false;
    try{const value=new URL(url);return value.protocol==='one-file:'&&value.host==='capture'&&!value.search&&!value.hash&&!!this.image(value.pathname);}catch{return false;}
  }
  resource(request:Request){
    const current=this.run;if(!current||!this.authorize(request.url,current.overlay.webContents.id))return new Response(null,{status:404});
    const bytes=this.image(new URL(request.url).pathname)!;
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
  }
  preferencesChanged(){for(const window of [this.run?.overlay,this.warm?.overlay])if(window&&!window.isDestroyed())window.webContents.send('one:capture-preferences',{uiScale:this.host.uiScale()});}
  stop(){if(this.stopping)return this.stopping;this.closing=true;return this.stopping=(async()=>{await Promise.allSettled([...this.pending]);this.cancel();})();}
  private discardWarm() {
    const warm = this.warm;
    this.warm = undefined;
    if (!warm) return;
    warm.provide(null);
    warm.probe.close();
    warm.capture?.native.stop();
    if (!warm.overlay.isDestroyed()) warm.overlay.destroy();
  }
  /** Load the renderer ahead of the hotkey. It remains hidden and owns no desktop image. */
  prepare(displayId = screen.getPrimaryDisplay().id) {
    if(this.closing||this.host.blocked())return;
    if (this.warm && !this.warm.overlay.isDestroyed()) {
      this.prepareMonitor(displayId);
      return;
    }
    const overlay = this.host.createWindow({
      ...screen.getPrimaryDisplay().bounds,
      frame: false,
      thickFrame: false,
      transparent: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      backgroundColor: '#00000000',

    });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', (e) => e.preventDefault());
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true);
    let provide!: (value: CaptureData | null) => void;
    const data = new Promise<CaptureData | null>((resolve) => {
      provide = resolve;
    });
    const handle = overlay.getNativeWindowHandle();
    const excludedWindow =
      handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    // thickFrame:false alone does not reliably suppress transitions on the
    // transparent capture surface. Set the per-HWND DWM policy before any show.
    if (!disableWindowTransitions(Number(excludedWindow)))
      this.host.failed(Error('无法关闭截图窗口过渡动画'));
    const probe = new CaptureProbe(this.host.failed, undefined, excludedWindow);
    const warm: PreparedCapture = {
      overlay,
      data,
      provide,
      probe,
      loaded: overlay.loadURL(CAPTURE_URL),
    };
    this.warm = warm;
    probe.warm();
    overlay.once('closed', () => {
      provide(null);
      if (this.warm === warm) this.warm = undefined;
      probe.close();
      warm.capture?.native.stop();
    });
    void warm.loaded.catch((error) => {
      this.host.failed(error);
      if (this.warm === warm) this.discardWarm();
    });
    this.prepareMonitor(displayId);
  }
  private prepareMonitor(displayId: number) {
    const warm = this.warm,
      display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!warm || !display) return;
    const signature = displaySignature(display);
    if (warm.capture?.displayId === displayId && warm.capture.signature === signature) return;
    warm.capture?.native.stop();
    try {
      const capture = {
        displayId,
        signature,
        native: new ScrollNative(captureMonitorBounds(display), true),
      };
      warm.capture = capture;
      void capture.native.ready.catch((error) => {
        if (this.warm === warm && warm.capture === capture) {
          warm.capture = undefined;
          this.host.failed(error);
        }
      });
    } catch (error) {
      warm.capture = undefined;
      this.host.failed(error);
    }
  }
  private checkDisplay(shot: Snapshot) {
    if (shot.composition === 'desktop') {
      if (desktopSignature(this.monitors()) !== shot.signature)
        throw Error('显示器配置已改变，请重新截图');
      return;
    }
    const current = screen.getAllDisplays().find((d) => d.id === shot.displayId);
    if (!current || displaySignature(current) !== shot.signature)
      throw Error('显示器配置已改变，请重新截图');
  }
  async snapshot(displayId: number, capture?: ScrollNative): Promise<Snapshot> {
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!display) throw Error('显示器已断开');
    const signature = displaySignature(display);
    const physical = captureMonitorBounds(display);
    const native = capture || new ScrollNative(physical, true);
    let png: Buffer;
    try {
      png = await native.frame(!!capture);
    } finally {
      if (!capture) native.stop();
    }
    const shot = {
      // NativeFrameReader has already validated dimensions and bounded PNG.
      // Decode once in the renderer, rather than synchronously on main too.
      size: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
      png,
      capturedAt: Date.now(),
      displayId,
      sourceId: 'native-monitor:' + display.id,
      signature,
      name: display.label || '显示器截图',
      physical,
    };
    this.checkDisplay(shot);
    return shot;
  }
  private monitors(): DesktopMonitor[] {
    return screen.getAllDisplays().map((display, i) => ({
      id: display.id,
      name: display.label || '显示器 ' + (i + 1),
      signature: displaySignature(display),
      bounds: captureMonitorBounds(display),
    }));
  }
  private async snapshotDesktop(displayId: number): Promise<Snapshot> {
    const acquisition = new AbortController();
    this.acquisition = acquisition;
    try {
      const result = await captureDesktopFrames(
        { list: () => this.monitors(), create: (bounds) => new ScrollNative(bounds, true) },
        acquisition.signal,
      );
      return {
        composition: 'desktop',
        size: { width: result.physical.width, height: result.physical.height },
        displayId,
        sourceId: 'native-desktop',
        signature: result.signature,
        physical: result.physical,
        png: result.layers[0].png,
        layers: result.layers,
        name: '全屏 · 所有显示器',
        capturedAt: Date.now(),
      };
    } finally {
      if (this.acquisition === acquisition) this.acquisition = undefined;
    }
  }
  async captureWindows() {
    const generation = this.generation,
      listing = ++this.listing;
    this.choices.clear();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 240, height: 150 },
    });
    if (generation !== this.generation || listing !== this.listing) return [];
    const result = [];
    for (const source of sources) {
      const hwnd = Number(source.id.split(':')[1]),
        info = captureWindowInfo(hwnd);
      if (!info || info.pid === process.pid || source.thumbnail.isEmpty()) continue;
      const token = randomUUID();
      this.choices.set(token, {
        id: source.id,
        pid: info.pid,
        hwnd,
        name: source.name,
        created: Date.now(),
      });
      result.push({
        token,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        bounds: { x: info.x, y: info.y, width: info.width, height: info.height },
      });
      if (result.length >= 80) break;
    }
    return result;
  }
  async takeWindow(token: unknown, windows: BrowserWindow[]) {
    const choice = typeof token === 'string' ? this.choices.get(token) : undefined;
    if (!choice || Date.now() - choice.created > 120000)
      throw Error('窗口选择已失效，请刷新窗口列表');
    const current = () => {
      const info = captureWindowInfo(choice.hwnd);
      if (!info || info.pid !== choice.pid || info.pid === process.pid)
        throw Error('窗口已关闭或最小化，请刷新窗口列表');
      return info;
    };
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    let native: ScrollNative | undefined;
    const capture = async (): Promise<Snapshot> => {
      const info = current();
      const acquisition = new AbortController();
      this.acquisition = acquisition;
      const abort = () => native?.stop();
      acquisition.signal.addEventListener('abort', abort, { once: true });
      try {
        native ||= new ScrollNative({ hwnd: info.hwnd, pid: info.pid });
        const png = await native.frame(true);
        acquisition.signal.throwIfAborted();
        current();
        return {
          size: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
          png,
          capturedAt: Date.now(),
          displayId: display.id,
          sourceId: choice.id,
          pinPhysical:{x:info.x,y:info.y,width:png.readUInt32BE(16),height:png.readUInt32BE(20)},
          signature: displaySignature(display),
          name: choice.name,
        };
      } finally {
        acquisition.signal.removeEventListener('abort', abort);
        if (this.acquisition === acquisition) this.acquisition = undefined;
      }
    };
    try {
      await this.start(display.id, windows, 'capture', true, capture);
      return this.outcome ?? null;
    } finally {
      native?.stop();
    }
  }
  async takeWindowSet(value: unknown, windows: BrowserWindow[], placementValue?: unknown) {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > CAPTURE_WINDOWS ||
      value.some((token) => typeof token !== 'string') ||
      new Set(value).size !== value.length
    )
      throw Error('请选择 1–8 个不同窗口');
    const placements = windowPlacements(placementValue, value);
    const choices = value.map((token) => {
      const choice = this.choices.get(token);
      if (!choice || Date.now() - choice.created > 120000)
        throw Error('窗口选择已失效，请刷新窗口列表');
      return choice;
    });
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      sourceId = 'native-window-set:' + randomUUID();
    const capture = async (): Promise<Snapshot> => {
      const acquisition = new AbortController();
      this.acquisition = acquisition;
      try {
        const result = await captureWindowFrames(
          choices,
          acquisition.signal,
          {
            ownPid: process.pid,
            info: captureWindowInfo,
            create: (info) => new ScrollNative({ hwnd: info.hwnd, pid: info.pid }),
          },
          placements,
        );
        return {
          composition: 'windows',
          size: { width: result.width, height: result.height },
          png: result.layers[0].png,
          layers: result.layers,
          capturedAt: Date.now(),
          displayId: display.id,
          signature: displaySignature(display),
          sourceId,
          name: '多窗口组合',
        };
      } finally {
        if (this.acquisition === acquisition) this.acquisition = undefined;
      }
    };
    await this.start(display.id, windows, 'capture', true, capture);
    return this.outcome ?? null;
  }
  async take(
    mode: 'region' | 'screen' | 'copy' | 'free' | 'polygon' | 'desktop',
    displayId: number,
    windows: BrowserWindow[],
    custom?: CustomCapture,
  ) {
    if (!['region', 'screen', 'copy', 'free', 'polygon', 'desktop'].includes(mode))
      throw Error('截图模式无效');
    await this.start(
      displayId,
      windows,
      'capture',
      mode === 'screen' || mode === 'desktop',
      mode === 'desktop' ? () => this.snapshotDesktop(displayId) : undefined,
      undefined,
      {
        custom,
        autoCopy: mode === 'copy',
        selectionMode: mode === 'free' || mode === 'polygon' ? mode : 'rectangle',
      },
    );
    return this.outcome ?? null;
  }
  choose(
    displayId: number,
    windows: BrowserWindow[],
    regionHint: 'recording' | 'scroll' = 'recording',
  ): Promise<Region | null> {
    return this.start(displayId, windows, 'region', false, undefined, regionHint);
  }
  private async start(
    displayId: number,
    windows: BrowserWindow[],
    purpose: 'capture' | 'region',
    selected: boolean,
    getShot?: () => Promise<Snapshot>,
    regionHint?: 'recording' | 'scroll',
    options?: {
      custom?: CustomCapture;
      autoCopy?: boolean;
      selectionMode?: 'rectangle' | 'free' | 'polygon';
    },
  ): Promise<Region | null> {
    if(this.closing||this.host.blocked())throw Error('截图服务已关闭');
    if (this.active) throw Error('截图正在进行');
    this.selectedFonts.clear();
    this.outcome = undefined;
    this.active = true;
    const started = performance.now(),
      warmed = !!this.warm;
    const generation = this.generation,
      shown = windows.filter((w) => !w.isDestroyed() && w.isVisible());
    let overlay: BrowserWindow | undefined;
    let native: ScrollNative | undefined;
    let paintTimer: NodeJS.Timeout | undefined;
    try {
      this.prepare(displayId);
      const warm = this.warm!;
      overlay = warm.overlay;
      for (const window of shown) {
        const handle = window.getNativeWindowHandle();
        disableWindowTransitions(
          Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()),
        );
        window.hide();
      }
      if (shown.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        flushDesktopComposition();
      }
      if (generation !== this.generation) return null;
      if (!getShot) {
        const display = screen.getAllDisplays().find((d) => d.id === displayId);
        if (!display) throw Error('显示器已断开');
        native = warm.capture?.native || new ScrollNative(captureMonitorBounds(display), true);
        this.captureNative = native;
        warm.capture = undefined;
        getShot = () => this.snapshot(displayId, native);
      } else {
        warm.capture?.native.stop();
        warm.capture = undefined;
      }
      const shot = await getShot();
      const acquired = performance.now();
      if (generation !== this.generation) return null;
      const display = screen.getAllDisplays().find((d) => d.id === displayId);
      if (!display) throw Error('显示器已断开');
      const size = shot.size;
      imageDimensions(size.width, size.height);
      overlay.setBounds(display.bounds);
      const remoteCompatible = this.host.remoteCompatible?.() ?? true;
      overlay.setContentProtection(!remoteCompatible);
      let painted!: () => void;
      const paintReady = new Promise<void>((resolve, reject) => {
        painted = resolve;
        paintTimer = setTimeout(() => reject(Error('截图界面首帧绘制超时')), 7000);
      });
      // Always observe a timeout rejection, even if loading the page fails first.
      void paintReady.catch(() => {});
      const result = new Promise<Region | null>((resolve) => {
        let finished = false;
        const configured = this.host.workflows();
        this.run = {
          token: randomUUID(),
          overlay: overlay!,
          shot: freezeCaptureSnapshot(shot),
          purpose,
          regionHint,
          selected,
          initialSelection: options?.custom
            ? customCaptureSelection(options.custom, size.width, size.height)
            : undefined,
          autoCopy: options?.autoCopy,
          selectionMode: options?.selectionMode,
          workflows: workflowsFrom(configured.workflows),
          workflowId: configured.workflowId,
          delivery: new CaptureDelivery(),
          busy: null,
          probe: warm.probe,
          detectionRevision: 0,
          remoteCompatible,
          imageRevision: 0,
          nextImageRevision: 0,
          ended: false,
          painted,
          refresh: getShot!,
          finish: (value) => {
            if (!finished) {
              finished = true;
              current.ended = true;
              current.painted();
              if (current.busy === 'refresh' && this.run === current) this.acquisition?.abort();
              current.probe.close();
              current.detectionRevision++;
              resolve(value);
            }
          },
        };
        const current = this.run;
        overlay!.once('closed', () => {
          if (this.run === current) current.finish(null);
        });
        overlay!.webContents.once('render-process-gone', (_e, detail) => {
          this.host.failed(Error('截图界面退出：' + detail.reason));
          if (this.run === current) current.finish(null);
        });
      });
      warm.provide(this.data(this.run!));
      await warm.loaded;
      if (this.warm === warm) this.warm = undefined;
      await paintReady;
      clearTimeout(paintTimer);
      if (generation !== this.generation || overlay.isDestroyed()) return null;
      if (this.run?.ended) return await result;
      if (this.run?.startupError) throw Error(this.run.startupError);
      overlay.show();
      overlay.focus();
      const displayed = performance.now();
      this.host.timing?.({
        acquireMs: Math.round(acquired - started),
        displayMs: Math.round(displayed - acquired),
        totalMs: Math.round(displayed - started),
        warmed,
      });
      return await result;
    } finally {
      clearTimeout(paintTimer);
      native?.stop();
      if (this.captureNative === native) this.captureNative = undefined;
      if (this.run && this.run.overlay === overlay) {
        this.run.probe.close();
        void this.host.cancelWorkflow?.(this.run.token).catch(() => {});
        void this.host.sensitive?.cancelSensitive(this.run.token).catch(() => {});
      }
      if (this.run?.overlay === overlay) this.run = undefined;
      if (overlay && !overlay.isDestroyed()) overlay.destroy();
      this.active = false;
      for (const window of shown)
        if (!window.isDestroyed()&&!this.closing&&!this.host.blocked()) {
          window.show();
          window.focus();
        }
      if (generation === this.generation) this.prepare(displayId);
    }
  }
}
