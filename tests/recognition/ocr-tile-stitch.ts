import test from 'node:test';
import assert from 'node:assert/strict';
import {stitchOCRRow,type StitchFragment} from '../../src/main/recognition/ocr-tile-stitch';
import type {TextToken,TextQuad} from '../../src/shared/recognition/text-document';
const quad=(x:number,y:number,width:number,height:number):TextQuad=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
function fragment(text:string,x:number,tile:number):StitchFragment {
 let offset=0;const tokens:TextToken[]=Array.from(text).map((text,index)=>{const start=offset;offset+=text.length;return {id:'t'+index,wordId:'w0:0',lineId:'b0/l0',order:index,text,separatorAfter:'',quad:quad(x+index*10,100,10,20),geometry:'ctc',sourceStart:start,sourceEnd:offset};});
 return {word:{text,x,y:100,width:tokens.length*10,height:20,confidence:95,line:0},tokens,tiles:new Set([tile]),clippedLeft:true,clippedRight:true};
}
test('facing crop fragments join only their spatially agreeing CTC suffix/prefix',()=>{
 const left=fragment('Column reading or',100,0),right=fragment('umn reading order',130,1),before=structuredClone([left,right]),merged=stitchOCRRow([left,right]);
 assert.equal(merged.length,1);assert.equal(merged[0].word.text,'Column reading order');assert.equal(merged[0].word.x,100);assert.equal(merged[0].word.width,200);assert.deepEqual([left,right],before);
 assert.equal(merged[0].tokens.map(token=>token.text).join(''),merged[0].word.text);assert.equal(merged[0].tokens[0],left.tokens[0]);assert.equal(merged[0].tokens.at(-1),right.tokens.at(-1));
 assert.deepEqual([...merged[0].tiles],[0,1]);
});
test('same text, wrong geometry, same tile, non-CTC or non-facing boxes stay separate',()=>{
 const left=fragment('Column reading or',100,0);
 for(const right of [fragment('umn reading order',190,1),fragment('umn reading order',130,0),{...fragment('umn reading order',130,1),clippedLeft:false}, {...fragment('umn reading order',130,1),tokens:fragment('umn reading order',130,1).tokens.map(token=>({...token,geometry:'word' as const}))},fragment('unrelated text',130,1)])assert.equal(stitchOCRRow([left,right]).length,2);
 assert.equal(stitchOCRRow([{...left,clippedRight:false},fragment('umn reading order',130,1)]).length,2);
});
test('Chinese and multiple seams preserve text exactly without changing source glyphs',()=>{
 const chinese=stitchOCRRow([fragment('标题识别片',100,0),fragment('识别片段测试',120,1)]);assert.equal(chinese[0].word.text,'标题识别片段测试');
 const merged=stitchOCRRow([fragment('abcdefghij',100,0),fragment('hijklmnop',170,1),fragment('nopqrst',230,2)]);assert.equal(merged.length,1);assert.equal(merged[0].word.text,'abcdefghijklmnopqrst');assert.equal(merged[0].tokens.length,20);
 assert.equal(stitchOCRRow([fragment('one  ',100,0),fragment('  two',130,1)]).length,2);
});

test('observed whitespace and a clipped edge glyph are recovered from the other crop only',()=>{
 const left=fragment('Column reading ol',100,0),right=fragment('umn reading order',130,1);left.tokens=left.tokens.filter(token=>token.text.trim());right.tokens=right.tokens.filter(token=>token.text.trim());
 const merged=stitchOCRRow([left,right]);assert.equal(merged.length,1);assert.equal(merged[0].word.text,'Column reading order');assert.equal(merged[0].tokens.at(-1),right.tokens.at(-1));
});
test('repeated characters select the spatially correct overlap rather than the longest string match',()=>{
 const merged=stitchOCRRow([fragment('aaaaaaaaaa',100,0),fragment('aaaaaaaaaaaa',140,1)]);assert.equal(merged.length,1);assert.equal(merged[0].word.text,'a'.repeat(16));
});

test('vertical source glyphs are excluded from horizontal crop stitching',()=>{
 const left=fragment('Column reading or',100,0),right=fragment('umn reading order',130,1);
 for(const item of [left,right])for(const token of item.tokens)token.quad=token.quad.map(point=>({x:point.y,y:point.x})) as TextQuad;
 assert.equal(stitchOCRRow([left,right]).length,2);
});
