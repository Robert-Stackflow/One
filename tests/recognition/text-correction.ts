import test from 'node:test';
import assert from 'node:assert/strict';
import { correctOCRWord } from '../../src/shared/recognition/text-correction';
import { textDocument, readingTokens, selectedText } from '../../src/shared/recognition/text-document';
import { replaceOCRSelection } from '../../src/shared/recognition/text-region';
import { InlineOCRSessions } from '../../src/main/recognition/inline-ocr';
import type { OCRResult, OCRWord } from '../../src/shared/recognition/ocr';
const engine={id:'tess',version:'6',model:'fast',device:'cpu',confidenceScale:100};
function word(text:string,x:number,line:number):OCRWord {
  return {text,x,y:10+line*35,width:text.length*10,height:16,confidence:90,line,
    symbols:[...text].map((letter,index)=>({text:letter,x:x+index*10,y:10+line*35,width:10,height:16,confidence:90}))};
}
function result(words:OCRWord[]):OCRResult {
  const value:OCRResult={width:300,height:100,text:'  '+words.map((word,index)=>(index?word.line===words[index-1].line?'  ':'\n':'')+word.text).join('')+'\n',words,language:'eng',confidence:90};
  value.document=textDocument(value,'a'.repeat(64),engine);return value;
}
const fixture=()=>result([word('hello',10,0),word('world',120,0),word('hello',10,1)]);
test('word correction preserves original coverage, untouched geometry, whitespace and copy offsets without fabricated glyphs',()=>{
  const base=fixture(),frozen=structuredClone(base),old=readingTokens(base.document!),selection={revision:0,anchor:1,focus:2};
  const corrected=correctOCRWord(base,selection,'你好世界🌍');assert.deepEqual(base,frozen);
  assert.equal(corrected.text,'  你好世界🌍  world\nhello\n');assert.equal(corrected.words[0].text,'你好世界🌍');
  assert.deepEqual(corrected.words.slice(1),base.words.slice(1));
  const tokens=readingTokens(corrected.document!),head=tokens[0];assert.equal(head.geometry,'word');assert.equal(head.id,old[0].id);
  assert.deepEqual(head.sourceQuads,old.slice(0,5).map(token=>token.quad));assert.equal(head.confidence,undefined);
  assert.deepEqual(head.quad,[{x:10,y:10},{x:60,y:10},{x:60,y:26},{x:10,y:26}]);
  assert.deepEqual(tokens.slice(1).map(token=>({id:token.id,quad:token.quad,text:token.text})),old.slice(5).map(token=>({id:token.id,quad:token.quad,text:token.text})));
  for(const token of tokens)assert.equal(corrected.text.slice(token.sourceStart,token.sourceEnd),token.text);
  assert.equal(selectedText(tokens,0,tokens.length-1),'你好世界🌍  world\nhello');
  assert.deepEqual(corrected.document!.source,base.document!.source);assert.deepEqual(corrected.document!.blocks.map(block=>block.quad),base.document!.blocks.map(block=>block.quad));
  assert.equal(corrected.document!.revision,1);assert.equal(corrected.document!.corrections![0].before,'hello');assert.equal(corrected.document!.corrections![0].after,'你好世界🌍');
});
test('repeated words, shorter edits, repeated correction and rotated source polygons retain their exact source quads',()=>{
  const base=fixture(),old=readingTokens(base.document!);old.slice(10).forEach(token=>{token.quad=token.quad.map(p=>({x:100-p.y,y:p.x})) as typeof token.quad;});
  const first=correctOCRWord(base,{revision:0,anchor:11,focus:13},'X');assert.equal(first.text,'  hello  world\nX\n');
  const again=correctOCRWord(first,{revision:1,anchor:10,focus:10},'longer replacement');
  assert.equal(again.text,'  hello  world\nlonger replacement\n');assert.deepEqual(readingTokens(again.document!)[10].sourceQuads,old.slice(10).map(token=>token.quad));
  assert.equal(again.document!.corrections!.length,2);assert.equal(again.words[2].text,'longer replacement');
  assert.strictEqual(correctOCRWord(again,{revision:2,anchor:10,focus:10},'longer replacement'),again);
});
test('invalid, cross-word, stale and capacity edits leave the previous result intact',()=>{
  const base=fixture(),frozen=structuredClone(base),selection={revision:0,anchor:1,focus:2};
  for(const value of ['', '   ', 'a\nb', 'a\u2028b', 'x'.repeat(2049), 12, 'a\0b'])assert.throws(()=>correctOCRWord(base,selection,value));
  assert.throws(()=>correctOCRWord(base,{revision:0,anchor:1,focus:6},'bad'),/一个词/);
  assert.throws(()=>correctOCRWord(base,{revision:1,anchor:1,focus:2},'bad'),/已改变/);
  assert.throws(()=>correctOCRWord(base,{revision:0,anchor:-1,focus:2},'bad'));assert.deepEqual(base,frozen);
  const full=correctOCRWord(base,selection,'X');full.document!.corrections=Array.from({length:256},()=>structuredClone(full.document!.corrections![0]));
  assert.throws(()=>correctOCRWord(full,{revision:1,anchor:0,focus:0},'Y'),/次数已满/);
});
test('a subsequent regional inference replaces corrected word geometry and preserves correction provenance',()=>{
  const base=correctOCRWord(fixture(),{revision:0,anchor:0,focus:2},'X');
  const patch=result([word('hello',10,0)]);const next=replaceOCRSelection(base,patch,{revision:1,anchor:0,focus:0});
  assert.equal(next.text,'  hello  world\nhello\n');assert.equal(next.document!.revision,2);
  assert.deepEqual(next.document!.corrections,base.document!.corrections);assert.equal(readingTokens(next.document!)[0].geometry,'character');
});
test('manual correction remains available after local inference capacity, retaining approximate geometry provenance',()=>{
  const base=fixture(),tokens=readingTokens(base.document!);tokens.slice(0,5).forEach(token=>{token.geometry='ctc';});
  base.document!.revisions=Array.from({length:64},(_,revision)=>({revision,region:{left:0,top:0,width:20,height:20},engine,language:'eng'}));
  const first=correctOCRWord(base,{revision:0,anchor:0,focus:0},'X'),again=correctOCRWord(first,{revision:1,anchor:0,focus:0},'Y');
  assert.deepEqual(readingTokens(again.document!)[0].sourceGeometry,Array(5).fill('ctc'));
  assert.deepEqual(readingTokens(again.document!)[0].sourceQuads,tokens.slice(0,5).map(token=>token.quad));
});
test('Paddle legacy line boxes can contain multiple selectable words without changing other text or geometry',()=>{
  const base=fixture(),legacy=structuredClone(base.words);
  base.words=[{...legacy[0],text:'hello  world',width:160,symbols:undefined},legacy[2]];
  const first=correctOCRWord(base,{revision:0,anchor:6,focus:7},'Earth');assert.equal(first.text,'  hello  Earth\nhello\n');
  assert.equal(first.words[0].text,'hello  Earth');assert.equal(first.words[0].x,base.words[0].x);assert.equal(first.words[0].width,base.words[0].width);
  assert.deepEqual(first.words[1],legacy[2]);const second=correctOCRWord(first,{revision:1,anchor:0,focus:0},'Hello');
  assert.equal(second.words[0].text,'Hello  Earth');assert.equal(second.text,'  Hello  Earth\nhello\n');
});
test('inline corrections use the owning frozen result, invoke no inference and reject stale/replaced owners',async()=>{
  let runs=0;const sessions=new InlineOCRSessions(()=>({run:async()=>{runs++;return fixture();},cancel:async()=>{},close:async()=>{}}),async()=>{throw Error('No network');});
  const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(300,16);png.writeUInt32BE(100,20);
  try {const state=await sessions.prepare(1,'editor',png.toString('base64')),initial=await sessions.run(1,state.id,'eng');
    const next=sessions.correct(1,state.id,{revision:initial.document!.revision,anchor:0,focus:1},'X');assert.equal(next.text,'  X  world\nhello\n');assert.equal(runs,1);
    assert.throws(()=>sessions.correct(2,state.id,{revision:1,anchor:0,focus:0},'bad'));
    assert.throws(()=>sessions.correct(1,state.id,{revision:initial.document!.revision,anchor:0,focus:0},'bad'),/已改变/);
    const pending=sessions.run(1,state.id,'eng');assert.throws(()=>sessions.correct(1,state.id,{revision:2,anchor:0,focus:0},'bad'),/先结束/);await pending;
    await sessions.prepare(1,'replacement',png.toString('base64'));assert.throws(()=>sessions.correct(1,state.id,{revision:2,anchor:0,focus:0},'bad'));
  } finally {await sessions.stop();}
});
