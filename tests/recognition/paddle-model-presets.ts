import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalModelStore } from '../../src/main/local-model-store';
import type { LocalModelDescriptor } from '../../src/shared/local-models';
import { paddleOCRPresets,paddleSmallModel,paddleMediumModel } from '../../src/main/local-model-catalog';
import { acquirePaddleModel } from '../../src/main/recognition/paddle-models';

test('known preset identity controls artifact pairing and resource budget',async()=>{
  let acquired=0,released=0;
  const store={acquire:async(model:LocalModelDescriptor)=>{
    acquired++;return {model,files:model.artifacts.map(file=>({...file,path:'/cache/'+file.name})),release:()=>released++};
  }} as unknown as LocalModelStore;
  for(const preset of paddleOCRPresets){
    const lease=await acquirePaddleModel(store,preset.id);assert.equal(lease.preset,preset);
    assert.equal(!!lease.model.orientation,preset.id!=='pp-ocrv6-tiny');
    assert.equal(!!lease.model.orientationConfig,!!lease.model.orientation);lease.release();
  }
  const changedBudget={...paddleSmallModel,memoryBudgetMiB:128};
  const lease=await acquirePaddleModel(store,changedBudget);
  assert.equal(lease.preset.memoryBudgetMiB,paddleSmallModel.memoryBudgetMiB);lease.release();
  const previous=acquired;
  for(const descriptor of [
    {...paddleSmallModel,revision:'unknown'},
    {...paddleSmallModel,artifacts:paddleSmallModel.artifacts.filter(file=>file.role!=='orientationConfig')},
    {...paddleSmallModel,artifacts:paddleSmallModel.artifacts.map(file=>file.role==='recognition'?paddleMediumModel.artifacts.find(file=>file.role==='recognition')!:file)},
  ])await assert.rejects(acquirePaddleModel(store,descriptor),/尚未适配/);
  assert.equal(acquired,previous,'unknown or mixed presets never acquire a cache lease');assert.equal(released,acquired);
});
