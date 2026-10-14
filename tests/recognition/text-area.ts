import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOCRRectangle,replaceOCRRectangle } from '../../src/shared/recognition/text-area';
import { textDocument,readingTokens } from '../../src/shared/recognition/text-document';
import { ocrWordGroups } from '../../src/shared/recognition/text-region';
import type { OCRResult,OCRWord } from '../../src/shared/recognition/ocr';
const engine={id:'fixture',model:'original',version:'1',device:'cpu'},hash='a'.repeat(64);
function word(text:string,x:number,line:number):OCRWord{return {text,x,y:10+line*40,width:text.length*12,height:20,confidence:90,line,symbols:[...text].map((letter,index)=>({text:letter,x:x+index*12,y:10+line*40,width:12,height:20,confidence:90}))};}
function result(words:OCRWord[],height=180):OCRResult{
  const value:OCRResult={width:300,height,language:'eng',text:words.map((word,index)=>(index?word.line===words[index-1].line?' ':'\n':'')+word.text).join(''),confidence:90,words};
  value.document=textDocument(value,hash,engine);return value;
}
const fixture=()=>result([word('A',20,0),word('B',100,0),word('C',200,0),word('D',20,1),word('E',100,1),word('F',200,1)]);
const selection={revision:0,region:{left:90,top:0,width:60,height:90}};
function untouched(base:OCRResult,next:OCRResult,texts:string[]){
  const old=readingTokens(base.document!),tokens=readingTokens(next.document!);
  const keep=new Set(ocrWordGroups(base.document!).filter(group=>texts.includes(group.tokens.map(token=>token.text).join(''))).flatMap(group=>group.tokens.map(token=>token.id)));
  for(const token of old.filter(token=>keep.has(token.id))){const found=tokens.find(item=>item.id===token.id);assert(found);assert.equal(found.text,token.text);assert.deepEqual(found.quad,token.quad);}
  assert.deepEqual(base.document!.source,next.document!.source);for(const token of tokens)assert.equal(next.text.slice(token.sourceStart,token.sourceEnd),token.text);
}
test('rectangle changes non-contiguous words in reading order while context and neighboring columns remain untouched',()=>{
  const base=fixture(),frozen=structuredClone(base),patch=result([word('A',20,0),word('BX',100,0),word('C',200,0),word('D',20,1),word('EY',100,1),word('F',200,1)]);
  const next=replaceOCRRectangle(base,patch,selection);assert.equal(next.text,'A BX C\nD EY F');untouched(base,next,['A','C','D','F']);assert.deepEqual(base,frozen);
  assert.equal(next.document!.revision,1);assert.equal(next.document!.revisions![0].kind,'rectangle');assert.deepEqual(next.document!.revisions![0].requested,selection.region);
});
test('partial character rectangles expand to the complete existing word with bounded source context',()=>{
  const base=result([word('FIRST',20,0),word('SECOND',140,0)]),area=prepareOCRRectangle(base,{width:300,height:180},{revision:0,region:{left:45,top:14,width:4,height:8}});
  assert.equal(area.chosen.size,1);assert.deepEqual(area.core,{left:20,top:10,width:60,height:20});assert.equal(area.context.left,0);assert.equal(area.context.top,0);
  const patch=result([word('FIRSTX',20,0),word('SECOND',140,0)]),next=replaceOCRRectangle(base,patch,area.selection);assert.equal(next.text,'FIRSTX SECOND');untouched(base,next,['SECOND']);
});
test('an initially empty region inserts missed words between existing words without reordering untouched IDs',()=>{
  const base=result([word('A',20,0),word('C',200,0),word('D',20,1),word('F',200,1)]),patch=fixture(),next=replaceOCRRectangle(base,patch,selection);
  assert.equal(next.text,'A B C\nD E F');untouched(base,next,['A','C','D','F']);
});
test('new lines can be inserted between existing rows and the first recognition can start from a rectangle',()=>{
  const base=result([word('TOP',20,0),word('BOTTOM',20,2)]),patch=result([word('MIDDLE',20,1)]),request={revision:0,region:{left:0,top:40,width:130,height:40}};
  const next=replaceOCRRectangle(base,patch,request);assert.equal(next.text,'TOP\nMIDDLE\nBOTTOM');untouched(base,next,['TOP','BOTTOM']);assert.deepEqual(next.document!.blocks.flatMap(block=>block.lines).map(line=>line.order),[0,1,2]);
  const first=replaceOCRRectangle(undefined,result([word('CONTEXT',180,0),word('TARGET',20,1)]),{revision:0,region:{left:0,top:40,width:130,height:40}});
  assert.equal(first.text,'TARGET');assert.equal(first.document!.source.width,300);assert.equal(first.words[0].y,50);assert.equal(first.document!.revision,1);
  const empty=result([]);empty.document!.revision=8;const again=replaceOCRRectangle(empty,patch,{...request,revision:8});assert.equal(again.document!.revision,9);
});
test('regional model provenance and original bottom-of-long-image coordinates survive merging',()=>{
  const base=result([word('TOP',20,0),word('BOTTOM',20,200)],10000),patch=result([word('NEWBOTTOM',20,200)],10000);patch.document!.engine={...engine,id:'paddle',model:'tiny'};
  const next=replaceOCRRectangle(base,patch,{revision:0,region:{left:0,top:8000,width:150,height:60}});assert.equal(next.text,'TOP\nNEWBOTTOM');assert.equal(next.words[1].y,8010);
  assert.equal(next.document!.engine.id,'fixture');assert.equal(next.document!.revisions![0].engine.id,'paddle');untouched(base,next,['TOP']);
});
test('the first rectangular recognition retains the engine paragraph/column reading order',()=>{
  const patch=result([{...word('A',20,0),block:0},{...word('B',20,1),block:0},{...word('C',200,0),block:1},{...word('D',200,1),block:1}]);
  const first=replaceOCRRectangle(undefined,patch,{revision:0,region:{left:0,top:0,width:300,height:100}});
  assert.equal(first.text,'A\nB\nC\nD');assert.equal(first.document!.blocks.length,2);assert.deepEqual(first.document!.blocks.map(block=>block.lines.map(line=>line.tokens.map(token=>token.text).join(''))),[['A','B'],['C','D']]);
  const sourceOrder=result([word('FIRST',20,1),word('SECOND',20,0)]);
  assert.equal(replaceOCRRectangle(undefined,sourceOrder,{revision:0,region:{left:0,top:0,width:300,height:100}}).text,'FIRST\nSECOND');
});
test('a source rotated by 90 degrees uses line thickness and reading axes when inserting a missed column',()=>{
  function rotate(value:OCRResult){
    const height=value.height;[value.width,value.height]=[value.height,value.width];
    const move=(box:{x:number;y:number;width:number;height:number})=>{const {x,y,width,height:h}=box;Object.assign(box,{x:height-y-h,y:x,width:h,height:width});};
    for(const word of value.words){move(word);word.symbols?.forEach(move);}
    value.document!.source.width=value.width;value.document!.source.height=value.height;
    for(const block of value.document!.blocks){block.quad=block.quad.map(point=>({x:height-point.y,y:point.x})) as typeof block.quad;for(const line of block.lines){line.quad=line.quad.map(point=>({x:height-point.y,y:point.x})) as typeof line.quad;for(const token of line.tokens)token.quad=token.quad.map(point=>({x:height-point.y,y:point.x})) as typeof token.quad;}}
    return value;
  }
  const base=rotate(result([word('TOP',20,0),word('BOTTOM',20,2)])),patch=rotate(result([word('MID',20,1)]));
  const next=replaceOCRRectangle(base,patch,{revision:0,region:{left:100,top:0,width:40,height:130}});assert.equal(next.text,'TOP\nMID\nBOTTOM');untouched(base,next,['TOP','BOTTOM']);
});
test('empty, mismatched, stale and malformed rectangles preserve the old document',()=>{
  const base=fixture(),frozen=structuredClone(base);assert.throws(()=>replaceOCRRectangle(base,result([]),selection),/未识别/);
  const wrong=fixture();wrong.document!.source.sha256='b'.repeat(64);assert.throws(()=>replaceOCRRectangle(base,wrong,selection),/不一致/);
  for(const request of [{revision:1,region:selection.region},{revision:0,region:{left:-1,top:0,width:1,height:1}},{revision:0,region:{left:0,top:0,width:301,height:1}},{revision:0,region:{left:0.1,top:0,width:1,height:1}},{revision:0,region:selection.region,extra:1}])assert.throws(()=>prepareOCRRectangle(base,{width:300,height:180},request));
  assert.deepEqual(base,frozen);const textOnly={...base,document:undefined};assert.throws(()=>prepareOCRRectangle(textOnly,{width:300,height:180},selection),/没有字词坐标/);
});
test('capacity limits reject dense/expired regions before inference',()=>{
  const dense=result(Array.from({length:1025},()=>word('X',20,0)));
  assert.throws(()=>prepareOCRRectangle(dense,{width:300,height:180},{revision:0,region:{left:0,top:0,width:100,height:40}}),/文字过多/);
  const base=fixture();base.document!.revisions=Array.from({length:64},(_,revision)=>({revision,region:selection.region,engine,language:'eng'}));
  assert.throws(()=>prepareOCRRectangle(base,{width:300,height:180},selection),/次数已满/);
});
