import test from 'node:test';
import assert from 'node:assert/strict';
import { textDocument,readingTokens,selectedText } from '../../src/shared/recognition/text-document';
import { selectedOCRRegion,replaceOCRSelection } from '../../src/shared/recognition/text-region';
import type { OCRResult,OCRWord } from '../../src/shared/recognition/ocr';
const hash='a'.repeat(64),engine={id:'fixture',version:'1',model:'original',device:'cpu',confidenceScale:100};
function result(words:OCRWord[],model='original'){
  const value:OCRResult={width:320,height:180,text:words.map((word,index)=>(index?word.line===words[index-1].line?' ':'\n':'')+word.text).join(''),language:'eng',confidence:95,words};
  value.document=textDocument(value,hash,{...engine,model});return value;
}
function word(text:string,x:number,line:number):OCRWord{return {text,x,y:20+line*70,width:text.length*20,height:24,confidence:95,line,symbols:[...text].map((letter,index)=>({text:letter,x:x+index*20,y:20+line*70,width:20,height:24,confidence:95}))};}
const fixture=()=>result([word('A',20,0),word('B',100,0),word('C',200,0),word('D',20,1),word('E',100,1),word('F',200,1)]);
test('a glyph selection expands to a word and preserves context without changing other words',()=>{
  const base=fixture(),frozen=structuredClone(base),selection={revision:0,anchor:1,focus:1};
  const area=selectedOCRRegion(base,selection);assert.ok(area.context.left<area.core.left&&area.context.width>area.core.width);
  const patch=result([word('A',20,0),word('B2',100,0),word('C',200,0)],'replacement');
  const updated=replaceOCRSelection(base,patch,selection);assert.equal(updated.text,'A B2 C\nD E F');assert.deepEqual(base,frozen);
  const before=readingTokens(base.document!),after=readingTokens(updated.document!);
  for(const token of before.filter(token=>token.text!=='B')){const other=after.find(value=>value.id===token.id);assert(other);assert.deepEqual(other.quad,token.quad);assert.equal(other.text,token.text);}
  assert.equal(selectedText(after,0,after.length-1),updated.text);assert.equal(updated.document!.source.sha256,hash);
  assert.equal(updated.document!.engine.model,'original');assert.equal(updated.document!.revisions![0].engine.model,'replacement');
  assert.deepEqual(updated.document!.revisions![0].context,area.context);assert.deepEqual(updated.document!.revisions![0].contextToSource,[1,0,0,1,area.context.left,area.context.top]);
  assert.ok(after.filter(token=>token.text==='B'||token.text==='2').every(token=>token.recognitionRevision===1));
  for(const token of after)assert.equal(updated.text.slice(token.sourceStart,token.sourceEnd),token.text);
  assert.throws(()=>replaceOCRSelection(updated,patch,selection),/已改变/);
  const next=replaceOCRSelection(updated,result([word('B3',100,0)],'third'),{revision:1,anchor:2,focus:2});assert.equal(next.text,'A B3 C\nD E F');assert.equal(next.document!.revision,2);
});
test('cross-line replacement excludes decoded context and preserves unrelated reading order',()=>{
  const base=fixture(),patch=result([word('A',20,0),word('B2',100,0),word('C',200,0),word('D',20,1),word('E2',100,1),word('F',200,1)]);
  const updated=replaceOCRSelection(base,patch,{revision:0,anchor:1,focus:4});assert.equal(updated.text,'A B2 C\nD E2 F');
  assert.equal(updated.text.split('A').length,2);assert.equal(updated.text.split('F').length,2);
  assert.equal(readingTokens(updated.document!)[0].id,readingTokens(base.document!)[0].id);
});
test('invalid, stale, empty and unrelated-image patches cannot overwrite original text',()=>{
  const base=fixture(),frozen=structuredClone(base),selection={revision:0,anchor:1,focus:1};
  for(const value of [{...selection,revision:1},{...selection,anchor:-1},{...selection,focus:999},{...selection,extra:1}])assert.throws(()=>selectedOCRRegion(base,value));
  assert.throws(()=>replaceOCRSelection(base,result([]),selection),/原文已保留/);
  const other=result([word('B2',100,0)]);other.document!.source.sha256='b'.repeat(64);assert.throws(()=>replaceOCRSelection(base,other,selection),/原图或坐标/);
  assert.deepEqual(base,frozen);
});
test('leading and trailing source whitespace survives a local replacement',()=>{
  const base=fixture();base.text='\n  '+base.text+'\n\n';base.document=textDocument(base,hash,engine);
  const updated=replaceOCRSelection(base,result([word('B2',100,0)]),{revision:0,anchor:1,focus:1});assert.equal(updated.text,'\n  A B2 C\nD E F\n\n');
  for(const token of readingTokens(updated.document!))assert.equal(updated.text.slice(token.sourceStart,token.sourceEnd),token.text);
});
test('local word and revision limits reject oversized requests without altering the document',()=>{
  const dense=result(Array.from({length:1025},(_,index)=>({text:'X',x:index%100*3,y:Math.floor(index/100)*3,width:1,height:2,line:Math.floor(index/100),confidence:95}))),frozen=structuredClone(dense);
  assert.throws(()=>selectedOCRRegion(dense,{revision:0,anchor:0,focus:1024}),/1,024/);assert.deepEqual(dense,frozen);
  const base=fixture();base.document!.revisions=Array.from({length:64},(_,index)=>({revision:index+1,region:{left:0,top:0,width:20,height:20},engine,language:'eng'}));
  assert.throws(()=>selectedOCRRegion(base,{revision:0,anchor:1,focus:1}),/次数已满/);
});
