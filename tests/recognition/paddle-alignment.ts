import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleTextProjection,projectPaddlePoint,paddleCTCRegions,applyPaddleCTCRegions } from '../../src/main/recognition/paddle-alignment';
import { textDocument,readingTokens,selectedText,textGroup } from '../../src/shared/recognition/text-document';
import type { PaddleRecResult } from '../../src/main/recognition/paddle-recognizer';
import type { TextQuad } from '../../src/shared/recognition/text-document';
const quad:TextQuad=[{x:10,y:20},{x:110,y:20},{x:110,y:40},{x:10,y:40}];
const result=():PaddleRecResult=>({text:'Wi',confidence:.9,alignment:'ctc-approximate',timeSteps:20,input:{width:200,contentWidth:100},
  glyphs:[{text:'W',start:1,end:5,confidence:.95},{text:'i',start:7,end:8,confidence:.9}]});
test('CTC hints use actual emission intervals and remove resized-image padding',()=>{
  const regions=paddleCTCRegions(result(),paddleTextProjection(quad),false,false)!;
  assert.equal(regions.length,2);assert.equal(regions[0].quad[1].x,70);assert.equal(regions[1].quad[0].x,70);
  assert.equal(regions[0].quad[0].x,10);assert.equal(regions[1].quad[1].x,110);
  assert.notEqual(regions[0].quad[1].x,60,'unequal CTC intervals are not split into equal-width character cells');
});
test('high-contrast ink columns disambiguate repeated narrow characters without equal-width guesses',()=>{
  const value:PaddleRecResult={text:'iii2',confidence:.9,alignment:'ctc-approximate',timeSteps:20,input:{width:100,contentWidth:100},
    glyphs:[['i',2,3],['i',5,6],['i',8,9],['2',14,16]].map(([text,start,end])=>({text:String(text),start:Number(start),end:Number(end),confidence:.9}))};
  const data=new Uint8Array(100*20*3).fill(255);
  for(const [a,b] of [[10,13],[20,23],[30,33],[65,80]])for(let y=5;y<16;y++)for(let x=a;x<b;x++)data.fill(17,(y*100+x)*3,(y*100+x)*3+3);
  const projected=paddleCTCRegions(value,paddleTextProjection(quad),false,false,{data,width:100,height:20})!;
  assert.equal(projected[1].quad[1].x,36.5);assert.equal(projected[2].quad[0].x,36.5);
  const lowContrast=Uint8Array.from(data,value=>value===255?122:120);
  assert.deepEqual(paddleCTCRegions(value,paddleTextProjection(quad),false,false,{data:lowContrast,width:100,height:20}),
    paddleCTCRegions(value,paddleTextProjection(quad),false,false));
});
test('the same homography maps crop corners and reverses tall-crop/180-degree preprocessing',()=>{
  const skew:TextQuad=[{x:3,y:5},{x:110,y:12},{x:90,y:70},{x:8,y:60}],matrix=paddleTextProjection(skew);
  for(const [index,[u,v]] of [[0,0],[1,0],[1,1],[0,1]].entries()){
    const point=projectPaddlePoint(matrix,u,v);assert.ok(Math.hypot(point.x-skew[index].x,point.y-skew[index].y)<1e-8);
  }
  const reversed=paddleCTCRegions(result(),paddleTextProjection(quad),false,true)!;
  assert.deepEqual(reversed[0].quad[0],{x:110,y:40});assert.deepEqual(reversed[1].quad[2],{x:10,y:20});
  const tall=paddleCTCRegions(result(),paddleTextProjection(quad),true,false)!;
  assert.deepEqual(tall[0].quad[0],{x:110,y:20});assert.deepEqual(tall[1].quad[1],{x:110,y:40});
});
test('malformed, unmatched or padding-only alignments retain whole-line geometry',()=>{
  for(const edit of [ (r:PaddleRecResult)=>{r.text='other';},(r:PaddleRecResult)=>{r.glyphs[1].start=19;r.glyphs[1].end=20;},
    (r:PaddleRecResult)=>{r.glyphs[1].start=3;},(r:PaddleRecResult)=>{r.input=undefined;},(r:PaddleRecResult)=>{r.glyphs[0].confidence=NaN;} ]){
    const value=result();edit(value);assert.equal(paddleCTCRegions(value,paddleTextProjection(quad),false,false),undefined);
  }
});
test('approximate selection keeps source offsets, whitespace and word grouping without populating exact glyph boxes',()=>{
  const text='ONE OCR',recognition:PaddleRecResult={text,confidence:.9,alignment:'ctc-approximate',timeSteps:16,input:{width:160,contentWidth:160},
    glyphs:[...text].map((text,index)=>({text,start:index*2,end:index*2+1,confidence:.9}))};
  const document=textDocument({text,width:200,height:80,language:'eng',confidence:90,words:[{text,x:10,y:20,width:100,height:20,line:0,confidence:90}]},
    'a'.repeat(64),{id:'fixture',model:'actual-ctc',version:'1',device:'cpu',confidenceScale:100});
  applyPaddleCTCRegions(document,[paddleCTCRegions(recognition,paddleTextProjection(quad),false,false)]);
  const tokens=readingTokens(document);assert.equal(tokens.length,6);assert.ok(tokens.every(value=>value.geometry==='ctc'));
  assert.equal(selectedText(tokens,0,tokens.length-1),text);assert.equal(tokens[3].sourceStart,4);
  assert.deepEqual(textGroup(tokens,0,'word'),{anchor:0,focus:2});assert.deepEqual(textGroup(tokens,4,'word'),{anchor:3,focus:5});
});
