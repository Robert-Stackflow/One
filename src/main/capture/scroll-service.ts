import {nativeImage,screen,type BrowserWindow,type IpcMainInvokeEvent} from 'electron';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ScrollNative, captureMonitorBounds } from './scroll-native';
import { displaySignature, type Region } from '../../shared/capture/region';
import {
  scrollDefaults,
  scrollOptions,
  scrollControlBounds,
  type ScrollCommand,
  type ScrollView,
} from '../../shared/capture/scroll-capture';
import type { PixelFrame } from '../../shared/capture/scroll-stitch';
import {ScrollMotion} from '../../shared/capture/scroll-motion';
export interface ScrollContext {
  createWindow(options:Electron.BrowserWindowConstructorOptions):BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  blocked():boolean;
  uiScale():100|110|125|150;
  remoteCompatible?(): boolean;
  choose(display: number, hideMainWindow?: boolean): Promise<Region | null>;
  windows(hideMainWindow?: boolean): BrowserWindow[];
  edit(png: Buffer, title: string): Promise<void>;
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
  private native?: ScrollNative;
  private worker?: Worker;
  private workerFailed?: Error;
  private request = 0;
  private pending?: {
    id: number;
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
  private automatic = false;
  private monitoring=false;
  private monitorSerial=0;
  private settle?: { timer: NodeJS.Timeout; resolve(): void };
  private stepDone?: Promise<void>;
  private region?: Region;
  private remoteCompatible = true;
  constructor(private host: ScrollContext) {
    const handle = (name: string, fn: (...args: any[]) => unknown) =>
      host.register('scroll-' + name, (event, ...args) => {
        if (
          host.blocked() || !this.window ||
          event.sender !== this.window.webContents ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== SCROLL_URL ||
          !this.active
        )
          throw Error('拒绝访问长截图');
        const result=fn(...args);
        if(result instanceof Promise){this.requests.add(result);void result.then(()=>this.requests.delete(result),()=>this.requests.delete(result));}
        return result;
      });
    handle('state', () => this.view);
    handle('command', (token, command) => this.command(token, command));
  }
  get pendingTasks(){return this.requests.size;}
  async idle(){this.pause();await this.stepDone;await Promise.allSettled([...this.requests]);if(this.view)this.publish();}
  async stopped(){await Promise.allSettled([...this.terminations]);}
  preferencesChanged(){if(this.view){this.view.uiScale=this.host.uiScale();this.publish();}}
  private terminate(worker:Worker){const task=Promise.resolve(worker.terminate()).then(()=>{},()=>{});this.terminations.add(task);void task.then(()=>this.terminations.delete(task));}
  get hasUnsaved() {
    return !!this.view?.count;
  }
  private publish() {
    if (this.view)
      this.view.canEdit = !!this.view.count && !this.view.pending && !this.workerFailed;
    if (this.window && !this.window.isDestroyed())
      this.window.webContents.send('one:scroll-view', this.view);
    return structuredClone(this.view!);
  }
  async open(displayId: number, hideMainWindow = false,chosen?:Region,startManual=true,carriedWindows:BrowserWindow[]=[]) {
    if(this.host.blocked())throw Error('长截图服务已关闭');
    if (this.active) {
      this.window?.show();
      throw Error('请先完成当前长截图');
    }
    this.active = true;
    const generation = ++this.generation;
    try {
      const region = chosen||await this.host.choose(displayId, hideMainWindow);
      if (!region || generation !== this.generation) {
        this.cancel();
        return;
      }
      this.region = region;
      const display = screen.getAllDisplays().find((d) => d.id === region.displayId);
      if (!display || displaySignature(display) !== region.signature)
        throw Error('显示器已改变，请重新选择');
      this.hidden = [...new Set([...carriedWindows,...this.host.windows(hideMainWindow).filter(w=>w.isVisible())])].filter(w=>!w.isDestroyed());
      for (const w of this.hidden) w.hide();
      await this.delay(150);
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
      await this.native.ready;
      if (generation !== this.generation) return;
      this.worker = new Worker(join(__dirname, 'capture/scroll-worker.cjs'));
      const worker = this.worker;
      worker.on('message', (response) => {
        if (generation !== this.generation || this.worker !== worker) return;
        if (response.id !== this.pending?.id) return;
        const pending = this.pending!;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (response.error) pending.reject(Error(response.error));
        else pending.resolve(response);
      });
      worker.on('error', (error) => {
        if (generation === this.generation && this.worker === worker) this.workerFailure(error);
      });
      worker.on('exit', () => {
        if (generation === this.generation && this.worker === worker)
          this.workerFailure(Error('拼接进程已退出'));
      });
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
      await this.run('configure', { options: this.view.options, source: this.view.source });
      const placement=scrollControlBounds(display.workArea,{x:display.bounds.x+region.rect.x*display.bounds.width,y:display.bounds.y+region.rect.y*display.bounds.height,width:region.rect.width*display.bounds.width,height:region.rect.height*display.bounds.height});
      const window = this.host.createWindow({
        ...placement,
        minWidth: Math.min(340,placement.width),
        minHeight: Math.min(250,placement.height),
        title: 'One · 长截图',
        show: false,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        frame: true,
        thickFrame: true,
      });
      this.window = window;
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
      await window.loadURL(SCROLL_URL);
      if (generation === this.generation && !window.isDestroyed()) window.showInactive();
      if(startManual&&generation===this.generation)try{await this.command(this.view.token,{kind:'manual'});}catch(error){if(generation===this.generation){this.view.phase='paused';this.view.message=error instanceof Error?error.message:String(error);this.publish();}}
    } catch (error) {
      this.cancel();
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
        timer = setTimeout(() => this.workerFailure(Error('拼接计算超时，已有预览已保留')), 10000);
      timer.unref();
      this.pending = { id, resolve, reject, timer };
      try{this.worker!.postMessage({ id, kind, value },transfer);}catch(error){clearTimeout(timer);this.pending=undefined;reject(error);}
    });
  }
  private accept(response: any) {
    Object.assign(this.view!, response.result);
    const p = response.preview as PixelFrame | null;
    if (p)
      this.view!.preview = nativeImage
        .createFromBitmap(Buffer.from(p.pixels), { width: p.width, height: p.height })
        .toDataURL();
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
        const observed=await this.run('stage',{frame,monitored},[frame.pixels.buffer as ArrayBuffer]);staged=observed.stable;
        if (staged) {
          check();
          // A focus/cursor change during settling must not append an obscured
          // frame or send another wheel. Leave the last accepted strip intact.
          if (monitored&&(!(await this.native!.available())||automatic&&!(await this.native!.focused())))throw new ScrollPaused(unavailable);
          check();
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
      await this.delay(140);
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
      if (!this.automatic||!this.view.count) await this.sample(true);
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
          await this.delay(140);
        }
        if (generation !== this.generation || !this.automatic) return;
        await this.sample(true);
        if(this.view.match==='accepted')this.motion.accepted(this.view.offset,(this.view.options.axis==='vertical'?this.view.source.height:this.view.source.width)-this.view.options.trimStart-this.view.options.trimEnd);
        if(this.view.match==='unchanged'){this.view.message='等待页面加载或新增内容…';this.publish();}
        if (this.view.pending || this.view.match === 'backwards') {
          this.pause();
          this.publish();
          return;
        }
      }
    } catch (error) {
      if (generation === this.generation && !(error instanceof ScrollStopped)) {
        this.pause();
        this.view.phase = error instanceof ScrollPaused ? 'paused' : 'failed';
        this.view.message = error instanceof Error ? error.message : String(error);
        if (!(error instanceof ScrollPaused)) this.host.failed(error);
        this.publish();
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (this.monitoring) this.schedule(this.automatic?450:300);
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
      const region=this.region,display=screen.getAllDisplays().find(d=>d.id===region?.displayId);
      if(region&&display)this.window?.setBounds(scrollControlBounds(display.workArea,{x:display.bounds.x+region.rect.x*display.bounds.width,y:display.bounds.y+region.rect.y*display.bounds.height,width:region.rect.width*display.bounds.width,height:region.rect.height*display.bounds.height},command.settings?600:command.preview?500:310));return this.publish();
    }
    if (command.kind === 'cancel') {
      this.cancel();
      return null;
    }
    if (command.kind === 'pause') {
      this.pause();
      return this.publish();
    }
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
        if(this.view.pending) {this.accept(await this.run('discard'));this.view.message='待确认帧已放弃，返回上次拼接位置后继续。';}
        const ticket=this.monitorSerial,window=this.window;this.native!.permitActivation();try{window?.hide();await this.delay(80);if(!(await this.native!.activate(command.kind==='auto')))throw new ScrollPaused(this.native!.activationReason==='keys'?'请松开鼠标和修饰键后继续。':this.native!.activationReason==='foreground'?'目标窗口未获得焦点，请点击目标窗口后继续。':'目标窗口或滚动点被遮挡，请移开遮挡后继续。');}finally{if(generation===this.generation&&window&&!window.isDestroyed())window.showInactive();}
        if(generation!==this.generation||ticket!==this.monitorSerial)throw new ScrollStopped();
        this.view.mode=command.kind==='auto'?'auto':'manual';
        this.view.recovering=false;
        this.view.phase = 'running';
        this.automatic = command.kind==='auto';this.monitoring=true;
        this.motion.reset();
        this.view.message = this.automatic?'自动滚动中，可随时暂停或改为手动。':'手动滚动中，稳定画面会自动拼接。';
        this.schedule(300);
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
      } else if (command.kind === 'edit') {
        if (!this.view.count || this.view.pending) throw Error('请先完成拼接或确认已有结果');
        const response = await this.run('output'),
          output = response.output as PixelFrame,
          image = nativeImage.createFromBitmap(Buffer.from(output.pixels), {
            width: output.width,
            height: output.height,
          }),
          png = image.toPNG();
        try {
          await this.host.edit(png, `长截图 ${output.width} × ${output.height}`);
          if (generation === this.generation) this.cancel();
        } finally {
          png.fill(0);
          output.pixels.fill(0);
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
    }
  }
  cancel() {
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
    this.workerFailed = undefined;
    this.region = undefined;
    this.busy = false;
  }
}
