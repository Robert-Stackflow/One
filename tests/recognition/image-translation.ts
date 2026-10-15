import test from 'node:test';
import assert from 'node:assert/strict';
import {textDocument,type TextQuad} from '../../src/shared/recognition/text-document';
import {imageTranslationDocument,imageTextLayout,imageTextLayoutAsync,imageTranslationRotation,imageTranslationFrame,editImageTranslation,imageTranslationSnapshot,validateImageTranslation} from '../../src/shared/recognition/image-translation';
import {repairTranslationBackground} from '../../src/shared/recognition/image-translation-background';
import type {TranslationResult} from '../../src/shared/recognition/translation';
import {ImageHistory,transformImage,validateImageDocument} from '../../src/shared/capture/image-document';
const document=()=>textDocument({text:'Hello One\nAgain',width:160,height:90,confidence:90,language:'eng',words:[{text:'Hello',x:10,y:10,width:30,height:15,line:0,confidence:90},{text:'One',x:50,y:10,width:25,height:15,line:0,confidence:90},{text:'Again',x:10,y:50,width:50,height:15,line:1,confidence:90}]},'a'.repeat(64),{id:'fixture',version:'1',model:'test',device:'cpu'});
const result=():TranslationResult=>({id:'job',source:'Hello One\nAgain',text:'你好\n再次',target:'zh-Hans',revision:'service',endpoint:'fixture',parts:[{id:'source',start:0,end:9,paragraph:1,chunk:1,status:'translated',text:'你好'},{id:'p2',start:10,end:15,paragraph:2,chunk:1,status:'translated',text:'再次'}]});

test('quarter-turn OCR paragraphs retain reading direction, font size, layout and editable project geometry',()=>{
  const base=imageTranslationDocument(document(),result(),'image');
  for(const rotation of [0,90,180,270]){
    const source=document(),map=({x,y}:{x:number;y:number})=>rotation===90?{x:90-y,y:x}:rotation===180?{x:160-x,y:90-y}:rotation===270?{x:y,y:160-x}:{x,y};
    if(rotation%180)[source.source.width,source.source.height]=[90,160];
    for(const block of source.blocks){block.quad=block.quad.map(map) as TextQuad;for(const line of block.lines){line.quad=line.quad.map(map) as TextQuad;for(const token of line.tokens)token.quad=token.quad.map(map) as TextQuad;}}
    const value=imageTranslationDocument(source,result(),'image');
    for(let index=0;index<value.blocks.length;index++){
      const block=value.blocks[index],frame=imageTranslationFrame(block),original=base.blocks[index];
      assert.equal(block.status,'ready');assert.equal(frame.rotation,rotation);assert.equal(block.fontSize,original.fontSize);
      assert.deepEqual([frame.width,frame.height],[original.rect.width,original.rect.height]);
      assert.deepEqual(imageTextLayout(block,(text,size)=>text.length*size*.5),imageTextLayout(original,(text,size)=>text.length*size*.5));
    }
    assert.deepEqual(validateImageTranslation(value,value),value);
    const edited=editImageTranslation(value,value.blocks[0].id,'OK',value.blocks[0].rect.width,value.blocks[0].rect.height);
    assert.deepEqual(imageTranslationSnapshot(value,edited),edited);
    const history=new ImageHistory(value.width,value.height,true);history.commit({...history.value,translation:{visible:true,document:edited}});
    assert.deepEqual(validateImageDocument(JSON.parse(JSON.stringify(history.value)),history.value.original).translation?.document,JSON.parse(JSON.stringify(edited)));
  }
});

