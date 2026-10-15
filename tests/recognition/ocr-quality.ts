import test from 'node:test';
import assert from 'node:assert/strict';
import {ocrCanonical,ocrEditDistance,ocrQualityScore,aggregateOCRQuality,ocrKeyRegionScores} from '../../scripts/benchmarks/ocr-quality-metrics';
import {textDocument} from '../../src/shared/recognition/text-document';
import type {OCRResult} from '../../src/shared/recognition/ocr';
test('quality normalization retains punctuation/case while reporting whitespace separately',()=>{
  assert.equal(ocrCanonical('Ａ　b\n中文'),'Ab中文');assert.equal(ocrQualityScore('A B','AB').cer,0);
  assert.equal(ocrQualityScore('A B','AB').strictErrors,1);assert.equal(ocrQualityScore('AB','ab').errors,2);
  assert.equal(ocrQualityScore('中😀文','中😃文').errors,1);assert.equal(ocrEditDistance('kitten','sitting'),3);
  assert.ok(ocrQualityScore('x','xxxx').cer>1);assert.throws(()=>ocrQualityScore('  ','x'),/reference/);
});
test('bit-vector edit distance matches independent dynamic programming, including long Unicode strings',()=>{
  function reference(a:string,b:string){const x=Array.from(a),y=Array.from(b);let previous=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const current=[i];for(let j=1;j<=y.length;j++)current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(x[i-1]===y[j-1]?0:1));previous=current;}return previous[y.length];}
  let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;},letters=['a','b','中','文','😀'];
  for(let iteration=0;iteration<200;iteration++){const make=()=>Array.from({length:random()%75},()=>letters[random()%letters.length]).join(''),a=make(),b=make();assert.equal(ocrEditDistance(a,b),reference(a,b));}
  assert.equal(ocrEditDistance('中文'.repeat(1500),'中文'.repeat(1499)+'测试'),2);
});
test('quality aggregation counts failed images as missing text and separates weighted from macro error',()=>{
  const base={milliseconds:10,tags:['document']};
  const records=[{...base,status:'ok' as const,score:ocrQualityScore('abcdefghij','abcdefghij')},{...base,status:'failed' as const,score:ocrQualityScore('xy','')}];
  const report=aggregateOCRQuality(records);assert.equal(report.total.failed,1);assert.equal(report.total.cer,2/12);assert.equal(report.total.macroCER,.5);assert.equal(report.total.exact,1);assert.equal(report.strata.document.samples,2);
  const swapped=ocrQualityScore('abc','bca');assert.equal(swapped.orderFreeErrors,0);assert.ok(swapped.errors>0);assert.equal(aggregateOCRQuality([]).total.cer,null);
});
test('key-region proxy reports copied text and coverage without labeling it detector accuracy',()=>{
  const result:OCRResult={width:100,height:50,text:'A B C',language:'eng',confidence:90,words:['A','B','C'].map((text,index)=>({text,x:index*15,y:0,width:10,height:10,line:0,confidence:90}))};
  result.document=textDocument(result,'a'.repeat(64),{id:'fixture',version:'1',model:'fixture',device:'cpu'});
  const key={id:'line',text:'A B',rect:{left:0,top:0,width:26,height:10}},[score]=ocrKeyRegionScores(result,[key]);
  assert.equal(score.copied,'A B');assert.equal(score.score.cer,0);assert.equal(score.boxIoU,25/26);assert.equal(score.selectedTokens,2);
  const [empty]=ocrKeyRegionScores(undefined,[key]);assert.equal(empty.boxIoU,0);assert.equal(empty.score.cer,1);
});
