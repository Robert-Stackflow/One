import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {pix2texDecoder} from '../../src/main/recognition/pix2tex-decoder';
import {pix2texInput,pix2texPad,pix2texTensor} from '../../src/main/recognition/pix2tex-input';
import {formulaGrayResize} from '../../src/main/recognition/formula-resample';

function config(){const words=['[PAD]','[BOS]','[EOS]','\\frac','{','a','}','b','Ġ','é','β','\\ ','x','^','2','\\text','hello','world'];return {decoder:null,model:{vocab:Object.fromEntries(Array.from({length:1175},(_,id)=>[words[id]??'fixture'+id,id]))},added_tokens:words.slice(0,3).map((content,id)=>({content,id,special:true}))};}
test('pix2tex decoding retains the fixed tokenizer and upstream whitespace semantics, requires EOS and rejects unknown tokens',()=>{
  const decode=pix2texDecoder(config());assert.equal(decode([3,8,4,5,6,8,4,7,6,2]),'\\frac{a}{b}');assert.equal(decode([15,8,4,16,8,17,6,2]),'\\text{helloworld}');assert.equal(decode([9,8,10,2]),'é β');assert.equal(decode([12,11,7,2]),'x\\ b');
  assert.throws(()=>decode([12]),/完整结束/);assert.throws(()=>decode([8000,2]),/未知字符/);assert.throws(()=>decode([...Array(512).fill(12),2]),/完整结束/);assert.throws(()=>pix2texDecoder({...config(),decoder:{type:'ByteLevel'}}),/配置/);
  const duplicate=config();duplicate.model.vocab.extra=7;assert.throws(()=>pix2texDecoder(duplicate),/字典/);
  const special=config();special.added_tokens=[special.added_tokens[0],special.added_tokens[0],special.added_tokens[0]];assert.throws(()=>pix2texDecoder(special),/字典/);
});
test('pix2tex foreground cropping handles polarity and distinguishes constant opacity from a transparency mask without mutating PNG input',async()=>{
  const data=new Uint8Array(16).fill(255);data[5]=0;data[10]=64;const light=pix2texPad({data,width:4,height:4}),dark=pix2texPad({data:Uint8Array.from(data,value=>255-value),width:4,height:4});assert.equal(light.width,32);assert.deepEqual(light,dark);assert.equal(light.data[0],0);assert.equal(light.data[33],64);assert.throws(()=>pix2texPad({data:new Uint8Array(16).fill(255),width:4,height:4}),/笔画/);
  const rgba=Buffer.alloc(4*4*4);for(let i=0;i<16;i++){rgba[i*4+3]=255-data[i];}const transparent=await sharp(rgba,{raw:{width:4,height:4,channels:4}}).png().toBuffer(),original=Buffer.from(transparent),alpha=await pix2texInput(transparent);assert.deepEqual(transparent,original);assert.deepEqual(alpha,light);
  const pixels=pix2texTensor(light);assert.equal(pixels.length,1024);assert.ok(pixels.every(Number.isFinite));await assert.rejects(pix2texInput(Buffer.alloc(24)),/PNG/);
  assert.throws(()=>formulaGrayResize(new Uint8Array(32*8192),32,8192,8192,32,'lanczos'),/尺寸/);
});
