import { randomUUID } from 'node:crypto';
import { pngDimensions } from '../capture/clipboard';
import { OCRImagePreview } from './image-preview';
import { ocrLanguage, ocrText, type OCRLanguage, type OCRResult } from '../../shared/recognition/ocr';
import type { TranslationConnection, TranslationResult } from '../../shared/recognition/translation';
import { TranslationClient } from './translation-client';
import { selectedOCRRegion,replaceOCRSelection } from '../../shared/recognition/text-region';
import { correctOCRWord } from '../../shared/recognition/text-correction';
import { prepareOCRRectangle,replaceOCRRectangle } from '../../shared/recognition/text-area';
import type { OCRRect } from '../../shared/recognition/ocr-tiles';

export interface InlineEngine {
  run(png: Buffer, size: { width: number; height: number }, language: OCRLanguage, signal: AbortSignal): Promise<OCRResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  unload?(id?:string):Promise<void>;
  region?(png:Buffer,size:{width:number;height:number},language:OCRLanguage,signal:AbortSignal,region:OCRRect):Promise<OCRResult>;
}
interface ImageSession {
  id: string; source: string; png: Buffer; size: { width: number; height: number };
  engine: InlineEngine; preview: OCRImagePreview; translation: TranslationClient;
  abort?: AbortController; task?: Promise<OCRResult | TranslationResult>;
  result?:OCRResult;
  documentRevision?:number;
}
/** No window, implicit download or global cancellation. Each owner keeps one frozen input. */
export class InlineOCRSessions {
  private images = new Map<number, ImageSession>();
  private preparing = new Map<number, Promise<unknown>>();
  private settling = new Set<Promise<void>>();
  private cleanupError?: unknown;
  private closed = false;
  constructor(private create: () => InlineEngine, private connection: () => Promise<TranslationConnection>,private translationClient:(owner:number)=>TranslationClient=()=>new TranslationClient()) {}
  prepare(owner: number, source: string, value: string) {
    if (this.closed || this.preparing.has(owner)) return Promise.reject(Error('图片识别正在准备'));
    const task = (async () => {
      const size = pngDimensions(value), png = Buffer.from(value, 'base64');
      try {
        await this.releaseOwner(owner);
        if (this.closed) throw Error('图片识别已关闭');
        if ([...this.images.values()].reduce((sum, image) => sum + image.png.length, png.length) > 128 * 1024 * 1024)
          throw Error('图片识别缓存已满，请先关闭其他图片选字');
        const id = randomUUID();
        this.images.set(owner, { id, source, png, size, engine: this.create(), preview: new OCRImagePreview(png, size), translation: this.translationClient(owner) });
        return { id, ...size };
      } catch (error) { png.fill(0); throw error; }
    })();
    this.preparing.set(owner, task);
    return task.finally(() => { if (this.preparing.get(owner) === task) this.preparing.delete(owner); });
  }
  private image(owner: number, id: unknown) {
    const image = this.images.get(owner);
    if (this.closed || !image || image.id !== id) throw Error('图片选字已失效');
    return image;
  }
  source(owner: number, id: unknown) { return this.image(owner, id).source; }
  preview(owner: number, id: unknown, region: unknown) { return this.image(owner, id).preview.request(region); }
  private work<T extends OCRResult | TranslationResult>(owner: number, id: unknown, action: (image: ImageSession, signal: AbortSignal) => Promise<T>) {
    const image = this.image(owner, id);
    if (image.task) throw Error('请先结束当前识别或翻译');
    const abort = image.abort = new AbortController();
    const task = Promise.resolve().then(() => { abort.signal.throwIfAborted(); return action(image, abort.signal); }).then(result => {
      abort.signal.throwIfAborted(); if (this.images.get(owner) !== image) throw Error('图片选字已失效');
      if('words' in result){if(result.document){image.documentRevision=Math.max((image.documentRevision||0)+1,result.document.revision||0);result.document.revision=image.documentRevision;result.document.id=result.document.id.replace(/:r\d+$/,'')+`:r${image.documentRevision}`;}image.result=result;}return result;
    });
    image.task = task;
    return task.finally(() => { if (image.task === task) { image.task = undefined; image.abort = undefined; } });
  }
  run(owner: number, id: unknown, language: unknown) {
    const parsed = ocrLanguage(language);
    return this.work(owner, id, (image, signal) => image.engine.run(image.png, image.size, parsed, signal));
  }
  region(owner:number,id:unknown,language:unknown,value:unknown){
    const parsed=ocrLanguage(language),image=this.image(owner,id),base=image.result;
    if(image.task)throw Error('请先结束当前识别或翻译');
    const rectangle=value&&typeof value==='object'&&Object.hasOwn(value,'region')?prepareOCRRectangle(base,image.size,value):undefined;
    if((!base&&!rectangle)||!image.engine.region)throw Error('请先识别全文');
    const region=rectangle||selectedOCRRegion(base!,value);
    return this.work(owner,id,async(image,signal)=>{
      const patch=await image.engine.region!(image.png,image.size,parsed,signal,region.context);signal.throwIfAborted();
      return rectangle?replaceOCRRectangle(base,patch,rectangle.selection):replaceOCRSelection(base!,patch,region.selection as import('../../shared/recognition/text-region').OCRRegionSelection);
    });
  }
  correct(owner:number,id:unknown,selection:unknown,text:unknown){
    const image=this.image(owner,id);
    if(image.task)throw Error('请先结束当前识别或翻译');
    if(!image.result)throw Error('请先识别全文');
    const result=correctOCRWord(image.result,selection,text);
    image.result=result;image.documentRevision=result.document!.revision||image.documentRevision;
    return result;
  }
  translate(owner: number, id: unknown, text: unknown, target: unknown) {
    return this.work(owner, id, async (image, signal) => {
      const connection = await this.connection(); signal.throwIfAborted();
      const result=await image.translation.run(connection, text, target);signal.throwIfAborted();
      if((await this.connection()).revision!==connection.revision)throw Error('翻译服务已改变，请重新翻译');
      return result;
    });
  }
  copy(owner: number, id: unknown, text: unknown) { this.image(owner, id); return ocrText(text); }
  private async cancelImage(image: ImageSession) {
    image.abort?.abort();
    await Promise.all([image.engine.cancel(), image.translation.cancel(), image.task?.catch(() => {})]);
  }
  cancel(owner: number, id: unknown) { return this.cancelImage(this.image(owner, id)); }
  async unload(id?:string){await Promise.all([...this.images.values()].filter(image=>!image.task).map(image=>image.engine.unload?.(id)));}
  releaseOwner(owner: number, id?: unknown):Promise<void> {
    const image = this.images.get(owner);
    if (!image || id !== undefined && image.id !== id) return Promise.resolve();
    this.images.delete(owner);
    const task=(async()=>{
      try { await Promise.all([this.cancelImage(image), image.engine.close(), image.preview.close()]); }
      finally { image.png.fill(0); }
    })();
    this.settling.add(task);void task.then(()=>this.settling.delete(task),error=>{this.settling.delete(task);this.cleanupError=error;});
    return task;
  }
  async stop() {
    this.closed = true;
    await Promise.allSettled([...this.preparing.values(), ...this.settling, ...[...this.images.keys()].map(owner => this.releaseOwner(owner))]);
    if(this.cleanupError)throw this.cleanupError;
  }
}
