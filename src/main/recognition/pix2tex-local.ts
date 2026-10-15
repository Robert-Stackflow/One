/** Adapted from pix2tex 0.1.4, Copyright (c) 2021 Lukas Blecher.
 * MIT notice: assets/licenses/pix2tex-LICENSE.txt.
 */
import * as ort from 'onnxruntime-node';
import {pix2texDecoder,pix2texOutputError as outputError} from './pix2tex-decoder';
import {formulaArtifact,type FormulaModelFiles} from './formula-local';
import {pix2texNative} from './pix2tex-catalog';
import {pix2texPad,pix2texSize,pix2texResize,pix2texTensor,type PixGray} from './pix2tex-input';

function argmax(value:ort.Tensor,count:number){
  if(value.type!=='float32'||!(value.data instanceof Float32Array)||value.data.length!==count||value.dims.length!==2||value.dims[0]!==1||value.dims[1]!==count)throw outputError('公式模型输出类型无效');
  let best=0;for(let i=0;i<count;i++){if(!Number.isFinite(value.data[i]))throw Error('公式推理出现无效数值');if(value.data[i]>value.data[best])best=i;}return best;
}
export class Pix2TexPipeline {
  private active?:Promise<string>;private closed=false;private closing?:Promise<void>;
  private constructor(private sessions:Record<'encoder'|'decoder'|'resizer',ort.InferenceSession>,private decode:ReturnType<typeof pix2texDecoder>){}
  static async create(model:FormulaModelFiles,backend:'cpu'|'dml',deviceId:number){
    const sessions:Partial<Record<'encoder'|'decoder'|'resizer',ort.InferenceSession>>={},buffers:Buffer[]=[];let kind='integrity';
    try{
      if(model.engine!=='pix2tex'||model.id!==pix2texNative.id||model.revision!==pix2texNative.revision)throw Error('pix2tex 模型身份无效');
      const files={encoder:model.onnx,decoder:model.decoder,resizer:model.resizer,tokenizer:model.config};
      for(const [name,file] of Object.entries(files)){const expected=pix2texNative[name as keyof typeof files];if(!file||file.bytes!==expected.bytes||file.sha256!==expected.sha256)throw Error('pix2tex 模型配置与预设不一致');}
      const config=await formulaArtifact(model.config,1024*1024);buffers.push(config);const decode=pix2texDecoder(JSON.parse(config.toString('utf8')));
      for(const name of ['encoder','decoder','resizer'] as const){const buffer=await formulaArtifact(files[name]!,128*1024*1024);buffers.push(buffer);}
      kind='loading';for(const [index,name] of (['encoder','decoder','resizer'] as const).entries()){
        const session=await ort.InferenceSession.create(buffers[index+1],{executionProviders:backend==='dml'?[{name:'dml',deviceId}]:['cpu'],executionMode:'sequential',enableMemPattern:backend==='cpu',intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});sessions[name]=session;
        if(JSON.stringify([...session.inputNames].sort())!==JSON.stringify(name==='decoder'?['context','ids']:['image'])||JSON.stringify(session.outputNames)!==JSON.stringify([name==='encoder'?'encoded':'logits']))throw Error('pix2tex 模型输入输出不兼容');
      }
      return new Pix2TexPipeline(sessions as Record<'encoder'|'decoder'|'resizer',ort.InferenceSession>,decode);
    }catch(error){await Promise.all(Object.values(sessions).map(session=>session!.release()));throw Object.assign(error instanceof Error?error:Error('pix2tex 模型加载失败'),{kind});}
    finally{for(const buffer of buffers)buffer.fill(0);}
  }
  run(image:PixGray,signal?:AbortSignal,progress:(value:number)=>void=()=>{}){
    if(this.closed||this.active)throw Error('公式模型当前不可用');
    signal?.throwIfAborted();if(![image.width,image.height].every(value=>Number.isInteger(value)&&value>=32)||image.width>672||image.height>192||!(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height)throw Error('pix2tex 预处理输入无效');
    const task=this.recognize({...image,data:image.data.slice()},signal,progress);this.active=task;return task.finally(()=>{if(this.active===task)this.active=undefined;});
  }
  private async recognize(source:PixGray,signal:AbortSignal|undefined,progress:(value:number)=>void){
    let image:PixGray|undefined,pixels:Float32Array|undefined,context:ort.Tensor|undefined;
    try{
      let ratio=1,width=source.width,height=source.height;
      for(let step=0;step<10;step++){
        signal?.throwIfAborted();height=Math.trunc(height*ratio);const resized=pix2texResize(source,width,height,ratio>1);let sized:PixGray|undefined;
        try{sized=pix2texSize(resized);image?.data.fill(0);image=pix2texPad(sized);}finally{resized.data.fill(0);sized?.data.fill(0);}
        pixels?.fill(0);pixels=pix2texTensor(image);const result=(await this.sessions.resizer.run({image:new ort.Tensor('float32',pixels,[1,1,image.height,image.width])})).logits;width=(argmax(result,21)+1)*32;
        if(width===image.width)break;ratio=width/image.width;
      }
      signal?.throwIfAborted();context=(await this.sessions.encoder.run({image:new ort.Tensor('float32',pixels!,[1,1,image!.height,image!.width])})).encoded;
      if(context.type!=='float32'||context.dims.length!==3||context.dims[0]!==1||context.dims[1]!==image!.width/16*(image!.height/16)+1||context.dims[2]!==256)throw outputError('公式编码器输出无效');
      const ids=[1],generated:number[]=[];
      for(let index=0;index<512;index++){
        signal?.throwIfAborted();const input=new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]),result=(await this.sessions.decoder.run({ids:input,context})).logits,next=argmax(result,8000);generated.push(next);ids.push(next);if(index%8===0||next===2)progress(.2+.75*(index+1)/512);
        if(next===2){signal?.throwIfAborted();return this.decode(generated);}
      }
      throw outputError('公式输出未完整结束，请裁剪后重试');
    }finally{source.data.fill(0);image?.data.fill(0);pixels?.fill(0);if(context?.data instanceof Float32Array)context.data.fill(0);}
  }
  close(){if(!this.closing){this.closed=true;this.closing=(async()=>{await this.active?.catch(()=>{});await Promise.all(Object.values(this.sessions).map(session=>session.release()));})();}return this.closing;}
}
