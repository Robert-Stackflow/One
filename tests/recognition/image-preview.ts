import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePreviewRequest,imageTilePlan,needsImagePreview } from '../../src/shared/recognition/image-preview';
test('preview requests have bounded decoded dimensions and exact source scope',()=>{
  const size={width:680,height:10000},valid={view:0,left:0,top:0,width:680,height:10000,downsample:10};
  assert.deepEqual(imagePreviewRequest(valid,size),valid);assert.equal(needsImagePreview(size),true);assert.equal(needsImagePreview({width:680,height:120}),false);
  for(const update of [{view:-1},{downsample:0},{downsample:1},{left:-1},{top:10000},{width:NaN},{height:0},{view:2**31},{path:'../secret'}])assert.throws(()=>imagePreviewRequest({...valid,...update},size));
});
test('visible raster plans bound bitmap count, preserve the viewport and keep resampling context',()=>{
  const size={width:4000,height:10000};
  for(const scale of [.05,.25,1,8])for(const density of [1,1.5,2,4]){
    const bounds={left:1200,top:4500,right:1200+900/scale,bottom:4500+700/scale};
    const plan=imageTilePlan(size,bounds,scale,density);assert.ok(plan.length>0&&plan.length<=64);
    for(const tile of plan){imagePreviewRequest({view:1,...tile.region},size);assert.ok(Math.ceil(tile.region.width/tile.region.downsample)<=518);assert.ok(tile.region.left<=tile.core.left&&tile.region.top<=tile.core.top);}
    const required=plan.filter(tile=>tile.required);
    assert.ok(required.some(tile=>tile.core.left<=1200&&tile.core.left+tile.core.width>1200&&tile.core.top<=4500&&tile.core.top+tile.core.height>4500));
  }
  assert.deepEqual(imageTilePlan(size,{left:-1000,top:-1000,right:-1,bottom:-1},1,1),[]);
  assert.deepEqual(imageTilePlan(size,{left:0,top:0,right:10,bottom:10},NaN,1),[]);
});