test('separate paragraphs can differ in direction; mixed, skewed, mirrored and vertical-writing lines preserve source',()=>{
  const source=document(),last=source.blocks.flatMap(block=>block.lines).at(-1)!.tokens[0];
  last.quad=[last.quad[2],last.quad[3],last.quad[0],last.quad[1]];
  const paragraphs=imageTranslationDocument(source,result(),'image');assert.deepEqual(paragraphs.blocks.map(block=>block.status),['ready','ready']);assert.equal(imageTranslationFrame(paragraphs.blocks[1]).rotation,180);
  const first=source.blocks[0].lines[0].tokens;first[1].quad=[first[1].quad[2],first[1].quad[3],first[1].quad[0],first[1].quad[1]];
  assert.equal(imageTranslationDocument(source,result(),'mixed').blocks[0].status,'unsupported');
  const normal=document().blocks[0].lines[0].tokens[0].quad;
  assert.equal(imageTranslationRotation([]),undefined);
  assert.equal(imageTranslationRotation([[normal[1],normal[0],normal[3],normal[2]]]),undefined);
  assert.equal(imageTranslationRotation([[{x:10,y:10},{x:40,y:20},{x:40,y:35},{x:10,y:25}]]),undefined);
  const vertical=document(),tokens=vertical.blocks[0].lines[0].tokens;tokens[1].quad=tokens[1].quad.map(point=>({x:point.x-40,y:point.y+20})) as TextQuad;
  assert.equal(imageTranslationDocument(vertical,result(),'vertical').blocks[0].status,'unsupported');
});
test('editor transfer accepts text edits but rejects changed source geometry, identities or secret fields',()=>{
  const base=imageTranslationDocument(document(),result(),'image'),edited=editImageTranslation(base,base.blocks[0].id,'edited',80,25);assert.deepEqual(imageTranslationSnapshot(base,edited),edited);assert.deepEqual(validateImageTranslation(edited,{width:160,height:90}),edited);
  assert.throws(()=>imageTranslationSnapshot(base,{...edited,serviceRevision:'changed'}),/来源/);assert.throws(()=>imageTranslationSnapshot(base,{...edited,id:'other'}),/来源/);
  const altered=structuredClone(edited);altered.blocks[0].glyphs[0][0].x++;assert.throws(()=>imageTranslationSnapshot(base,altered),/来源/);
  assert.throws(()=>validateImageTranslation({...edited,apiKey:'not-allowed'},{width:160,height:90}),/文字层无效/);
  const scene={...new ImageHistory(160,90,true).value,translation:{visible:true,document:edited}},cropped=transformImage(scene,'crop',{x:5,y:5,width:120,height:60}),rotated=transformImage(cropped,'rotate');
  assert.deepEqual(validateImageDocument(rotated,scene.original).translation,scene.translation);assert.deepEqual([rotated.width,rotated.height],[60,120]);assert.deepEqual(scene.transform,[1,0,0,1,0,0]);
  const large=structuredClone(base);large.blocks=[{...large.blocks[0],source:'源'.repeat(199000),text:'译'.repeat(599000),status:'unsupported',glyphs:Array.from({length:120000},()=>[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}])}];assert.ok(JSON.stringify(large).length<8*1024*1024);assert.throws(()=>validateImageTranslation(large,{width:160,height:90}),/文字层过大/);
});
test('image paragraphs use frozen source ranges and preserve failed paragraphs, not sequential output guesses',()=>{
  const source=document(),translation=result(),value=imageTranslationDocument(source,translation,'image');assert.deepEqual(value.blocks.map(block=>[block.source,block.text,block.status]),[['Hello One','你好','ready'],['Again','再次','ready']]);assert.equal(value.blocks[0].glyphs.length,2);assert.equal(value.sourceId,source.id);
  translation.parts![1].status='failed';delete translation.parts![1].text;assert.equal(imageTranslationDocument(source,translation,'partial').blocks[1].status,'untranslated');
  assert.throws(()=>imageTranslationDocument(source,{...translation,source:'other'},'x'),/不一致/);translation.parts![1].start=3;assert.throws(()=>imageTranslationDocument(source,translation,'x'),/范围/);
});
test('missing characters, rotated geometry and overlapping columns stay in the original image',()=>{
  const source=document();source.blocks[0].lines[0].tokens[0].sourceEnd=4;assert.equal(imageTranslationDocument(source,result(),'bad').blocks[0].status,'unsupported');
  const rotated=document();rotated.blocks[0].lines[0].tokens[0].quad[1].y+=10;assert.equal(imageTranslationDocument(rotated,result(),'bad').blocks[0].status,'unsupported');
  const overlap=document();overlap.blocks[0].lines[1].tokens[0].quad=overlap.blocks[0].lines[0].tokens[0].quad;assert.ok(imageTranslationDocument(overlap,result(),'bad').blocks.every(block=>block.status==='unsupported'));
});
test('editable versions do not mutate source or earlier text; expansions cannot overwrite neighbors',()=>{
  const source=document(),value=imageTranslationDocument(source,result(),'image'),next=editImageTranslation(value,value.blocks[0].id,'你好 One',80,25);
  assert.equal(next.version,1);assert.equal(value.blocks[0].text,'你好');assert.equal(source.text,'Hello One\nAgain');assert.equal(next.blocks[0].text,'你好 One');
  assert.throws(()=>editImageTranslation(value,value.blocks[0].id,'x',80,70),/其他文字/);assert.throws(()=>editImageTranslation(value,value.blocks[0].id,'x',1000,20),/超出/);assert.throws(()=>editImageTranslation(value,value.blocks[0].id,'',20,20),/有效译文/);
});
test('layout keeps graphemes and a readable font floor, reports overflow rather than silently discarding text',()=>{
  const block=imageTranslationDocument(document(),result(),'image').blocks[0];const fit=imageTextLayout(block,(text,size)=>[...text].length*size*.5);assert.equal(fit.overflow,false);assert.equal(fit.lines.join(''),block.text);
  const long={...block,text:'ABC👨‍👩‍👧‍👦 '.repeat(20),rect:{...block.rect,width:30,height:15}};const layout=imageTextLayout(long,(text,size)=>[...text].length*size*.5);assert.equal(layout.overflow,true);assert.ok(layout.fontSize>=Math.ceil(block.fontSize*.6));assert.ok(layout.lines.some(line=>line.includes('👨‍👩‍👧‍👦')));
});
test('soft word wrapping never reports a fitting line when a final wide grapheme exceeds the available width',()=>{
  const block={...imageTranslationDocument(document(),result(),'image').blocks[0],fontSize:9,text:'i i界',rect:{x:0,y:0,width:14,height:100}};
  const measure=(text:string,size:number)=>[...text].reduce((width,char)=>width+(char==='界'?10:1),0)*size/9,layout=imageTextLayout(block,measure);
  assert.equal(layout.overflow,false);assert.ok(layout.lines.every(line=>measure(line,layout.fontSize)<=block.rect.width-4));assert.equal(layout.lines.join(''),'ii界');
});
test('cooperative image layout matches synchronous output and cancels before measuring an entire long paragraph',async()=>{
  const original=imageTranslationDocument(document(),result(),'image').blocks[0],measure=(text:string,size:number)=>[...text].length*size*.5;
  for(const text of ['hello one\r\n再次 👨‍👩‍👧‍👦','abc def ghi','字'.repeat(500)]){
    const block={...original,text};assert.deepEqual(await imageTextLayoutAsync(block,measure,{valid:()=>true,yieldControl:async()=>{}}),imageTextLayout(block,measure));
  }
  let current=true,calls=0,yields=0;const block={...original,text:'word '.repeat(12000)};
  await assert.rejects(imageTextLayoutAsync(block,(text,size)=>{calls++;return measure(text,size);},{valid:()=>current,yieldControl:async()=>{yields++;if(calls>0)current=false;}}),/已取消/);assert.ok(yields>0);assert.ok(calls>0&&calls<5000);
  calls=0;await assert.rejects(imageTextLayoutAsync(block,()=>{calls++;return 1;},{valid:()=>false,yieldControl:async()=>{}}),/已取消/);assert.equal(calls,0);
  current=true;await assert.rejects(imageTextLayoutAsync({...original,text:'short'},()=>{current=false;return 1;},{valid:()=>current,yieldControl:async()=>{}}),/已取消/);
});
test('simple background erases glyph strokes only, keeps rules and exterior pixels, and never mutates the original',()=>{
  const width=80,height=50,data=new Uint8ClampedArray(width*height*4).fill(255),black=(x:number,y:number)=>data.set([0,0,0,255],(y*width+x)*4);
  for(let y=16;y<25;y++)for(let x=22;x<27;x++)black(x,y);for(let y=13;y<29;y++)black(35,y);for(let x=10;x<70;x++)black(x,30);black(3,3);
  const source={width,height,data},frozen=data.slice(),output={width,height,data:data.slice()},block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:8,y:10,width:64,height:24},glyphs:[[{x:10,y:12},{x:70,y:12},{x:70,y:33},{x:10,y:33}]] as TextQuad[]};
  const background=repairTranslationBackground(source,output,block);assert.equal(background.kind,'flat');assert.deepEqual(data,frozen);assert.equal(output.data[(18*width+24)*4],255);assert.equal(output.data[(20*width+35)*4],255);assert.equal(output.data[(30*width+30)*4],0);assert.equal(output.data[(3*width+3)*4],0);assert.ok(background.pixels>0);
  const smaller={width,height,data:data.slice()},shrunk=repairTranslationBackground(source,smaller,{...block,rect:{...block.rect,width:10,height:8}});assert.equal(shrunk.kind,'flat');assert.deepEqual(smaller.data,output.data);assert.deepEqual(shrunk.sourceRect,background.sourceRect);
});
test('complex or transparent backgrounds request an explicit readable plate without damaging original pixels',()=>{
  const width=80,height=50,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([(x+y)%2?0:255,30,90,255],(y*width+x)*4);
  const source={width,height,data},output={width,height,data:data.slice()},block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:8,y:10,width:64,height:24}};
  assert.equal(repairTranslationBackground(source,output,block).kind,'plate');assert.deepEqual(output.data,data);
});
test('gradient repair follows the local color plane instead of flattening it, with exact preservation outside glyph masks',()=>{
  const width=100,height=60,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([120+x,150+Math.round(y*.5),230-Math.round(x*.3),255],(y*width+x)*4);
  const truth=data.slice();for(let y=24;y<37;y++)for(let x=35;x<40;x++)data.set([0,0,0,255],(y*width+x)*4);
  const block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:18,y:16,width:64,height:30},glyphs:[[{x:20,y:18},{x:80,y:18},{x:80,y:44},{x:20,y:44}]] as TextQuad[]},output={width,height,data:data.slice()};
  const background=repairTranslationBackground({width,height,data},output,block);assert.equal(background.kind,'gradient');let error=0;
  for(let y=23;y<38;y++)for(let x=34;x<41;x++)for(let channel=0;channel<3;channel++)error=Math.max(error,Math.abs(output.data[(y*width+x)*4+channel]-truth[(y*width+x)*4+channel]));assert.ok(error<=2,'gradient fill must stay within rounding error: '+error);
  assert.deepEqual(output.data.subarray(0,100*4),data.subarray(0,100*4));assert.notEqual(output.data[(30*width+34)*4],output.data[(30*width+40)*4]);
});
test('a sharp split or a gradient crossing dark/light contrast uses a readable plate instead of inventing a smooth background',()=>{
  const width=100,height=60,block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:10,y:10,width:80,height:35},glyphs:[[{x:12,y:12},{x:88,y:12},{x:88,y:43},{x:12,y:43}]] as TextQuad[]};
  for(const smooth of [false,true]){const data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=smooth?Math.round(x/99*255):x<50?30:230;data.set([color,color,color,255],(y*width+x)*4);}const output={width,height,data:data.slice()};assert.equal(repairTranslationBackground({width,height,data},output,block).kind,'plate');assert.deepEqual(output.data,data);}
});
