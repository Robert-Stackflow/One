import {readFile,writeFile,mkdir,link,lstat,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {cpus,release,totalmem} from 'node:os';
import sharp from 'sharp';
import {parse} from 'yaml';
import {LocalModelStore,localModelIdentity} from '../../src/main/local-model-store';
import {paddleOCRPresets} from '../../src/main/local-model-catalog';
import {acquirePaddleModel} from '../../src/main/recognition/paddle-models';
import {PaddleRunner} from '../../src/main/recognition/paddle-runner';
import {OCRRunner} from '../../src/main/recognition/ocr-runner';
import {OCRModels} from '../../src/main/recognition/ocr-models';
import {recognizeOCRImage} from '../../src/main/recognition/ocr-image-task';
import type {OCRResult} from '../../src/shared/recognition/ocr';
import {ocrRect} from '../../src/shared/recognition/ocr-tiles';
import {paddleDetectionTiles} from '../../src/shared/recognition/paddle-dimensions';
import {readInferenceDevices} from '../../src/main/inference-devices';
import {ocrQualityScore,aggregateOCRQuality,ocrKeyRegionScores,type QualityRecord,type QualityKeyRegion} from './ocr-quality-metrics';

interface Sample {id:string;image:string;sha256:string;parentSha256:string;width:number;height:number;tags:string[];expected:string;annotation:{kind:string;reviewed:boolean};keyRegions?:QualityKeyRegion[]}
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const root=resolve('work/current/capture-reconstruction/ocr-quality'),fixtures=resolve('work/current/capture-reconstruction');
const option=(name:string,fallback:string)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1]||'';};
async function atomic(file:string,value:unknown){const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,file);}
async function immutable(file:string,bytes:Buffer){
  try{await writeFile(file,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==bytes.length||hash(await readFile(file))!==hash(bytes))throw Error('Frozen benchmark input differs from its fingerprint');}
}
async function main(){
  const manifestPath=resolve(option('--manifest',join(root,'corpus/manifest.json'))),manifestInfo=await lstat(manifestPath);
  if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink()||manifestInfo.size>2*1024**2)throw Error('Quality manifest exceeds 2 MiB or is not a regular file');
  const manifestBytes=await readFile(manifestPath);
  if(manifestBytes.length>2*1024**2)throw Error('Quality manifest exceeds 2 MiB');
  const manifest=JSON.parse(manifestBytes.toString('utf8')),samples:Sample[]=manifest.samples;
  if(manifest.schema!==1||!Array.isArray(samples)||!samples.length||samples.length>500)throw Error('Quality manifest schema is invalid');
  const ids=new Set<string>(),parents=new Set<string>(),images=new Map<string,Buffer>();let cachedBytes=0;
  for(const sample of samples){
    if(!/^[a-z0-9_-]{1,120}$/.test(sample.id)||ids.has(sample.id)||!/^[a-f0-9]{64}\.png$/.test(sample.image)||sample.image!==sample.sha256+'.png'||
      !/^[a-f0-9]{64}$/.test(sample.parentSha256)||typeof sample.expected!=='string'||!sample.expected.trim()||sample.expected.length>20000||
      !Array.isArray(sample.tags)||sample.tags.some(tag=>!/^[a-z0-9-]{1,40}$/.test(tag)))throw Error('Quality sample identity or reference is invalid');
    ids.add(sample.id);parents.add(sample.parentSha256);
    if(sample.keyRegions&&(!Array.isArray(sample.keyRegions)||sample.keyRegions.length>32))throw Error('Too many key regions');
    for(const region of sample.keyRegions||[]){ocrRect(region.rect,sample);if(typeof region.text!=='string'||!region.text.trim()||region.text.length>2048||!/^[a-z0-9-]{1,80}$/.test(region.id))throw Error('Invalid key region');}
    const file=join(dirname(manifestPath),'images',sample.image),stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024**2)throw Error('Quality sample file is invalid');
    const png=await readFile(file),info=await sharp(png,{limitInputPixels:40_000_000}).metadata();cachedBytes+=png.length;
    if(hash(png)!==sample.sha256||info.format!=='png'||info.width!==sample.width||info.height!==sample.height||cachedBytes>256*1024**2)throw Error('Quality sample hash/dimensions/cache budget differs');
    images.set(sample.id,png);
  }
  const selected=option('--models',['tesseract',...paddleOCRPresets.map(model=>model.id)].join(',')).split(',');
  const backend=option('--backend','cpu'),deviceId=Number(option('--device-id','0'));
  if(!['cpu','dml'].includes(backend)||!Number.isSafeInteger(deviceId)||deviceId<0||deviceId>255||backend==='cpu'&&deviceId!==0||backend==='dml'&&selected.includes('tesseract'))throw Error('Invalid benchmark backend/device selection');
  const devices=backend==='dml'?await readInferenceDevices(undefined,resolve('dist/native/One.Monitor.exe')):undefined;
  const device=devices?.gpus.find(gpu=>gpu.deviceId===deviceId);
  if(backend==='dml'&&(!device||!device.d3d12))throw Error(devices?.error||'Requested DXGI adapter is unavailable');
  const environment={platform:process.platform,arch:process.arch,node:process.version,os:release(),cpu:cpus()[0]?.model,memoryBytes:totalmem(),onnxruntime:require('onnxruntime-node/package.json').version,tesseract:require('tesseract.js/package.json').version};
  const settings={backend,deviceId,device,environment,models:selected,language:'chi_sim+eng'};
  const modelDirectory=process.argv.includes('--model-directory')?resolve(option('--model-directory','')):undefined;
  if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>id!=='tesseract'&&!paddleOCRPresets.some(model=>model.id===id)))throw Error('Unknown quality benchmark model');
  const workerNames=['paddle-worker.cjs','ocr-worker.cjs','ocr-engine.cjs','ocr-tile-worker.cjs'];
  const sourceBytes=await readFile(process.argv[1]),workerBytes=await Promise.all(workerNames.map(file=>readFile(resolve('dist/main/recognition',file))));
  const fingerprint=hash(Buffer.concat([manifestBytes,Buffer.from(JSON.stringify(settings)),sourceBytes,...workerBytes]));
  const output=join(root,'runs',fingerprint.slice(0,16));await mkdir(output,{recursive:true});
  const runtime=join(output,'runtime');await mkdir(runtime,{recursive:true});
  await Promise.all([immutable(join(output,'manifest.json'),manifestBytes),immutable(join(output,'runner.cjs'),sourceBytes),...workerNames.map((file,index)=>immutable(join(runtime,file),workerBytes[index]))]);
  const provenance={manifestSHA256:hash(manifestBytes),runnerSHA256:hash(sourceBytes),workers:Object.fromEntries(workerNames.map((name,index)=>[name,hash(workerBytes[index])]))};
  const worker=join(runtime,'paddle-worker.cjs'),ocrWorker=join(runtime,'ocr-worker.cjs'),tileWorker=join(runtime,'ocr-tile-worker.cjs');
  const offline=async()=>{throw Error('Quality benchmark must not download model weights');};
  const store=new LocalModelStore(join(output,'model-links'),offline),runner=new PaddleRunner(worker,120000,60000);
  const tesseract=new OCRRunner(new OCRModels(resolve(option('--languages','work/current/fixtures/recognition-models')),offline),ocrWorker,120000);
  const summary:Record<string,unknown>={};
  const eligibility={uniqueSourceImages:parents.size,localReviewed:samples.filter(s=>s.annotation?.reviewed).length,publicUpstreamText:samples.filter(s=>s.annotation?.kind==='upstream-text').length,
    acceptanceReady:false,defaultModelChanged:false,missing:['60 locally reviewed target screenshots across all required strata','complete text/geometry annotations','frozen default-quality thresholds'],
    note:'Public document/scene/UGC/Japanese data supplements target screenshots; it does not replace chat/code/rotation/long-image acceptance.'};
  try{for(const id of selected){
    const preset=paddleOCRPresets.find(model=>model.id===id),records:(QualityRecord&Record<string,unknown>)[]=[];
    let lease:Awaited<ReturnType<typeof acquirePaddleModel>>|undefined;
    if(preset){
      const installed=join(store.root,localModelIdentity(preset));await mkdir(installed,{recursive:true});
      const suffix:Record<string,string>={detection:'det.onnx',detectionConfig:'det.yml',recognition:'rec.onnx',recognitionConfig:'rec.yml'};
      for(const file of preset.artifacts){
        const source=modelDirectory?join(modelDirectory,localModelIdentity(preset),file.name):join(fixtures,file.role==='orientation'?'pp-textline-orientation.onnx':file.role==='orientationConfig'?'pp-textline-orientation.yml':preset.id.startsWith('pp-ocrv5-')?`paddle-v5/${preset.size}-${suffix[file.role]}`:`${preset.id}-${suffix[file.role]}`);
        const target=join(installed,file.name);if(!await lstat(target).catch(()=>undefined))await link(source,target);
      }
      lease=await acquirePaddleModel(store,preset.id);
      const detection=parse(await readFile(lease.model.detectionConfig.path,'utf8')).PreProcess?.transform_ops?.find((op:any)=>op?.DetResizeForTest)?.DetResizeForTest?.resize_long;
      if(detection!==preset.detectionResizeLong)throw Error('Detector resize policy differs from the verified preset configuration');
    }
    const modelOutput=join(output,id);await mkdir(modelOutput,{recursive:true});let tasks=0,previousProcess:number|undefined;
    try{for(const sample of samples){
      const file=join(modelOutput,sample.id+'.json');
      if(process.argv.includes('--resume')){const previous=await readFile(file,'utf8').then(JSON.parse).catch(()=>undefined);if(previous?.fingerprint===fingerprint&&previous.model===id&&previous.sampleHash===sample.sha256){records.push(previous);continue;}}
      let peak=process.memoryUsage().rss,nativePeak=0,chunks=0,status:'ok'|'failed'='ok',result:OCRResult|undefined,error:string|undefined;
      const observer=id==='tesseract'?setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},50):undefined;
      const started=performance.now();
      try{
        result=await recognizeOCRImage(images.get(sample.id)!,sample,new AbortController().signal,async(png,size,progress)=>{
          chunks++;
          if(!lease)return tesseract.run(png,size,'chi_sim+eng',progress);
          const value=await runner.run(png,size,'chi_sim+eng',lease.model,{device:backend==='cpu'?'cpu':'gpu',deviceId,memoryMiB:lease.preset.memoryBudgetMiB});
          nativePeak=Math.max(nativePeak,value.peakRSSMiB);return value;
        },()=>{},tileWorker,undefined,lease?paddleDetectionTiles(sample,lease.preset.detectionResizeLong):{});
      }catch(cause){status='failed';error=String(cause instanceof Error?cause.message:cause);}
      finally{clearInterval(observer);}
      const milliseconds=Math.round(performance.now()-started),score=ocrQualityScore(sample.expected,result?.text||'');
      const workerProcess=(runner as unknown as {child?:{pid?:number}}).child?.pid;
      const record={fingerprint,settings,model:id,revision:preset?.revision||'tessdata_fast@87416418657359cb625c412a48b6e1d6d41c29bd',sample:sample.id,sampleHash:sample.sha256,tags:sample.tags,status,error,milliseconds,chunks,
        peakRSSMiB:id==='tesseract'?Math.ceil(Math.max(peak,process.memoryUsage().rss)/1024**2):nativePeak||undefined,
        rssScope:id==='tesseract'?'benchmark-process-including-worker-and-input-cache':'isolated-native-worker',
        processCold:id==='tesseract'||!workerProcess||workerProcess!==previousProcess,score,keyRegions:ocrKeyRegionScores(result,sample.keyRegions||[]),result};
      previousProcess=workerProcess;
      await atomic(file,record);records.push(record);tasks++;
      if(tasks%10===0)console.log(id+': '+tasks+'/'+samples.length+' evaluated');
    }}finally{lease?.release();await runner.cancel();}
    summary[id]={...aggregateOCRQuality(records),cachePolicy:id==='tesseract'?'new worker per image':'same-preset worker reuse; first task includes load',
      rssScope:id==='tesseract'?'benchmark process including input cache':'isolated worker; not directly comparable to Tesseract scope'};
    await atomic(join(output,'summary.json'),{schema:1,fingerprint,settings,provenance,manifestSource:manifest.source,eligibility,
      keyRegionProtocol:'Token centers inside annotated rectangles; linear first-to-last copy and union bbox IoU. This proxy is not complete detection precision/recall or glyph accuracy.',models:summary});
    console.log(JSON.stringify({model:id,...(summary[id] as ReturnType<typeof aggregateOCRQuality>).total}));
  }}finally{await runner.close();await tesseract.cancel();for(const preset of paddleOCRPresets.filter(model=>selected.includes(model.id)))await store.remove(preset);for(const png of images.values())png.fill(0);}
  console.log('Quality report: '+join(output,'summary.json'));
}
void main().catch(error=>{console.error(error instanceof Error?error.stack:error);process.exitCode=1;});
