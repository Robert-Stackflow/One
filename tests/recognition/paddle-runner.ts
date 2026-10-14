import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PaddleRunner } from '../../src/main/recognition/paddle-runner';
import type { PaddleModelFiles } from '../../src/main/recognition/paddle-job';
test('detector truncation fails explicitly instead of publishing a partial document or CPU retry',async()=>{
  const worker=join(process.env.ONE_RECOGNITION_TEST_ROOT!,'truncated-paddle.cjs');
  await writeFile(worker,"process.on('message',job=>process.send({id:job.id,ok:true,result:{width:1000,height:1000,language:job.language,text:'partial',words:[],confidence:90,truncated:true}}));");
  const artifact={path:'unused',bytes:1,sha256:'a'.repeat(64)},model:PaddleModelFiles={id:'fixture',revision:'1',detection:artifact,recognition:artifact,detectionConfig:artifact,recognitionConfig:artifact};
  const runner=new PaddleRunner(worker,3000);
  const phases:string[]=[];
  try{await assert.rejects(runner.run(Buffer.alloc(24),{width:1000,height:1000},'eng',model,{device:'auto',deviceId:0},(_,phase)=>phases.push(phase)),/文字区域过多.*输入已保留/);assert.ok(!phases.includes('cpu-fallback'));}
  finally{await runner.close();}
});
