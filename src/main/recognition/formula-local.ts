import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {formulaOutput,FORMULA_IMAGE} from '../../shared/recognition/formula';
import type {PaddleArtifact,PaddlePreferences} from './paddle-job';
import {formulaProfiles} from './formula-model-catalog';
export interface FormulaModelFiles {id:string;revision:string;onnx:PaddleArtifact;config:PaddleArtifact}
export interface FormulaLocalJob {id:number;png:Buffer;model:FormulaModelFiles;backend:'cpu'|'dml';deviceId:number;memoryMiB:number}
export interface FormulaLocalResult {text:string;sourceSha256:string;model:string;revision:string;actualBackend:'cpu'|'dml';deviceId?:number;peakRSSMiB:number;fallbackReason?:string}
export type FormulaLocalPreferences=PaddlePreferences&{automaticBackend?:'cpu'|'dml'};
async function artifact(file:PaddleArtifact,limit:number){
  const stat=await lstat(file.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||file.bytes<1||file.bytes>limit||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('公式模型文件无效');
  const bytes=await readFile(file.path);if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256){bytes.fill(0);throw Error('公式模型校验失败');}return bytes;
}
/** Single-equation crop/letterbox; large decoding and resize stay in the child. */
export async function formulaInput(png:Buffer){
  if(png.length<24||png.length>FORMULA_IMAGE||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('公式图片支持最多 8 MiB PNG');
  const {data,info}=await sharp(png,{limitInputPixels:4_194_304}).flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const gray=new Uint8Array(info.width*info.height);let low=255,high=0;
  for(let i=0;i<gray.length;i++){const at=i*3,value=(data[at]*19595+data[at+1]*38470+data[at+2]*7471+32768)>>16;gray[i]=value;low=Math.min(low,value);high=Math.max(high,value);}
  if(high-low<8){data.fill(0);gray.fill(0);throw Error('未检测到可识别的公式笔画');}
  let left=info.width,right=0,top=info.height,bottom=0;const threshold=low+(high-low)*200/255;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(gray[y*info.width+x]<threshold){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
  const width=right-left,height=bottom-top,short=Math.min(width,height),w=width<=height?384:Math.floor(384*width/height),h=height<=width?384:Math.floor(384*height/width);
  if(short<2||w*h>8_388_608){data.fill(0);gray.fill(0);throw Error('公式区域过于狭长，请分段裁剪后识别');}
  try{
    const enlarged=await sharp(data,{raw:{width:info.width,height:info.height,channels:3}}).extract({left,top,width,height}).resize(w,h,{kernel:'linear'}).raw().toBuffer();
    try{
      const scaled=await sharp(enlarged,{raw:{width:w,height:h,channels:3}}).resize({width:384,height:384,fit:'inside',withoutEnlargement:true,kernel:'cubic'}).raw().toBuffer({resolveWithObject:true});
      const output=new Float32Array(384*384);output.fill(-.7931/.1738);const dx=Math.floor((384-scaled.info.width)/2),dy=Math.floor((384-scaled.info.height)/2);
      for(let y=0;y<scaled.info.height;y++)for(let x=0;x<scaled.info.width;x++){const at=(y*scaled.info.width+x)*3;output[(y+dy)*384+x+dx]=((scaled.data[at]*.114+scaled.data[at+1]*.587+scaled.data[at+2]*.299)/255-.7931)/.1738;}
      scaled.data.fill(0);return output;
    }finally{enlarged.fill(0);}
  }finally{data.fill(0);gray.fill(0);}
}
export function formulaDecoder(config:unknown){
  const value=config as any,tokenizer=value?.PostProcess?.character_dict?.fast_tokenizer_file;
  const profile=formulaProfiles.find(profile=>profile.modelName===value?.Global?.model_name);
  if(!profile||tokenizer?.decoder?.type!=='ByteLevel'||!tokenizer.model?.vocab||!Array.isArray(tokenizer.added_tokens))throw Error('公式模型配置不兼容');
  const vocabulary=new Map<number,string>();for(const [text,id] of Object.entries(tokenizer.model.vocab)){if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||id>100000||text.length>2000||vocabulary.has(id))throw Error('公式字典无效');vocabulary.set(id,text);}
  if(vocabulary.size!==50000)throw Error('公式字典不完整');
  const special=new Set<number>(tokenizer.added_tokens.filter((t:any)=>t.special===true).map((t:any)=>t.id));
  const bytes:number[]=[];for(let n=33;n<=126;n++)bytes.push(n);for(let n=161;n<=172;n++)bytes.push(n);for(let n=174;n<=255;n++)bytes.push(n);
  const points=[...bytes];for(let n=0,index=0;n<256;n++)if(!bytes.includes(n)){bytes.push(n);points.push(256+index++);}
  const inverse=new Map(points.map((point,index)=>[String.fromCodePoint(point),bytes[index]]));
  return (ids:BigInt64Array)=>{
    if(!ids.length||ids.length>profile.maxTokens||!ids.includes(2n))throw Error('公式输出未完整结束，请裁剪后重试');
    const output:number[]=[];for(const value of ids){if(value===2n)break;const id=Number(value);if(special.has(id))continue;const word=vocabulary.get(id);if(!word)throw Error('公式输出包含未知字符');for(const char of word){const byte=inverse.get(char);if(byte===undefined)throw Error('公式字符编码无效');output.push(byte);}}
    return formulaOutput(new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array(output)));
  };
}
export class FormulaLocalPipeline {
  private constructor(private session:ort.InferenceSession,private decode:ReturnType<typeof formulaDecoder>){}
  static async create(model:FormulaModelFiles,backend:'cpu'|'dml',deviceId:number){
    const profile=formulaProfiles.find(profile=>profile.source.id===model.id&&profile.source.revision===model.revision&&profile.output.sha256===model.onnx.sha256);
    if(!profile||!profile.source.backends.includes(backend))throw Error('公式预设尚未适配此运行器');
    const buffers:Buffer[]=[];let session:ort.InferenceSession|undefined;
    try{
      if(model.config.sha256!==profile.source.artifacts.find(file=>file.role==='config')!.sha256||model.onnx.bytes!==profile.output.bytes)throw Error('公式模型配置与预设不一致');
      const config=await artifact(model.config,8*1024*1024);buffers.push(config);const decode=formulaDecoder(JSON.parse(config.toString('utf8')));
      const weights=await artifact(model.onnx,1024*1024*1024);buffers.push(weights);
      session=await ort.InferenceSession.create(weights,{executionProviders:backend==='dml'?[{name:'dml',deviceId}]:['cpu'],executionMode:'sequential',enableMemPattern:backend==='cpu',intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3});
      if(session.inputNames.length!==1||session.outputNames.length!==1)throw Error('公式模型输入输出不兼容');
      return new FormulaLocalPipeline(session,decode);
    }catch(error){await session?.release();throw error;}finally{for(const buffer of buffers)buffer.fill(0);}
  }
  async run(pixels:Float32Array){const values=await this.session.run({[this.session.inputNames[0]]:new ort.Tensor('float32',pixels,[1,1,384,384])}),output=values[this.session.outputNames[0]];if(output.type!=='int64'||!(output.data instanceof BigInt64Array))throw Error('公式输出类型无效');return this.decode(output.data);}
  close(){return this.session.release();}
}
