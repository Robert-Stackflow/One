import test from 'node:test';
import assert from 'node:assert/strict';
import {deepseekGroundedResult} from '../../src/main/recognition/deepseek-grounding';
import {readingTokens,selectedText} from '../../src/shared/recognition/text-document';
import {correctOCRWord} from '../../src/shared/recognition/text-correction';
import {mergeOCRTiles} from '../../src/main/recognition/ocr-tile-merge';
const sha='a'.repeat(64),engine={id:'deepseek-ocr',version:'fixture',model:'v2',device:'cpu'};
const ref=(text:string,boxes:unknown)=>`<|ref|>${text}<|/ref|><|det|>${JSON.stringify(boxes)}<|/det|>`;
const parse=(raw:string)=>deepseekGroundedResult(raw,{width:999,height:999},'chi_sim+eng',sha,engine);
test('native OCR refs preserve model order, Unicode offsets and coarse region provenance',()=>{
  const result=parse(ref('ONE OCR 2026',[[0,0,999,99]])+'\n'+ref('截图 😀',[[10,200,800,400]])+'<｜end▁of▁sentence｜>');
  assert.equal(result.text,'ONE OCR 2026\n截图 😀');assert.equal(result.words.length,2);
  const tokens=readingTokens(result.document!);assert.equal(tokens.length,2);assert.ok(tokens.every(t=>t.geometry==='region'&&t.confidence===undefined));
  assert.equal(selectedText(tokens,0,1),result.text);assert.equal(tokens[1].sourceStart,13);assert.equal(tokens[1].sourceEnd,result.text.length);
  assert.deepEqual(tokens[0].quad,[{x:0,y:0},{x:999,y:0},{x:999,y:99},{x:0,y:99}]);
  const corrected=correctOCRWord(result,{revision:0,anchor:1,focus:1},'人工修正');
  assert.ok(readingTokens(corrected.document!)[1].sourceGeometry!.includes('region'));
  const code='    x = 1\n\treturn x  ';assert.equal(parse(ref(code,[[0,0,20,20]])).text,code);
});
test('one ref with multiple native boxes stays one selection, including crop-to-source geometry',()=>{
  const result=parse(ref('一段\n两行',[[100,100,300,200],[100,250,500,350]]));
  const token=readingTokens(result.document!)[0];assert.equal(token.text,'一段\n两行');assert.equal(token.sourceQuads!.length,2);
  const merged=mergeOCRTiles([{tile:{index:0,left:50,top:100,width:999,height:999,core:{left:50,top:100,width:999,height:999}},result}],{width:1100,height:1200},sha);
  const shifted=readingTokens(merged.document!)[0];assert.equal(shifted.geometry,'region');
  assert.deepEqual(shifted.sourceQuads![0][0],{x:150,y:200});assert.deepEqual(shifted.sourceQuads![1][2],{x:550,y:450});
  assert.equal(selectedText([shifted],0,0),'一段\n两行');
});
test('invalid coordinates retain all recognized passages and discard all geometry',()=>{
  for(const box of [[],[[1,2,0,3]],[[0,0,1000,20]],[[0,0,1.5,2]],[[0,0,NaN,2]],'not boxes',[[0,0,3,4,5]],Array.from({length:65},()=>[0,0,10,10])]){
    const result=parse(ref('valid',[[0,0,20,20]])+ref('unlocated',box));assert.equal(result.text,'valid\nunlocated');assert.deepEqual(result.words,[]);assert.deepEqual(result.document!.blocks,[]);
  }
  const result=parse('<|ref|>broken JSON<|/ref|><|det|>NaN<|/det|>');assert.equal(result.text,'broken JSON');assert.deepEqual(result.words,[]);
});
test('incomplete or mixed grounding is rejected; plain text remains available without invented positions',()=>{
  for(const raw of ['<|ref|>lost','<|det|>[]<|/det|>','prefix'+ref('x',[[0,0,1,1]]),ref('x',[[0,0,1,1]])+'trailing',ref('x<|det|>',[[0,0,1,1]]),ref('',[[0,0,1,1]])])assert.throws(()=>parse(raw),/定位/);
  const result=parse('Free OCR result<｜end▁of▁sentence｜>');assert.equal(result.text,'Free OCR result');assert.deepEqual(result.words,[]);
  assert.throws(()=>parse('<|ref|>x<|/ref|><|det|>'.repeat(4096)),/定位/);
  assert.throws(()=>parse('<|ref|>a<|/ref|><|det|>[[0,0,1,1]]'+ref('b',[[0,0,1,1]])),/不完整/);
  assert.throws(()=>parse('x'.repeat(1024*1024+1)),/过长/);assert.throws(()=>parse(Array.from({length:4097},()=>ref('x',[[0,0,1,1]])).join('')),/格式/);
});
