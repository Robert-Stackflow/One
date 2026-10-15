import {createHash} from 'node:crypto';
import {FormulaLocalPipeline,formulaInput,formulaInputSize,type FormulaLocalJob} from './formula-local';
import {Pix2TexPipeline} from './pix2tex-local';
import {pix2texInput,type PixGray} from './pix2tex-input';
let pipeline:FormulaLocalPipeline|Pix2TexPipeline|undefined,key='',current:FormulaLocalJob|undefined,peak=0,busy=false;
const send=(value:unknown)=>{if(process.connected)process.send?.(value);};
function memory(){if(!current)return;peak=Math.max(peak,process.memoryUsage().rss);if(peak>current.memoryMiB*1024**2){send({id:current.id,ok:false,kind:'resource',error:'公式推理超过内存预算，输入已保留'});process.exit(70);}}
const timer=setInterval(memory,100);timer.unref();
process.on('message',async(job:FormulaLocalJob)=>{
  if(busy){send({id:job.id,ok:false,kind:'busy',error:'公式推理正在进行'});return;}
  busy=true;current=job;peak=process.memoryUsage().rss;let kind='input',pixels:Float32Array|undefined,image:PixGray|undefined;
  try{
    const sourceSha256=createHash('sha256').update(job.png).digest('hex'),pix=job.model.engine==='pix2tex';if(pix)image=await pix2texInput(job.png);else pixels=await formulaInput(job.png,formulaInputSize(job.model));
    const identity=JSON.stringify([job.model,job.backend,job.deviceId]);
    if(identity!==key){await pipeline?.close();pipeline=undefined;key='';kind='loading';send({id:job.id,phase:'loading',progress:0});pipeline=pix?await Pix2TexPipeline.create(job.model,job.backend,job.deviceId):await FormulaLocalPipeline.create(job.model,job.backend,job.deviceId);key=identity;}
    kind='inference';send({id:job.id,phase:'recognizing',progress:.2});const text=pix?await (pipeline as Pix2TexPipeline).run(image!,undefined,value=>send({id:job.id,phase:'recognizing',progress:value})):await (pipeline as FormulaLocalPipeline).run(pixels!);memory();
    send({id:job.id,ok:true,result:{text,sourceSha256,model:job.model.id,revision:job.model.revision,actualBackend:job.backend,deviceId:job.backend==='dml'?job.deviceId:undefined,peakRSSMiB:Math.max(peak,process.resourceUsage().maxRSS*1024)/1024**2}});
  }catch(error){const failure=error as {kind?:string};send({id:job.id,ok:false,kind:['integrity','output'].includes(failure?.kind??'')?failure.kind:kind,error:error instanceof Error?error.message:'本地公式推理失败'});await pipeline?.close().catch(()=>{});pipeline=undefined;key='';}
  finally{pixels?.fill(0);image?.data.fill(0);job.png.fill(0);current=undefined;busy=false;}
});
process.once('disconnect',()=>{void pipeline?.close().finally(()=>process.exit());if(!pipeline)process.exit();});
