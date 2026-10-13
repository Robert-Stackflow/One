import {serviceCredentialCrypto,type ServiceConnectionStorage} from '../service-connections';
import {clipboard,type BrowserWindow,type IpcMainInvokeEvent} from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodePng, pngDimensions } from '../capture/clipboard';
import { OCRModels } from './ocr-models';
import { OCRRunner } from './ocr-runner';
import { SensitiveScanner } from './sensitive-scanner';
import { OCRWorkflow } from './ocr-workflow';
import { ocrDimensions, ocrLanguage, ocrText, type OCRResult } from '../../shared/recognition/ocr';
import { RecognitionConnectionStore } from './connections';
import { TranslationClient } from './translation-client';
import type { TranslationResult } from '../../shared/recognition/translation';
import { FormulaClient } from './formula-client';
import { formulaText, type FormulaResult } from '../../shared/recognition/formula';
export const RECOGNITION_URL = 'one://app/index.html?view=recognition';
export interface RecognitionContext {
  blocked():boolean;
  background<T>(task:Promise<T>):Promise<T>;
  uiScale():100|110|125|150;
  createWindow():BrowserWindow;
  register(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown):void;
  connections:ServiceConnectionStorage;
  protect(path:string):void;
}
export class OCRService {
  readonly workflow: OCRWorkflow;
  readonly sensitive: SensitiveScanner;
  window?: BrowserWindow;
  private png?: Buffer;
  private token = '';
  private name = '';
  private size = { width: 0, height: 0 };
  private result?: OCRResult;
  private progress = 0;
  private running = false;
  private translating = false;
  private formulaRecognizing = false;
  private formulaSerial = 0;
  private formulaTask?: Promise<FormulaResult>;
  private formulaConfiguring = false;
  private translationSerial = 0;
  private translationTask?: Promise<TranslationResult>;
  private configuring = false;
  private error = '';
  private opening = false;
  private settling: Promise<unknown> = Promise.resolve();
  readonly models: OCRModels;
  private runner: OCRRunner;
  readonly translationStore: RecognitionConnectionStore;
  readonly translationClient: TranslationClient;
  readonly formulaStore: RecognitionConnectionStore;
  readonly formulaClient: FormulaClient;
  constructor(
    directory: string,
    private ctx: RecognitionContext,
  ) {
    this.models = new OCRModels(join(directory, 'models'));
    this.runner = new OCRRunner(this.models);
    this.sensitive = new SensitiveScanner(this.models);
    this.workflow = new OCRWorkflow({
      prepare: async (png) => {
        if (this.window && this.png?.equals(png)) {
          if (this.running || this.translating || this.formulaRecognizing)
            throw Error('请先结束当前识别或翻译');
          this.window.show();
          this.window.focus();
        } else await this.open(png, '截图翻译');
        return this.token;
      },
      valid: (token) =>
        !!token &&
        token === this.token &&
        !!this.window &&
        !this.window.isDestroyed() &&
        !ctx.blocked(),
      config: () => this.translationStore.state(),
      recognize: (token) =>
        this.result?.language === 'chi_sim+eng'
          ? Promise.resolve(this.result)
          : this.recognize(token, 'chi_sim+eng'),
      translate: (token, text, target, revision) => this.translate(token, text, target, revision),
      cancel: async () => {
        await Promise.all([this.runner.cancel(), this.cancelTranslation()]);
      },
    });
    this.translationStore = new RecognitionConnectionStore(ctx.connections,serviceCredentialCrypto);
    this.translationClient = new TranslationClient();
    this.formulaStore = new RecognitionConnectionStore(ctx.connections,serviceCredentialCrypto,'formula');
    this.formulaClient = new FormulaClient();
    const handle=(name:string,fn:(...args:any[])=>unknown)=>ctx.register('recognition-'+name,(event,...args)=>{
      if(ctx.blocked()||!this.window||event.sender!==this.window.webContents||event.senderFrame!==event.sender.mainFrame||event.sender.mainFrame.frames.length||event.senderFrame.url!==RECOGNITION_URL)throw Error('拒绝访问文字识别');
      return ctx.background(Promise.resolve().then(()=>fn(...args)));
    });
    handle('state', async () => ({
      token: this.token,
      name: this.name,
      image: 'one-file://recognition/' + this.token,
      uiScale:ctx.uiScale(),
      ...this.size,
      running: this.running,
      translating: this.translating,
      formulaRecognizing: this.formulaRecognizing,
      imageBytes: this.png?.length || 0,
      progress: this.progress,
      error: this.error,
      models: await this.models.state(),
      workflow: this.workflow.state,
    }));
    handle('run', (token, value, mode = 'text') => {
      if (this.workflow.active) throw Error('正在执行识别流程，请先取消当前任务');
      return this.recognize(token, value, mode);
    });
    handle('workflow-result', (token, id) => this.workflow.read(token, id));
    handle('workflow-back', (token, id) => {
      if (
        !token ||
        token !== this.token ||
        id !== this.workflow.state?.id ||
        this.workflow.active ||
        !this.workflow.state?.returnToCapture
      )
        throw Error('截图流程已失效');
      this.workflow.state.returnToCapture = false;
      this.window!.hide();
    });
    handle('cancel', () => (this.workflow.active ? this.workflow.cancel() : this.runner.cancel()));
    handle('install', async () => {
      if (this.running || this.workflow.active) throw Error('请先取消识别，再下载语言包');
      const generation = this.token;
      await this.models.install();
      if (generation === this.token) this.error = '';
    });
    handle('cancel-install', () => this.models.cancel());
    handle('copy', async (value) => {
      const text = ocrText(value);
      if (!text.trim()) throw Error('没有可复制的文字');
      await clipboard.writeText(text);
    });
    handle('translation-config', () => this.translationStore.state());
    handle('translation-save', (value) => {
      return this.configureTranslation(() => this.translationStore.save(value));
    });
    handle('translation-clear', (revision) => {
      return this.configureTranslation(() => this.translationStore.clear(revision));
    });
    handle('translate', (token, text, target, revision) => {
      if (this.workflow.active) throw Error('正在执行识别流程，请先取消当前任务');
      return this.translate(token, text, target, revision);
    });
    handle('translation-cancel', () =>
      this.workflow.active ? this.workflow.cancel() : this.cancelTranslation(),
    );
    handle('formula-config', () => this.formulaStore.state());
    const configureFormula = async <T>(operation: () => Promise<T>) => {
      if (this.formulaRecognizing || this.formulaConfiguring || this.workflow.active)
        throw Error('请先结束公式识别或配置操作');
      this.formulaConfiguring = true;
      try {
        return await operation();
      } finally {
        this.formulaConfiguring = false;
      }
    };
    handle('formula-save', (value) => configureFormula(() => this.formulaStore.save(value)));
    handle('formula-clear', (revision) =>
      configureFormula(() => this.formulaStore.clear(revision)),
    );
    handle('formula-recognize', (token, revision) => {
      if (this.workflow.active) throw Error('请先取消识别流程');
      if (token !== this.token || !this.png) throw Error('识别图片已失效');
      if (this.running || this.translating || this.formulaRecognizing)
        throw Error('请先结束当前识别或翻译');
      if (this.formulaConfiguring) throw Error('公式配置正在保存，请稍后重试');
      const generation = this.token,
        serial = ++this.formulaSerial;
      this.formulaRecognizing = true;
      const task = (async () => {
        try {
          const connection = await this.formulaStore.connection(revision);
          if (generation !== this.token || serial !== this.formulaSerial || ctx.blocked())
            throw Error('公式识别已取消');
          const result = await this.formulaClient.run(connection, this.png!);
          if (generation !== this.token || serial !== this.formulaSerial || ctx.blocked())
            throw Error('公式识别已取消');
          return result;
        } finally {
          if (generation === this.token) this.formulaRecognizing = false;
        }
      })();
      this.formulaTask = task;
      return task.finally(() => {
        if (this.formulaTask === task) this.formulaTask = undefined;
      });
    });
    handle('formula-cancel', () => this.cancelFormula());
    handle('formula-copy', async (value) => {
      const text = formulaText(value);
      if (!text.trim()) throw Error('没有可复制的公式');
      await clipboard.writeText(text);
    });
  }
  authorize(url:string,owner:number){
    // Chromium can attribute an inherited about:blank request to its parent frame.
    // This dedicated window has no child documents, so reject its resources if any appear.
    return !!this.token&&!!this.png&&!this.ctx.blocked()&&!!this.window&&!this.window.isDestroyed()&&this.window.webContents.id===owner&&this.window.webContents.mainFrame.frames.length===0&&this.window.webContents.getURL()===RECOGNITION_URL&&url==='one-file://recognition/'+this.token;
  }
  resource(request:Request){
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    if(!this.window||!this.authorize(request.url,this.window.webContents.id))return new Response(null,{status:404});
    return new Response(request.method==='HEAD'?null:new Uint8Array(this.png!),{headers:{'Content-Type':'image/png','Content-Length':String(this.png!.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app'}});
  }
  private async recognize(token: unknown, value: unknown, mode: unknown = 'text') {
    if (token !== this.token || !this.png) throw Error('识别图片已失效');
    if (this.running) throw Error('正在识别，请先取消当前任务');
    if (this.translating) throw Error('请先取消翻译，再识别文字');
    if (this.formulaRecognizing) throw Error('请先取消公式识别');
    if (mode === 'table') throw Error('表格识别已移除，请使用普通文字识别');
    if (mode !== 'text') throw Error('识别模式无效');
    const language = ocrLanguage(value),
      generation = this.token;
    this.running = true;
    this.progress = 0;
    this.error = '';
    try {
      const result = await this.runner.run(
        this.png,
        this.size,
        language,
        (value) => {
          if (this.token === generation) this.progress = Math.max(this.progress, value);
        },
      );
      if (generation !== this.token || this.ctx.blocked()) throw Error('文字识别已取消');
      this.result = result;
      this.progress = 1;
      return result;
    } catch (error) {
      if (generation === this.token)
        this.error = error instanceof Error ? error.message : '文字识别失败';
      throw error;
    } finally {
      if (generation === this.token) this.running = false;
    }
  }
  private async translate(token: unknown, text: unknown, target: unknown, revision: unknown) {
    if (token !== this.token || !this.png) throw Error('识别图片已失效');
    if (this.translating || this.running || this.formulaRecognizing)
      throw Error('请先结束当前识别或翻译');
    if (this.configuring) throw Error('翻译配置正在保存，请稍后重试');
    const generation = this.token;
    const serial = ++this.translationSerial;
    this.translating = true;
    const task = (async () => {
      try {
        const connection = await this.translationStore.connection(revision);
        if (generation !== this.token || serial !== this.translationSerial || this.ctx.blocked())
          throw Error('翻译已取消');
        const result = await this.translationClient.run(connection, text, target);
        if (generation !== this.token || serial !== this.translationSerial || this.ctx.blocked())
          throw Error('翻译已取消');
        return result;
      } finally {
        if (generation === this.token) this.translating = false;
      }
    })();
    this.translationTask = task;
    return task.finally(() => {
      if (this.translationTask === task) this.translationTask = undefined;
    });
  }
  private async configureTranslation<T>(operation: () => Promise<T>) {
    if (this.workflow.active) throw Error('请先结束识别流程，再配置翻译服务');
    if (this.translating || this.configuring || this.formulaRecognizing)
      throw Error('请先结束翻译或配置操作');
    this.configuring = true;
    try {
      return await operation();
    } finally {
      this.configuring = false;
    }
  }
  checkWorkflow(png: Buffer) {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (
      this.opening ||
      this.workflow.active ||
      this.running ||
      this.translating ||
      this.formulaRecognizing
    )
      throw Error('请先结束当前识别或翻译');
    if (this.window && !this.png?.equals(png))
      throw Error('请先关闭当前文字识别窗口，再执行截图翻译');
  }
  async openCapture(png: Buffer) {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (this.window && !this.window.isDestroyed() && this.png?.equals(png)) {
      this.window.show();
      this.window.focus();
      return;
    }
    await this.open(png, '截图');
  }
  async endCaptureWorkflow(owner: string) {
    await this.workflow.cancel(owner);
    if (
      this.workflow.owner === owner &&
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.isVisible() &&
      !this.ctx.blocked()
    )
      this.window.showInactive();
  }
  private async cancelTranslation() {
    this.translationSerial++;
    await this.translationClient.cancel();
    await this.translationTask?.catch(() => {});
  }
  private async cancelFormula() {
    this.formulaSerial++;
    await this.formulaClient.cancel();
    await this.formulaTask?.catch(() => {});
  }
  async open(png: Buffer, name: string) {
    if (this.ctx.blocked()) throw Error('应用正在退出');
    if (this.window || this.opening) {
      this.window?.show();
      this.window?.focus();
      throw Error('请先关闭当前文字识别窗口，再识别其他图片');
    }
    this.opening = true;
    try {
      await this.settling;
      if (this.ctx.blocked()) throw Error('应用正在退出');
      const base64 = png.toString('base64'),
        header = pngDimensions(base64);
      ocrDimensions(header.width, header.height);
      const decoded = decodePng(base64);
      try {
        ocrDimensions(decoded.size.width, decoded.size.height);
        this.size = decoded.size;
      } finally {
        decoded.data.fill(0);
      }
      this.png = Buffer.from(png);
      this.token = randomUUID();
      this.name = name.slice(0, 180);
      this.result = undefined;
      this.error = '';
      this.progress = 0;
      this.running = false;
      this.translating = false;
      this.formulaRecognizing = false;
      const window = this.ctx.createWindow();
      this.window = window;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.webContents.on('will-attach-webview', (e) => e.preventDefault());
      window.webContents.once('render-process-gone',()=>{if(!window.isDestroyed())window.destroy();});
      window.once('closed', () => {
        if (this.window === window) {
          this.window = undefined;
          this.clear();
        }
      });
      await window.loadURL(RECOGNITION_URL);
      if (this.window === window && !window.isDestroyed()) window.show();
    } catch (error) {
      const window = this.window;
      this.window = undefined;
      window?.destroy();
      this.clear(false);
      throw error;
    } finally {
      this.opening = false;
    }
  }
  private clear(cancelWorkflow = true) {
    this.workflow.closed(cancelWorkflow);
    this.token = '';
    this.png?.fill(0);
    this.png = undefined;
    this.result = undefined;
    this.models.cancel();
    this.settling = Promise.all([
      this.runner.cancel(),
      this.models.settle(),
      this.cancelTranslation(),
      this.translationStore.settle(),
      this.cancelFormula(),
      this.formulaStore.settle(),
    ]);
    void this.ctx.background(this.settling).catch(() => {});
  }
  async stop() {
    await this.sensitive.cancel();
    this.window?.destroy();
    this.window = undefined;
    this.clear();
    await this.settling;
  }
}
