import { copyFile, link, mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { localModelIdentity } from '../../src/main/local-model-store';
import { deepseekOCRPresets } from '../../src/main/recognition/deepseek-models';
import { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from '../../src/main/recognition/llama-runtime-catalog';
async function main(){
  const profile=process.env.ONE_MODEL_UI_PROFILE!,fixtures=resolve('work/current/capture-reconstruction/deepseek');
  await mkdir(join(profile,'recognition','models'),{recursive:true});
  for(const language of ['eng','chi_sim'])await copyFile(resolve('work/current/fixtures/recognition-models',language+'.traineddata'),join(profile,'recognition','models',language+'.traineddata'));
  for(const preset of deepseekOCRPresets){
    const installed=join(profile,'models','library',localModelIdentity(preset));await mkdir(installed,{recursive:true});
    for(const artifact of preset.artifacts)await link(join(fixtures,basename(new URL(artifact.url).pathname)),join(installed,artifact.name));
  }
  const store=new LlamaRuntimeStore(join(profile,'models','runtimes','llama'),async()=>{throw Error('Native UI fixture must stay offline');});
  try{
    for(const backend of ['cpu','cuda'] as const){
      const value=llamaRuntimeProfiles.find(value=>value.backend===backend)!;
      await store.install(backend,new AbortController().signal,()=>{},Object.fromEntries(value.archives.map(archive=>[archive.id,join(fixtures,archive.name)])));
    }
  }finally{await store.stop();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
