import {nativeImage,screen,type BrowserWindow,type IpcMainInvokeEvent} from 'electron';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {readFile,lstat} from 'node:fs/promises';
import {IMAGE_BYTES} from '../../shared/capture/image-limits';
import { ScrollNative, captureMonitorBounds } from './scroll-native';
import { displaySignature, type Region } from '../../shared/capture/region';
import {
  scrollDefaults,
  scrollOptions,
  scrollOverlayLayout,
  scrollMaskShape,
  type ScrollCommand,
  type ScrollView,
} from '../../shared/capture/scroll-capture';
import type { PixelFrame } from '../../shared/capture/scroll-stitch';
import {ScrollMotion} from '../../shared/capture/scroll-motion';
import {ScrollFramePump} from './scroll-frame-pump';
import {createScrollDirectory,cleanScrollDirectory,sweepScrollDirectories,type ScrollDirectory} from './scroll-storage';
import {ScrollCaptureLimit} from '../../shared/capture/scroll-capture';
export interface ScrollContext {
  onEscape?(callback:()=>boolean):()=>void;
  foregroundWindow?():number;
  createWindow(options:Electron.BrowserWindowConstructorOptions):BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  blocked():boolean;
  uiScale():100|110|125|150;
  remoteCompatible?(): boolean;
  choose(display: number, hideMainWindow?: boolean,retainMask?:(window:BrowserWindow,windows:BrowserWindow[])=>void): Promise<Region | null>;
  windows(hideMainWindow?: boolean): BrowserWindow[];
  edit(png: Buffer, title: string): Promise<void>;
  output?(window:BrowserWindow,file:string,action:'copy'|'save'):Promise<boolean>;
  failed(error: unknown): void;
}
export const SCROLL_URL = 'one://app/index.html?view=scroll-capture';
const FOCUS_MESSAGE = '自动滚动已暂停。请点击原窗口并把鼠标移入选区，松开按键后再继续。';
class ScrollPaused extends Error {}
class ScrollStopped extends Error {}
export class ScrollCaptureService {
  window?: BrowserWindow;
  active = false;
  private requests=new Set<Promise<unknown>>();
  private terminations=new Set<Promise<void>>();
  private directories=new Map<Worker,ScrollDirectory>();
  private cacheReady:Promise<unknown>;
  private native?: ScrollNative;
  private worker?: Worker;
  private workerFailed?: Error;
  private request = 0;
  private pending?: {
    id: number;
    kind:string;
    resolve(value: any): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  };
  private view?: ScrollView;
  private hidden: BrowserWindow[] = [];
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private busy = false;
  private motion=new ScrollMotion();
  private settingsOpen=false;
  private interacting=false;
  private shapeKey='';
  private releaseEscape?:()=>void;
  private escapeTarget=0;
  private handoff?:BrowserWindow;
  private painted?:{resolve():void;reject(error:Error):void;timer:NodeJS.Timeout};
  private tooltip?:Electron.Rectangle;
  private backendReady?:Promise<void>;
  private setupAction=false;
  private inspectBounds?:Electron.Rectangle;
  private inspectRequest?:{position:number;height:number;serial:number};
  private inspectSerial=0;
  private inspectTask?:Promise<void>;
  private commandDone?:Promise<void>;
  private automatic = false;
  private monitoring=false;
  private monitorSerial=0;
  private settle?: { timer: NodeJS.Timeout; resolve(): void };
  private stepDone?: Promise<void>;
  private region?: Region;
  private remoteCompatible = true;
  constructor(private host: ScrollContext) {
    this.cacheReady=sweepScrollDirectories().catch(error=>host.failed(error));
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      host.register('scroll-' + name, (event, ...args) => {
        if (
          (host.blocked()&&!['interactive','tooltip','ready'].includes(name)) || !this.window ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== SCROLL_URL ||
          (!this.active&&!['state','ready'].includes(name))
        )
          throw Error('拒绝访问长截图');
        const result=fn(...args);
        if(result instanceof Promise){this.requests.add(result);void result.then(()=>this.requests.delete(result),()=>this.requests.delete(result));}
        return result;
      });
    handle('state', () => this.view||null);
    handle('ready',()=>this.painted?.resolve());
    handle('inspect',(token,position,bounds)=>{
      const view=this.view;if(!view||token!==view.token)throw Error('长截图请求已失效');
      const serial=++this.inspectSerial;
      if(position===null){this.inspectBounds=undefined;this.inspectRequest=undefined;this.resizeControl();return;}
      if(typeof position!=='number'||!Number.isFinite(position)||position<0||position>1||!view.count||!bounds||Object.keys(bounds).sort().join(',')!=='height,width,x,y'||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)||bounds.width<1||bounds.height<1||bounds.width>4096||bounds.height>4096||Math.abs(bounds.x)>32768||Math.abs(bounds.y)>32768)throw Error('预览位置无效');
      this.inspectBounds=bounds;this.inspectRequest={position,height:Math.round(view.width*bounds.height/bounds.width),serial};this.resizeControl();
      if(!this.busy&&!this.pending&&!this.backendReady){const generation=this.generation;void this.updateInspection().catch(error=>{if(generation===this.generation&&this.active)this.host.failed(error);});}
    });
    handle('tooltip',rect=>{
      if(rect!==null&&(!rect||typeof rect!=='object'||Object.keys(rect).sort().join(',')!=='height,width,x,y'||![rect.x,rect.y,rect.width,rect.height].every(Number.isSafeInteger)||rect.width<1||rect.height<1||rect.width>4096||rect.height>4096||Math.abs(rect.x)>32768||Math.abs(rect.y)>32768))throw Error('提示位置无效');
      this.tooltip=rect||undefined;this.resizeControl();
    });
    handle('interactive', value=>{if(typeof value!=='boolean')throw Error('交互状态无效');this.interacting=value;this.resizeControl();});
    handle('command', (token, command) => this.command(token, command));
  }
  get pendingTasks(){return this.requests.size;}
  async idle(){this.pause();await this.stepDone;await Promise.allSettled([...this.requests]);if(this.view)this.publish();}
  async stopped(){await Promise.allSettled([...this.terminations]);}
  preferencesChanged(){if(this.view){this.view.uiScale=this.host.uiScale();this.publish();}}
  private terminate(worker:Worker){const directory=this.directories.get(worker);this.directories.delete(worker);const task=(async()=>{try{await worker.terminate();}catch(error){if(worker.threadId!==-1){this.host.failed(error);return;}}if(directory)try{await cleanScrollDirectory(directory);}catch(error){this.host.failed(error);}})();this.terminations.add(task);void task.then(()=>this.terminations.delete(task));}
  get hasUnsaved() {
    return !!this.view?.count;
  }
  private publish() {
    if(this.view)this.view.canEdit=!!this.view.count&&!this.view.pending&&!this.workerFailed;
    if(this.window&&!this.window.isDestroyed()&&this.view){
      this.resizeControl();
      const {preview,...state}=this.view;
      this.window.webContents.send('one:scroll-view',this.sentPreview===preview?state:this.view);this.sentPreview=preview;
    }
    return structuredClone(this.view!);
  }
  private resizeControl(){
    const region=this.region,view=this.view,window=this.window,display=screen.getAllDisplays().find(d=>d.id===region?.displayId);if(!region||!view||!window||window.isDestroyed()||!display)return;
    const area={x:0,y:0,width:display.bounds.width,height:display.bounds.height};
    const selection={x:Math.round(region.rect.x*area.width),y:Math.round(region.rect.y*area.height),width:Math.round(region.rect.width*area.width),height:Math.round(region.rect.height*area.height)};
    const height=56;
    view.overlay=scrollOverlayLayout(area,selection,view.count?view:view.source,height,true,view.previewExpanded);
    const {controls,preview}=view.overlay;
    if(this.tooltip&&this.tooltip.x<selection.x+selection.width&&this.tooltip.x+this.tooltip.width>selection.x&&this.tooltip.y<selection.y+selection.height&&this.tooltip.y+this.tooltip.height>selection.y)view.overlay.overlap=true;
    if(this.inspectBounds&&this.inspectBounds.x<selection.x+selection.width&&this.inspectBounds.x+this.inspectBounds.width>selection.x&&this.inspectBounds.y<selection.y+selection.height&&this.inspectBounds.y+this.inspectBounds.height>selection.y)view.overlay.overlap=true;
    if(this.settingsOpen){
      const width=Math.min(420,area.width-24),height=Math.min(540,area.height-92);
      view.overlay.panel={x:Math.max(12,Math.min(controls.x+controls.width-width,area.width-width-12)),y:Math.max(12,controls.y-height-8),width,height};
      view.overlay.overlap ||=view.overlay.panel.x<selection.x+selection.width&&view.overlay.panel.x+width>selection.x&&view.overlay.panel.y<selection.y+selection.height&&view.overlay.panel.y+height>selection.y;
    }
    // A native window-region hole passes input directly to the source window.
    // Unlike hover-driven click-through, the first click never races an IPC.
    const inspection=this.inspectBounds;
    const shape=this.interacting?[]:[
      ...(inspection?[{x:inspection.x-32,y:inspection.y-32,width:inspection.width+64,height:inspection.height+64}]:[]),
      ...scrollMaskShape(area.width,area.height,selection),controls,...(view.previewExpanded?[preview]:[]),...(view.overlay.panel?[{x:Math.max(0,view.overlay.panel.x-32),y:Math.max(0,view.overlay.panel.y-32),width:Math.min(area.width-view.overlay.panel.x+32,view.overlay.panel.width+64),height:Math.min(area.height-view.overlay.panel.y+32,view.overlay.panel.height+64)}]:[]),...(this.tooltip?[this.tooltip]:[]),
    ].filter(rect=>rect.width>0&&rect.height>0);
    const shapeKey=JSON.stringify(shape);if(shapeKey!==this.shapeKey){window.setShape(shape);this.shapeKey=shapeKey;}
  }
  private clearPaint(){const gate=this.painted;if(gate){clearTimeout(gate.timer);this.painted=undefined;}}
  private surfaceReady?:Promise<void>;
  private sentPreview?:string;
  prepare(displayId:number){if(!this.active&&!this.host.blocked()){const display=screen.getAllDisplays().find(d=>d.id===displayId);if(display)this.surface(display);}}
  releasePrepared(){if(!this.active)this.cancel();}
  private surface(display:Electron.Display){
    if(this.window&&!this.window.isDestroyed())return this.window;
      const window = this.host.createWindow({
        ...display.bounds,
        minWidth:1,
        minHeight:1,
        roundedCorners:false,
        title: 'One · 长截图',
        show: false,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        frame: false,
        thickFrame:false,
        transparent:true,
        backgroundColor:'#00000000',
        hasShadow:false,
        resizable:false,
        movable:false,
        skipTaskbar:true,
      });
      this.window = window;this.sentPreview=undefined;
      window.setBounds(display.bounds);
      this.resizeControl();
      this.remoteCompatible = this.host.remoteCompatible?.() ?? true;
      window.setContentProtection(!this.remoteCompatible);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.webContents.on('will-attach-webview', (e) => e.preventDefault());
      window.webContents.on('render-process-gone', () => this.cancel());
      window.on('close', (event) => {
        if (this.busy) {
          event.preventDefault();
          return;
        }
        // Closing after samples means review, not silent loss. Explicit Cancel discards.
        if (this.view?.count && this.view.phase !== 'review') {
          event.preventDefault();
          this.pause();
          this.view.phase = 'review';
          this.view.message = '已有结果已保留。可继续采集、编辑结果或取消。';
          this.publish();
        }
      });
      window.on('closed', () => {
        if (this.window === window) this.cancel();
      });
      const painted=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('长截图界面加载超时')),10000);timer.unref();this.painted={resolve,reject,timer};});
      this.surfaceReady=Promise.all([window.loadURL(SCROLL_URL),painted]).then(()=>{this.clearPaint();}).catch(error=>{if(!this.active&&this.window===window)this.cancel();throw error;});
      void this.surfaceReady.catch(()=>{});
      return window;
  }
  async open(displayId: number, hideMainWindow = false,chosen?:Region,startManual=true,carriedWindows:BrowserWindow[]=[],mask?:BrowserWindow) {
    if(this.host.blocked())throw Error('长截图服务已关闭');
    if (this.active) {
      this.window?.show();
      throw Error('请先完成当前长截图');
    }
    this.active = true;
    this.handoff=mask;
    this.hidden=[];
    const generation = ++this.generation;
    try {
      const region = chosen||await this.host.choose(displayId, hideMainWindow,(window,windows)=>{this.handoff=window;this.hidden=windows;});
      if (!region || generation !== this.generation) {
        this.cancel();
        return;
      }
      this.region = region;this.settingsOpen=false;this.interacting=false;this.tooltip=undefined;this.shapeKey='';this.setupAction=false;
      const display = screen.getAllDisplays().find((d) => d.id === region.displayId);
      if (!display || displaySignature(display) !== region.signature)
        throw Error('显示器已改变，请重新选择');
      this.hidden = [...new Set([...this.hidden,...carriedWindows,...this.host.windows(hideMainWindow).filter(w=>w.isVisible())])].filter(w=>!w.isDestroyed());
      for (const w of this.hidden) w.hide();
      this.releaseEscape=this.host.onEscape?.(()=>{
        if(this.interacting||this.host.blocked())return false;
        const foreground=this.host.foregroundWindow?.();
        const handle=(window?:BrowserWindow)=>{if(!window||window.isDestroyed())return 0;const value=window.getNativeWindowHandle();return Number(value.length>=8?value.readBigUInt64LE():value.readUInt32LE());};
        if(foreground!==undefined&&foreground!==this.escapeTarget&&foreground!==handle(this.window)&&foreground!==handle(this.handoff))return false;
        this.cancel();return true;
      });
      if (generation !== this.generation) return;
      const physical = captureMonitorBounds(display),
        rect = {
          x: physical.x + Math.round(region.rect.x * physical.width),
          y: physical.y + Math.round(region.rect.y * physical.height),
          width: region.pixels.width,
          height: region.pixels.height,
        };
      if (rect.width < 64 || rect.height < 64) throw Error('长截图选区至少 64 × 64 像素');
      scrollOptions(scrollDefaults(), rect.width, rect.height);
      this.native = new ScrollNative(rect);
      const backend=this.backendReady=(async()=>{
      await this.native!.ready;
      if (generation !== this.generation) return;
      await this.cacheReady;const directory=await createScrollDirectory();if(generation!==this.generation){await cleanScrollDirectory(directory);return;}
      try{this.worker = new Worker(join(__dirname, 'capture/scroll-worker.cjs'),{workerData:directory});this.directories.set(this.worker,directory);}catch(error){await cleanScrollDirectory(directory);throw error;}
      const worker = this.worker;
      worker.on('message', (response) => {
        if (generation !== this.generation || this.worker !== worker) return;
        if(response.event&&['configure','restart'].includes(this.pending?.kind||''))return;
        if(response.event==='preview'){if(this.view&&typeof response.previewImage==='string'){this.view.preview=response.previewImage;this.publish();}return;}
        if(response.event==='preview-error'){this.workerFailure(Error(response.error));return;}
        if (response.id !== this.pending?.id) return;
        const pending = this.pending!;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (response.error) pending.reject(response.limit?new ScrollCaptureLimit(response.error):Error(response.error));
        else pending.resolve(response);
      });
      worker.on('error', (error) => {
        if (generation === this.generation && this.worker === worker) this.workerFailure(error);
      });
      worker.on('exit', () => {
        if (generation === this.generation && this.worker === worker)
          this.workerFailure(Error('拼接进程已退出'));
      });
      this.accept(await this.run('configure', { options: this.view!.options, source: this.view!.source }));
      if(startManual&&generation===this.generation){const frame=await this.native!.framePixels(false);try{this.accept(await this.run('sample',frame,[frame.pixels.buffer as ArrayBuffer]));}finally{if(frame.pixels.byteLength)frame.pixels.fill(0);}}
      })();
      // Surface preparation must not wait for the native session, cache sweep
      // or worker startup. Both branches are owned by the same generation.
      void backend.catch(()=>{});
      this.view = {
        recovering:false,
        mode:'manual',
        previewExpanded:true,
        token: randomUUID(),
        uiScale:this.host.uiScale(),
        phase: 'setup',
        source: { width: rect.width, height: rect.height },
        options: scrollDefaults(),
        width: 0,
        height: 0,
        count: 0,
        undo: false,
        pending: false,
        canEdit: false,
        offset: 0,
        match: 'first',
        message: '选择方向，可排除固定栏。首帧将以当前页面位置开始。',
        preview: '',
      };
      const window=this.surface(display);
      window.setBounds(display.bounds);this.resizeControl();
      await this.surfaceReady;
      if(generation!==this.generation||window.isDestroyed())return;
      this.clearPaint();
      const refreshed=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('长截图界面布局超时')),10000);timer.unref();this.painted={resolve,reject,timer};});
      this.publish();await refreshed;
      this.clearPaint();
      // Flush the styled toolbar into the compositor while both windows keep
      // their current visibility. Hidden windows need not schedule animation frames.
      if(generation===this.generation&&!window.isDestroyed())await window.webContents.capturePage(this.view.overlay!.controls,{stayHidden:true,stayAwake:true});
      if(generation!==this.generation||window.isDestroyed())return;
      if (generation === this.generation && !window.isDestroyed()) window.showInactive();
      if(this.handoff&&!this.handoff.isDestroyed())this.handoff.destroy();this.handoff=undefined;
      await backend;
      if(generation!==this.generation)return;
      this.backendReady=undefined;this.publish();
      if(startManual&&!this.setupAction&&generation===this.generation)try{await this.command(this.view.token,{kind:'manual'});}catch(error){if(generation===this.generation){this.view.phase='paused';this.view.message=error instanceof Error?error.message:String(error);this.publish();}}
    } catch (error) {
      if(generation!==this.generation)return;
      this.cancel();
      if(error instanceof ScrollStopped)return;
      this.host.failed(error);
      throw error;
    }
  }
  private workerFailure(error: Error) {
    if (this.workerFailed) return;
    this.workerFailed = error;
    const worker = this.worker;
    this.worker = undefined;
    if (worker) this.terminate(worker);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    if (this.view && this.active) {
      this.pause();
      this.view.phase = 'failed';
      this.view.message = error.message + '。本次拼接计算已失效，仅保留预览，请取消后重新开始。';
      this.host.failed(error);
      this.publish();
    }
  }
  private run(kind: string, value?: unknown,transfer:ArrayBuffer[]=[]) {
    if (this.workerFailed) return Promise.reject(this.workerFailed);
    if (!this.worker || this.pending) return Promise.reject(Error('拼接会话不可用'));
    return new Promise<any>((resolve, reject) => {
      const id = ++this.request,
        timer = setTimeout(() => this.workerFailure(Error(kind==='export'?'长截图导出超时，已有预览已保留':'拼接计算超时，已有预览已保留')), kind==='export'?180000:10000);
      timer.unref();
      this.pending = { id, kind, resolve, reject, timer };
      try{this.worker!.postMessage({ id, kind, value,encodePreview:true },transfer);}catch(error){clearTimeout(timer);this.pending=undefined;reject(error);}
    });
  }
  private accept(response: any) {
    Object.assign(this.view!, response.result);
    if(typeof response.previewImage==='string')this.view!.preview=response.previewImage;
    const p = response.preview as PixelFrame | null;
    if (p)
      this.view!.preview = nativeImage
        .createFromBitmap(Buffer.from(p.pixels.buffer,p.pixels.byteOffset,p.pixels.byteLength), { width: p.width, height: p.height })
        .toDataURL();
  }
  private async updateInspection(){
    if(!this.inspectRequest||this.inspectTask||this.pending||!this.worker)return;
    const request=this.inspectRequest,generation=this.generation;this.inspectRequest=undefined;
    const task=(async()=>{
      const response=await this.run('inspect',request),frame=response.preview as PixelFrame|null;
      if(!frame)return;
      try{
        if(generation===this.generation&&request.serial===this.inspectSerial&&this.window&&!this.window.isDestroyed())this.window.webContents.send('one:scroll-inspection',{image:nativeImage.createFromBitmap(Buffer.from(frame.pixels.buffer,frame.pixels.byteOffset,frame.pixels.byteLength),{width:frame.width,height:frame.height}).toDataURL()});
      }finally{frame.pixels.fill(0);}
    })();
    this.inspectTask=task;try{await task;}finally{if(this.inspectTask===task)this.inspectTask=undefined;}
  }
  private delay(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.settle = undefined;
        resolve();
      }, ms);
      this.settle = { timer, resolve };
    });
  }
  private validDisplay() {
    const d = screen.getAllDisplays().find((display) => display.id === this.region?.displayId);
    if (!d || displaySignature(d) !== this.region?.signature)
      throw Error('显示器已改变，请确认已有结果后重新选择');
  }
  private async sample(monitored = false) {
    const window = this.window,
      generation = this.generation;
    let hidden = false;
    if (
      this.remoteCompatible &&
      this.view?.overlay?.overlap &&
      window &&
      !window.isDestroyed() &&
      window.isVisible() &&
      this.region
    ) {
      const display = screen.getAllDisplays().find((d) => d.id === this.region!.displayId);
      if (display) {
        const region = this.region.rect,
          bounds = window.getBounds();
        const x = display.bounds.x + region.x * display.bounds.width;
        const y = display.bounds.y + region.y * display.bounds.height;
        hidden =
          bounds.x < x + region.width * display.bounds.width &&
          bounds.y < y + region.height * display.bounds.height &&
          bounds.x + bounds.width > x &&
          bounds.y + bounds.height > y;
      }
    }
    try {
      if (hidden) {
        window!.hide();
        await this.delay(120);
      }
      if (generation !== this.generation || (monitored && !this.monitoring))
        throw new ScrollStopped();
      return await this.readSample(monitored);
    } finally {
      if (
        hidden &&
        generation === this.generation &&
        this.window === window &&
        !window!.isDestroyed()
      )
        window!.showInactive();
    }
  }
  private async readSample(monitored = false) {
    if(this.inspectTask)await this.inspectTask;
    const mode=this.view!.mode,automatic=monitored&&mode==='auto';
    const unavailable=automatic?FOCUS_MESSAGE:'目标窗口不可见或被遮挡，手动采集已暂停。已有结果已保留。';
    const generation = this.generation,
      started = performance.now();
    const check = () => {
      if (generation !== this.generation || (monitored && (!this.monitoring||this.view?.mode!==mode)))
        throw new ScrollStopped();
      this.validDisplay();
      if(this.host.blocked()){this.pause();throw new ScrollStopped();}
    };
    if (monitored) await this.run('settle-reset');
    for (;;) {
      check();
      if (monitored&&(!(await this.native!.available())||automatic&&!(await this.native!.focused())))throw new ScrollPaused(unavailable);
      const frame=await this.native!.framePixels();let staged=false;
      try {
        check();
        if(monitored&&(!(await this.native!.available())||automatic&&!(await this.native!.focused())))throw new ScrollPaused(unavailable);
        if(this.inspectTask)await this.inspectTask;
        const observed=await this.run('stage',{frame,monitored,moving:monitored&&!automatic,fast:automatic},[frame.pixels.buffer as ArrayBuffer]);staged=observed.stable;
        if(observed.moving){check();this.accept(observed);break;}
        if (staged) {
          check();
          // A focus/cursor change during settling must not append an obscured
          // frame or send another wheel. Leave the last accepted strip intact.
          if (monitored&&(!(await this.native!.available())||automatic&&!(await this.native!.focused())))throw new ScrollPaused(unavailable);
          check();
          if(this.inspectTask)await this.inspectTask;
          this.accept(await this.run('commit',{recover:monitored&&!automatic&&this.view!.pending}));staged=false;
          check();
          break;
        }
      } finally {
        if(frame.pixels.byteLength)frame.pixels.fill(0);
        if(staged)await this.run('release-frame').catch(()=>{});
      }
      if (performance.now() - started >= 6000){
        if(monitored&&!automatic){this.view!.message='滚动中，等待画面稳定';return this.publish();}
        throw new ScrollPaused(
          '画面持续变化，已暂停自动滚动。可等待加载结束后继续，或手动采集。已有结果已保留。',
        );
      }
      await this.updateInspection();
      await this.delay(automatic?16:monitored?40:140);
    }
    const view = this.view!;
    const wasRecovering=view.recovering;
    view.recovering=monitored&&!automatic&&(view.match==='backwards'||view.match==='ambiguous');
    view.message =
      view.match === 'first'
        ? '已采集首帧。滚动时会自动采集稳定画面。'
        : view.match === 'accepted'
          ? `已拼接 ${view.count} 帧，新增 ${view.offset} 像素。`
          : view.match === 'unchanged'
            ? wasRecovering||view.message==='已找回衔接位置，可以继续滚动。'?'已找回衔接位置，可以继续滚动。':'页面尚未变化。已有结果保持不变。'
            : view.match === 'backwards'
              ? '正在定位已有内容，向前滚动找到衔接后自动继续。'
              : '滚动距离过大或匹配不明确。请滚回一段找到衔接，已有结果已保留。';
    return this.publish();
  }
  private pause() {
    this.monitorSerial++;
    this.monitoring=false;
    this.automatic = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.view && this.view.phase === 'running') this.view.phase = 'paused';
  }
  private async trackManual(){
    const generation=this.generation,serial=this.monitorSerial;
    const metrics=this.view!.metrics={captured:0,processed:0,rejected:0,maxMatchMs:0,started:Date.now()};
    const active=()=>generation===this.generation&&serial===this.monitorSerial&&this.monitoring&&!this.automatic&&!this.host.blocked();
    const pump=new ScrollFramePump(this.view!.source.width*this.view!.source.height*4,async()=>{
      while(active()&&this.inspectBounds&&this.view?.overlay?.overlap){await this.updateInspection();await new Promise(resolve=>setTimeout(resolve,20));}
      if(!active())throw new ScrollStopped();
      this.validDisplay();
      if(!(await this.native!.available()))throw new ScrollPaused('目标窗口不可见或被遮挡，手动采集已暂停。已有结果已保留。');
      const frame=await this.native!.framePixels();
      metrics.captured++;
      if(active()&&!(await this.native!.available())){frame.pixels.fill(0);throw new ScrollPaused('目标窗口不可见或被遮挡，手动采集已暂停。已有结果已保留。');}
      return Object.assign(frame,{capturedAt:performance.now()});
    },active);
    let previewAt=0,publishedAt=0;
    try{
      while(active()){
        const frames=await pump.nextBatch();if(!frames)break;
        try{
          const now=performance.now(),preview=now-previewAt>=60;
          if(this.inspectTask)await this.inspectTask;
          const matching=performance.now();
          const observed=await this.run('track-batch',{frames,preview},frames.map(frame=>frame.pixels.buffer as ArrayBuffer));
          metrics.processed+=frames.length;metrics.rejected+=observed.rejected||0;metrics.maxMatchMs=Math.max(metrics.maxMatchMs,Math.round(performance.now()-matching));
          if(!active())break;
          this.accept(observed);if(observed.preview||observed.previewImage||observed.previewQueued)previewAt=now;
          const view=this.view!;view.recovering=view.match==='ambiguous'||view.match==='backwards';
          view.message=view.recovering?'已保留长图，回到已采集位置后继续向下滚动。':view.match==='accepted'?`已拼接 ${view.count} 帧，新增 ${view.offset} 像素。`:'滚动页面截取更多内容';
          if(observed.preview||observed.previewImage||now-publishedAt>=60){this.publish();publishedAt=now;}
          await this.updateInspection();
        }finally{for(const frame of frames)if(frame.pixels.byteLength)frame.pixels.fill(0);}
      }
    }finally{
      await pump.close();
      if(generation===this.generation&&this.worker&&!this.workerFailed){this.accept(await this.run('preview'));this.publish();}
    }
  }
  private schedule(ms: number) {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (generation === this.generation) void this.step();
    }, ms);
  }
  private async step() {
    if (!this.monitoring || this.busy || !this.view) return;
    this.busy = true;
    const generation = this.generation;
    let done!: () => void;
    const stepDone = new Promise<void>((resolve) => {
      done = resolve;
    });
    this.stepDone = stepDone;
    try {
      this.validDisplay();
      if(this.inspectBounds&&this.view.overlay?.overlap){await this.updateInspection();return;}
      if(!this.automatic)await this.trackManual();
      else if(!this.view.count) await this.sample(true);
      else {
        const action=this.motion.action(performance.now());
        if(action.kind==='end'){
          this.pause();this.view.phase='review';this.view.message='等待页面后仍无新增内容。请确认末尾，或改为手动继续。';this.publish();return;
        }
        if(action.kind==='scroll'){
          if (!(await this.native!.available())||!(await this.native!.wheel(this.view.options.axis === 'horizontal',action.notches))) {
            this.pause();this.view.message = FOCUS_MESSAGE;this.publish();return;
          }
          this.motion.sent(performance.now(),action.notches,action.probe);
          await this.delay(16);
        }
        if (generation !== this.generation || !this.automatic) return;
        await this.sample(true);
        if(this.view.match==='accepted')this.motion.accepted(this.view.offset,(this.view.options.axis==='vertical'?this.view.source.height:this.view.source.width)-this.view.options.trimStart-this.view.options.trimEnd-(this.view.fixed?.start||0)-(this.view.fixed?.end||0));
        if(this.view.match==='unchanged'){this.view.message='等待页面加载或新增内容…';this.publish();}
        if (this.view.pending || this.view.match === 'backwards') {
          this.pause();
          this.publish();
          return;
        }
      }
      await this.updateInspection();
    } catch (error) {
      if (generation === this.generation && !(error instanceof ScrollStopped)) {
        this.pause();
        this.view.phase = error instanceof ScrollCaptureLimit?'review':error instanceof ScrollPaused ? 'paused' : 'failed';
        this.view.message = error instanceof Error ? error.message : String(error);
        if (!(error instanceof ScrollPaused)&&!(error instanceof ScrollCaptureLimit)) this.host.failed(error);
        this.publish();
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (this.monitoring) this.schedule(this.automatic?24:16);
      }
      if (this.stepDone === stepDone) this.stepDone = undefined;
      done();
    }
  }
  private async command(token: string, value: unknown): Promise<ScrollView | null> {
    if (!this.view || token !== this.view.token || !value || typeof value !== 'object')
      throw Error('长截图请求已失效');
    const command = value as ScrollCommand;
    if(command.kind==='layout'){
      if(typeof command.preview!=='boolean'||command.settings!==undefined&&typeof command.settings!=='boolean')throw Error('预览设置无效');this.view.previewExpanded=command.preview;
      if(command.settings!==undefined)this.settingsOpen=command.settings;return this.publish();
    }
    if (command.kind === 'cancel') {
      this.cancel();
      return null;
    }
    if (command.kind === 'pause') {
      if(this.backendReady)this.setupAction=true;
      this.pause();
      return this.publish();
    }
    if(this.backendReady){this.setupAction=true;await this.backendReady;if(!this.view||token!==this.view.token||!this.active)return null;}
    while(this.commandDone){this.pause();await this.commandDone;if(!this.view||token!==this.view.token||!this.active)return null;}
    if(this.inspectTask)await this.inspectTask;
    if (this.stepDone) {
      // Finish remains usable during an automatic sample. Pause immediately,
      // then wait for the owned read to release before touching the worker.
      this.pause();
      await this.stepDone;
      if (!this.view || token !== this.view.token || !this.active) return null;
    }
    if (this.busy) throw Error('采集正在进行，请稍后');
    this.pause();
    this.busy = true;
    const generation = this.generation;
    let completed!:()=>void;const owned=this.commandDone=new Promise<void>(resolve=>{completed=resolve;});
    try {
      if (command.kind === 'configure') {
        if (this.view.count) throw Error('方向和排除区域只能在首帧前设置');
        this.view.options = scrollOptions(
          command.options,
          this.view.source.width,
          this.view.source.height,
        );
        this.accept(
          await this.run('configure', { options: this.view.options, source: this.view.source }),
        );
      }else if(command.kind==='restart'){
        this.view.options=scrollOptions(command.options,this.view.source.width,this.view.source.height);this.view.preview='';this.view.recovering=false;this.accept(await this.run('restart',{options:this.view.options,source:this.view.source}));this.view.mode='manual';this.view.phase='setup';this.view.message='已按新设置重新开始。';
      } else if (command.kind === 'sample') {
        this.view.phase = 'paused';
        await this.sample();
      } else if (command.kind === 'auto'||command.kind==='manual') {
        this.settingsOpen=false;
        this.interacting=false;this.resizeControl();
        if(this.view.pending) {this.accept(await this.run('discard'));this.view.message='待确认帧已放弃，返回上次拼接位置后继续。';}
        const ticket=this.monitorSerial;this.native!.permitActivation();
        const activated=await this.native!.activate(command.kind==='auto');
        this.escapeTarget=this.host.foregroundWindow?.()||0;
        if(!activated)throw new ScrollPaused(this.native!.activationReason==='keys'?'请松开鼠标和修饰键后继续。':this.native!.activationReason==='foreground'?'目标窗口未获得焦点，请点击目标窗口后继续。':'目标窗口或滚动点被遮挡，请移开遮挡后继续。');
        if(generation!==this.generation||ticket!==this.monitorSerial)throw new ScrollStopped();
        this.view.mode=command.kind==='auto'?'auto':'manual';
        this.view.recovering=false;
        this.view.phase = 'running';
        this.automatic = command.kind==='auto';this.monitoring=true;
        this.motion.reset();
        this.view.message = this.automatic?'自动滚动中，可随时暂停或改为手动。':'手动滚动中，稳定画面会自动拼接。';
        this.schedule(0);
      } else if (command.kind === 'join' || command.kind === 'undo') {
        this.accept(
          await this.run(command.kind, command.kind === 'join' ? command.offset : undefined),
        );
        this.view.message =
          command.kind === 'undo'
            ? '已撤销上一段拼接。请返回页面的对应位置后继续。'
            : '已按指定距离拼接，请检查接缝。';
        this.view.recovering=false;
        this.view.phase = 'paused';
      } else if (command.kind === 'finish') {
        if (!this.view.count) throw Error('请先采集一帧');
        if (this.view.pending) {
          this.accept(await this.run('discard'));
        }
        this.view.recovering=false;
        this.view.phase = 'review';
        this.view.message = '检查结果后进入图片编辑，可裁剪、标注、复制或另存。';
      } else if (command.kind === 'edit'||command.kind==='copy'||command.kind==='save') {
        if (!this.view.count || this.view.pending) throw Error('请先完成拼接或确认已有结果');
        this.view.message=command.kind==='edit'?'正在准备编辑图片…':command.kind==='copy'?'正在复制长截图…':'正在准备原图…';this.publish();
        const worker=this.worker!,lease=this.directories.get(worker);
        const response=await this.run('export',{edit:command.kind==='edit'}),output=response.exported;
        if(generation!==this.generation)throw new ScrollStopped();
        if(!lease||!output||![join(lease.directory,'export.png'),join(lease.directory,'edit.png')].includes(output.file))throw Error('长截图导出已失效');
        const info=await lstat(output.file);if(!info.isFile()||info.isSymbolicLink())throw Error('长截图导出已失效');
        if(generation!==this.generation)throw new ScrollStopped();
        let png:Buffer|undefined;
        try {
          let delivered=false;
          if(command.kind==='edit'){
            if(info.size>IMAGE_BYTES)throw Error('编辑图片文件过大，请先保存原图。');
            png=await readFile(output.file);
            if(generation!==this.generation)throw new ScrollStopped();
            await this.host.edit(png,output.scaled?`长截图编辑副本 ${output.width} × ${output.height}（原图 ${output.originalWidth} × ${output.originalHeight}）`:`长截图 ${output.width} × ${output.height}`);delivered=true;
          }else if(this.host.output)delivered=await this.host.output(this.window!,output.file,command.kind);
          if(delivered&&generation === this.generation)this.cancel();
          else if(generation===this.generation)return this.publish();
        } finally {
          png?.fill(0);
        }
        return null;
      } else throw Error('长截图操作无效');
      if (generation !== this.generation) return null;
      return this.publish();
    } catch (error) {
      if (generation === this.generation) {
        this.view.message = error instanceof Error ? error.message : String(error);
        this.publish();
      }
      throw error;
    } finally {
      if (generation === this.generation) this.busy = false;
      if(this.commandDone===owned)this.commandDone=undefined;completed();
    }
  }
  cancel() {
    this.inspectSerial++;this.inspectBounds=undefined;this.inspectRequest=undefined;
    this.releaseEscape?.();this.releaseEscape=undefined;this.escapeTarget=0;
    if(this.painted){clearTimeout(this.painted.timer);this.painted.reject(new ScrollStopped());this.painted=undefined;}
    if(this.handoff&&!this.handoff.isDestroyed())this.handoff.destroy();this.handoff=undefined;
    this.generation++;
    this.active = false;
    this.pause();
    if (this.settle) {
      clearTimeout(this.settle.timer);
      this.settle.resolve();
      this.settle = undefined;
    }
    this.native?.stop();
    this.native = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error('长截图已取消'));
      this.pending = undefined;
    }
    const worker = this.worker;
    this.worker = undefined;
    if (worker) this.terminate(worker);
    const window = this.window;
    this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    for (const w of this.hidden) if (!w.isDestroyed()&&!this.host.blocked()) w.showInactive();
    this.hidden = [];
    this.view = undefined;
    this.backendReady=undefined;this.surfaceReady=undefined;
    this.workerFailed = undefined;
    this.region = undefined;
    this.busy = false;
  }
}
