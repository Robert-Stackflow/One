import {createHash} from 'node:crypto';
import {FormulaLocalPipeline,formulaInput,formulaInputSize,type FormulaLocalJob} from './formula-local';
let pipeline:FormulaLocalPipeline|undefined,key='',current:FormulaLocalJob|undefined,peak=0,busy=false;
const send=(value:unknown)=>{if(process.connected)process.send?.(value);};
function memory(){if(!current)return;peak=Math.max(peak,process.memoryUsage().rss);if(peak>current.memoryMiB*1024**2){send({id:current.id,ok:false,kind:'resource',error:'公式推理超过内存预算，输入已保留'});process.exit(70);}}
const timer=setInterval(memory,100);timer.unref();
process.on('message',async(job:FormulaLocalJob)=>{
  if(busy){send({id:job.id,ok:false,kind:'busy',error:'公式推理正在进行'});return;}
  busy=true;current=job;peak=process.memoryUsage().rss;let kind='input',pixels:Float32Array|undefined;
  try{
    const sourceSha256=createHash('sha256').update(job.png).digest('hex');pixels=await formulaInput(job.png,formulaInputSize(job.model));
    const identity=JSON.stringify([job.model,job.backend,job.deviceId]);
    if(identity!==key){await pipeline?.close();pipeline=undefined;key='';kind='loading';send({id:job.id,phase:'loading',progress:0});pipeline=await FormulaLocalPipeline.create(job.model,job.backend,job.deviceId);key=identity;}
    kind='inference';send({id:job.id,phase:'recognizing',progress:.2});const text=await pipeline!.run(pixels);memory();
    send({id:job.id,ok:true,result:{text,sourceSha256,model:job.model.id,revision:job.model.revision,actualBackend:job.backend,deviceId:job.backend==='dml'?job.deviceId:undefined,peakRSSMiB:Math.max(peak,process.resourceUsage().maxRSS*1024)/1024**2}});
  }catch(error){send({id:job.id,ok:false,kind,error:error instanceof Error?error.message:'本地公式推理失败'});await pipeline?.close().catch(()=>{});pipeline=undefined;key='';}
  finally{pixels?.fill(0);job.png.fill(0);current=undefined;busy=false;}
});
process.once('disconnect',()=>{void pipeline?.close().finally(()=>process.exit());if(!pipeline)process.exit();});
