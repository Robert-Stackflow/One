import test from 'node:test';
import assert from 'node:assert/strict';
import {textReadingLayout,orderOCRFragments} from '../../src/shared/recognition/text-layout';
import {readingTokens,selectedText,textDocument,type TextQuad} from '../../src/shared/recognition/text-document';
import type {OCRWord,OCRResult} from '../../src/shared/recognition/ocr';
const line=(text:string,x:number,y:number,width=250,height=20):OCRWord=>({text,x,y,width,height,line:y,confidence:96});
const column=(name:string,x:number)=>Array.from({length:4},(_,index)=>line(name+' paragraph number '+(index+1),x,80+index*40));
const contents=(input:readonly OCRWord[])=>textReadingLayout(input).blocks.flat(2).map(item=>item.text);
test('columns read top to bottom with spanning title/footer and preserve each original record',()=>{
 const left=column('Left',20),right=column('Right',420),title=line('Document title',20,20,650),footer=line('Document footer',20,280,650),input=[title,...left.flatMap((item,index)=>[right[index],item]),footer];
 const snapshot=structuredClone(input),layout=textReadingLayout(input);assert.equal(layout.columns,true);assert.deepEqual(contents(input),[title,...left,...right,footer].map(item=>item.text));
 assert.deepEqual(input,snapshot);assert.deepEqual(new Set(layout.blocks.flat(2)),new Set(input));assert.equal(layout.blocks.length,4);
});
test('a narrow canvas-centered title stays before asymmetric column ink',()=>{
 const left=column('Left',20),right=column('Right',420),title=line('Column heading',350,20,180);
 const input=[title,...left,...right];assert.equal(textReadingLayout(input).columns,true);assert.equal(contents(input)[0],title.text);
});
test('three columns and moderate skew retain column order rather than matching visual rows',()=>{
 const input=[...column('First',20),...column('Second',420),...column('Third',820)];
 const rotate=(x:number,y:number)=>({x:x*Math.cos(.08)-y*Math.sin(.08)+50,y:x*Math.sin(.08)+y*Math.cos(.08)+50});
 const skewed=input.map(item=>({...item,quad:[rotate(item.x,item.y),rotate(item.x+item.width,item.y),rotate(item.x+item.width,item.y+item.height),rotate(item.x,item.y+item.height)] as TextQuad}));
 const layout=textReadingLayout(skewed.reverse());assert.equal(layout.columns,true);assert.deepEqual(layout.blocks.flat(2).map(item=>item.text),input.map(item=>item.text));
});
test('tables, colon labels with missing values and line numbers keep existing engine order',()=>{
 for(const labels of [['Name:','Date:','Reference:','Comment:'],['CODE A','CODE B','CODE C','CODE D'],['101','102','103','104']]){
  const input=labels.flatMap((text,index)=>[line(text,20,80+index*40,100),line('Corresponding field content '+index,420,80+index*40)]),records=input.map(word=>({word,marker:word.text}));
  const result=orderOCRFragments(records);assert.equal(result.columns,false);assert.deepEqual(result.items,records);assert.ok(result.items.every((item,index)=>item===records[index]));
 }
 const labels=['CASE NAME:','COURT:','INFORMATION:','NAME:'],input=labels.map((text,index)=>line(text,20,80+index*40,140));input.push(...column('Multiline field value',420).slice(1));
 assert.equal(textReadingLayout(input).columns,false);
});
test('single lines, sparse layouts, vertical quads and too many regions retain engine ordering',()=>{
 const values=[line('One original line',420,80),line('Another original line',20,80)];assert.equal(orderOCRFragments(values.map(word=>({word}))).columns,false);
 const vertical=[...column('Left',20),...column('Right',420)].map(word=>({word,quad:[{x:word.x,y:word.y},{x:word.x,y:word.y+word.width},{x:word.x-20,y:word.y+word.width},{x:word.x-20,y:word.y}] as TextQuad}));
 assert.equal(orderOCRFragments(vertical).columns,false);
 const large=Array.from({length:9000},(_,index)=>line('bounded analysis',index%2?420:20,index*40));assert.equal(textReadingLayout(large).columns,false);
 assert.deepEqual(textReadingLayout([]),{blocks:[],columns:false});
});
test('associated quad/alignment records, glyph geometry and selected text survive new block/line IDs',()=>{
 const source=[...column('Left',20),...column('Right',420)].sort((a,b)=>a.y-b.y||a.x-b.x),records=source.map((word,index)=>({word,quad:[{x:word.x,y:word.y},{x:word.x+word.width,y:word.y},{x:word.x+word.width,y:word.y+20},{x:word.x,y:word.y+20}] as TextQuad,regions:[{text:word.text,originalIndex:index}]}));
 const ordered=orderOCRFragments(records);assert.equal(ordered.columns,true);assert.equal(new Set(ordered.items.map(item=>item.word.block)).size,2);
 for(const item of ordered.items){const original=records.find(record=>record.word.text===item.word.text)!;assert.equal(item.quad,original.quad);assert.equal(item.regions,original.regions);assert.notEqual(item.word,original.word);}
 const words=ordered.items.map(item=>item.word),result:OCRResult={width:700,height:300,language:'eng',words,text:words.map(word=>word.text).join('\n'),confidence:96},doc=textDocument(result,'a'.repeat(64),{id:'fixture',version:'1',model:'layout',device:'cpu'}),tokens=readingTokens(doc);
 assert.equal(selectedText(tokens,0,tokens.length-1),result.text);for(const token of tokens)assert.equal(result.text.slice(token.sourceStart,token.sourceEnd),token.text);
 assert.deepEqual(source.map(word=>word.block),Array(source.length).fill(undefined));
});
test('invalid box/quad geometry is rejected before projection and never mutates its input',()=>{
 const base=line('valid text',20,80);for(const change of [{width:0},{x:NaN},{height:Infinity},{quad:[{x:0,y:0},{x:0,y:0},{x:1,y:1},{x:0,y:1}]},{quad:[{x:NaN,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}])assert.throws(()=>textReadingLayout([{...base,...change} as any]),/阅读顺序/);
 assert.throws(()=>textReadingLayout(Array(50001).fill(base)),/阅读顺序/);
});
