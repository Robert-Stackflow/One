import { join } from 'node:path';
import type { OCRLanguage, OCRResult } from '../../shared/recognition/ocr';
import { OCRModels } from './ocr-models';
import { OCRRunner } from './ocr-runner';
import { PaddleRunner } from './paddle-runner';
import { LlamaRunner } from './llama-runner';
import { LlamaRuntimeStore } from './llama-runtime-store';
import { LocalModelManager } from '../local-model-manager';
import { deepseekOCRPresets } from './deepseek-models';
import { acquirePaddleModel } from './paddle-models';
import { readInferenceDevices, resolveInferenceDevice } from '../inference-devices';
import { recognizeOCRImage } from './ocr-image-task';
import { needsOCRTiles } from '../../shared/recognition/ocr-tiles';
import type { OCRRect } from '../../shared/recognition/ocr-tiles';
interface Context { models:LocalModelManager; runner:OCRRunner; paddle:PaddleRunner; native:LlamaRunner }
/** Every entry point uses the same selected model, device policy and tiled inference. */
export async function inferOCRImage(context:Context,png:Buffer,size:{width:number;height:number},language:OCRLanguage,
  signal:AbortSignal,progress:(value:number)=>void=()=>{},region?:OCRRect):Promise<OCRResult>{
      const choice = await context.models.selection('ocr');
      signal.throwIfAborted();
      const releaseUse = context.models.use(choice.modelId);
      try {
        if (choice.modelId === 'tesseract') {
          const result = await recognizeOCRImage(png,size,signal,
            (png,size,progress)=>context.runner.run(png,size,language,progress),
            progress,undefined,region);
          result.inference = { model: 'Tesseract fast', backend: 'cpu', device: 'CPU' }; return result;
        }
        if(deepseekOCRPresets.some(model=>model.id===choice.modelId)){
          if(region)throw Error('当前 DeepSeek 模型不提供字词坐标，请选择 Tesseract 或 PP-OCRv6 后局部识别；原文已保留');
          if(needsOCRTiles(size))throw Error('DeepSeek 当前不支持长图分块，请选择 Tesseract 或 PP-OCRv6；输入已保留');
          return await context.native.run(png,size,language,choice.modelId,choice.device);
        }
        const lease = await acquirePaddleModel(context.models.store, choice.modelId);
        try {
          signal.throwIfAborted();
          const pixels = region ? region.width*region.height : size.width * size.height;
          const devices = choice.device.mode === 'cpu' || choice.device.mode === 'auto' && pixels < 1_000_000 && !choice.device.gpu ? { gpus: [] }
            : await readInferenceDevices(signal, process.env.ONE_TEST_MODE === '1' ? process.env.ONE_INFERENCE_MONITOR : undefined);
          const selected = resolveInferenceDevice(choice.device, devices, pixels);
          signal.throwIfAborted();
          let cpuFallback=false;
          return await recognizeOCRImage(png,size,signal,async(png,size,progress)=>{
            const result=await context.paddle.run(png,size,language,lease.model,
              {device:cpuFallback||selected.backend==='cpu'?'cpu':choice.device.mode==='auto'?'auto':'gpu',deviceId:selected.gpu?.deviceId??0,memoryMiB:lease.preset.memoryBudgetMiB},progress);
            if(result.fallbackReason)cpuFallback=true;
            result.inference={model:lease.preset.title+' '+lease.preset.size,backend:result.actualBackend,
              device:result.actualBackend==='dml'?selected.gpu!.name+' · '+selected.gpu!.deviceId:'CPU',fallbackReason:result.fallbackReason||selected.reason};return result;
          },progress,undefined,region);
        } finally { lease.release(); }
      } finally { releaseUse(); }
}
export class InlineOCREngine {
  private runner:OCRRunner;
  private paddle=new PaddleRunner();
  private native:LlamaRunner;
  constructor(private models:LocalModelManager,packs:OCRModels,runtimes:LlamaRuntimeStore,directory:string){
    this.runner=new OCRRunner(packs);this.native=new LlamaRunner(models.store,runtimes,join(directory,'native-sessions'));
  }
  async run(png:Buffer,size:{width:number;height:number},language:OCRLanguage,signal:AbortSignal){
    const cancel=()=>{void this.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{signal.throwIfAborted();return await inferOCRImage({models:this.models,runner:this.runner,paddle:this.paddle,native:this.native},png,size,language,signal);}
    finally{signal.removeEventListener('abort',cancel);}
  }
  async region(png:Buffer,size:{width:number;height:number},language:OCRLanguage,signal:AbortSignal,region:OCRRect){
    const cancel=()=>{void this.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{signal.throwIfAborted();return await inferOCRImage({models:this.models,runner:this.runner,paddle:this.paddle,native:this.native},png,size,language,signal,undefined,region);}
    finally{signal.removeEventListener('abort',cancel);}
  }
  async cancel(){await Promise.all([this.runner.cancel(),this.paddle.cancel(),this.native.cancel()]);}
  unload(id?:string){return this.native.unload(id);}
  async close(){await this.runner.cancel();await Promise.all([this.paddle.close(),this.native.close()]);}
}
