import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from '../../src/main/recognition/llama-runtime-catalog';
import { deepseekOCRPresets } from '../../src/main/recognition/deepseek-models';
import { LlamaSession } from '../../src/main/recognition/llama-session';
import { readInferenceDevices, resolveCUDAInferenceDevice } from '../../src/main/inference-devices';

async function main(){
  const directory=process.env.ONE_MODEL_TEST_ROOT!,fixtures=resolve('work/current/capture-reconstruction/deepseek');
  const helper=resolve(process.env.ONE_INFERENCE_MONITOR||'work/current/capture-reconstruction/One.Monitor.Inference.exe');
  let network=0;const runtimes=new LlamaRuntimeStore(join(directory,'runtime'),async()=>{network++;throw Error('HTTP inference verification must stay offline');});
  const selected=resolveCUDAInferenceDevice({mode:'gpu'},await readInferenceDevices(undefined,helper));
  assert.equal(selected.backend,'cuda');
  const reports:unknown[]=[],png=await readFile(join(fixtures,'english.png')),mixed=await readFile(join(fixtures,'mixed-dark.png'));
  try{
    for(const backend of ['cpu','cuda'] as const){
      const profile=llamaRuntimeProfiles.find(value=>value.backend===backend)!;
      const sources=Object.fromEntries(profile.archives.map(archive=>[archive.id,join(fixtures,archive.name)]));
      await runtimes.install(backend,new AbortController().signal,()=>{},sources);
      const lease=await runtimes.acquire(backend);
      try{
        for(const preset of deepseekOCRPresets){
          const session=new LlamaSession({helper,executable:lease.executable,
            weights:join(fixtures,basename(new URL(preset.artifacts.find(file=>file.role==='language')!.url).pathname)),
            projector:join(fixtures,basename(new URL(preset.artifacts.find(file=>file.role==='vision')!.url).pathname)),
            controlDirectory:join(directory,'control'),preset,backend,deviceId:selected.deviceId,requestTimeoutMs:180000});
          const internal=session as unknown as {json:(...args:any[])=>Promise<{status:number;value:any}>},json=internal.json.bind(session);
          internal.json=async(...args)=>{
            const response=await json(...args);
            if(response.status!==200&&response.status!==503)console.error(JSON.stringify({backend,model:preset.generation,status:response.status,
              error:String(response.value?.error?.message||'').replace(/data:image\/[^\s"]+/g,'[image]').slice(0,300)}));
            return response;
          };
          try{
            const started=performance.now();await session.start(new AbortController().signal);const loadMs=performance.now()-started;
            for(let run=0;run<3;run++){
              const request=performance.now(),text=await session.recognize(run===2?mixed:png,new AbortController().signal);
              assert.match(text.replace(/\s/g,''),/ONEOCR2026/);
              if(run===2){assert.match(text.replace(/\s/g,''),/截图识别测试/);assert.match(text,/sample@example\.com/);}
              reports.push({backend,model:preset.generation,run,loadMs:Math.round(loadMs),requestMs:Math.round(performance.now()-request),peakRSSMiB:Math.round(session.peakRSSMiB),text});
              assert.ok(session.alive);
            }
          }finally{await session.close();}
        }
      }finally{lease.release();}
    }
    assert.equal(network,0);assert.deepEqual(await readdir(join(directory,'control')),[]);
    await writeFile(join(fixtures,'native-session-results.json'),JSON.stringify(reports,null,2));
    console.log(JSON.stringify({passed:reports.length,backends:['cpu','cuda'],models:['v1','v2'],warmReuse:true,changedImage:true,network}));
  }finally{png.fill(0);mixed.fill(0);await runtimes.stop();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
