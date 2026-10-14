import test from 'node:test';
import assert from 'node:assert/strict';
import {textDocument,type TextQuad} from '../../src/shared/recognition/text-document';
import {imageTranslationDocument,imageTextLayout,editImageTranslation} from '../../src/shared/recognition/image-translation';
import {repairTranslationBackground} from '../../src/shared/recognition/image-translation-background';
import type {TranslationResult} from '../../src/shared/recognition/translation';
const document=()=>textDocument({text:'Hello One\nAgain',width:160,height:90,confidence:90,language:'eng',words:[{text:'Hello',x:10,y:10,width:30,height:15,line:0,confidence:90},{text:'One',x:50,y:10,width:25,height:15,line:0,confidence:90},{text:'Again',x:10,y:50,width:50,height:15,line:1,confidence:90}]},'a'.repeat(64),{id:'fixture',version:'1',model:'test',device:'cpu'});
const result=():TranslationResult=>({id:'job',source:'Hello One\nAgain',text:'你好\n再次',target:'zh-Hans',revision:'service',endpoint:'fixture',parts:[{id:'source',start:0,end:9,paragraph:1,chunk:1,status:'translated',text:'你好'},{id:'p2',start:10,end:15,paragraph:2,chunk:1,status:'translated',text:'再次'}]});
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
test('simple background erases glyph strokes only, keeps rules and exterior pixels, and never mutates the original',()=>{
  const width=80,height=50,data=new Uint8ClampedArray(width*height*4).fill(255),black=(x:number,y:number)=>data.set([0,0,0,255],(y*width+x)*4);
  for(let y=16;y<25;y++)for(let x=22;x<27;x++)black(x,y);for(let y=13;y<29;y++)black(35,y);for(let x=10;x<70;x++)black(x,30);black(3,3);
  const source={width,height,data},frozen=data.slice(),output={width,height,data:data.slice()},block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:8,y:10,width:64,height:24},glyphs:[[{x:10,y:12},{x:70,y:12},{x:70,y:33},{x:10,y:33}]] as TextQuad[]};
  const background=repairTranslationBackground(source,output,block);assert.equal(background.kind,'flat');assert.deepEqual(data,frozen);assert.equal(output.data[(18*width+24)*4],255);assert.equal(output.data[(20*width+35)*4],255);assert.equal(output.data[(30*width+30)*4],0);assert.equal(output.data[(3*width+3)*4],0);assert.ok(background.pixels>0);
});
test('complex or transparent backgrounds request an explicit readable plate without damaging original pixels',()=>{
  const width=80,height=50,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([(x+y)%2?0:255,30,90,255],(y*width+x)*4);
  const source={width,height,data},output={width,height,data:data.slice()},block={...imageTranslationDocument(document(),result(),'image').blocks[0],rect:{x:8,y:10,width:64,height:24}};
  assert.equal(repairTranslationBackground(source,output,block).kind,'plate');assert.deepEqual(output.data,data);
});
