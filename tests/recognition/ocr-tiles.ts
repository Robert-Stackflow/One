import test from 'node:test';
import assert from 'node:assert/strict';
import { planOCRTiles,planOCRRegionTiles,ocrRect,needsOCRTiles,OCR_TILE_EDGE } from '../../src/shared/recognition/ocr-tiles';
import { textDocument,readingTokens,selectedText } from '../../src/shared/recognition/text-document';
import { mergeOCRTiles } from '../../src/main/recognition/ocr-tile-merge';
import type { OCRResult,OCRWord } from '../../src/shared/recognition/ocr';
const engine={id:'fixture',version:'1',model:'fixed',device:'cpu'},hash='a'.repeat(64);
test('regional tiles decode only the bounded crop and retain original coordinates',()=>{
  const size={width:4000,height:10000},region={left:320,top:4300,width:2400,height:3200},tiles=planOCRRegionTiles(size,region);
  assert.equal(tiles.reduce((sum,tile)=>sum+tile.core.width*tile.core.height,0),region.width*region.height);
  for(const tile of tiles){assert.ok(tile.left>=region.left&&tile.top>=region.top);assert.ok(tile.left+tile.width<=region.left+region.width&&tile.top+tile.height<=region.top+region.height);}
  for(const update of [{left:-1},{top:9999},{width:Infinity},{path:'../secret'},{height:0}])assert.throws(()=>ocrRect({...region,...update},size));
});
function result(tile:ReturnType<typeof planOCRTiles>[number],words:OCRWord[]):OCRResult{
  const value:OCRResult={width:tile.width,height:tile.height,language:'eng',words,text:words.map(word=>word.text).join('\n'),confidence:95};
  value.document=textDocument(value,'b'.repeat(64),{...engine});return value;
}
test('long image plans have bounded context and exactly cover both axes',()=>{
  for(const size of [{width:680,height:16000},{width:16000,height:680},{width:2400,height:16000},{width:4000,height:4000}]){
    assert.equal(needsOCRTiles(size),true);const tiles=planOCRTiles(size);
    assert.equal(tiles.reduce((sum,tile)=>sum+tile.core.width*tile.core.height,0),size.width*size.height);
    for(const tile of tiles){assert.ok(tile.width<=OCR_TILE_EDGE&&tile.height<=OCR_TILE_EDGE);assert.ok(tile.left>=0&&tile.top>=0&&tile.left+tile.width<=size.width&&tile.top+tile.height<=size.height);}
    for(const a of tiles)for(const b of tiles)if(a.index!==b.index)assert.ok(a.core.left+a.core.width<=b.core.left||b.core.left+b.core.width<=a.core.left||a.core.top+a.core.height<=b.core.top||b.core.top+b.core.height<=a.core.top);
  }
  assert.equal(needsOCRTiles({width:1000,height:1000}),false);
  assert.throws(()=>planOCRTiles({width:16385,height:100}));
});
test('seam copies deduplicate while repeated words and real glyph positions survive',()=>{
  const size={width:500,height:9000},tiles=planOCRTiles(size),positions=[100,1780,3580,5380,7180,8880];
  const parts=tiles.map(tile=>({tile,result:result(tile,positions.filter(y=>y>=tile.top&&y+30<=tile.top+tile.height).map((y,line)=>({text:'ONE',x:20,y:y-tile.top,width:90,height:30,line,confidence:95,
    symbols:[{text:'O',x:20,y:y-tile.top,width:30,height:30,confidence:95},{text:'N',x:50,y:y-tile.top,width:30,height:30,confidence:95},{text:'E',x:80,y:y-tile.top,width:30,height:30,confidence:95}]})))}));
  const merged=mergeOCRTiles(parts,size,hash);assert.equal(merged.words.length,positions.length);
  assert.deepEqual(merged.words.map(word=>word.y),positions);assert.equal(merged.document!.source.sha256,hash);
  assert.equal(merged.document!.source.height,9000);const tokens=readingTokens(merged.document!);
  assert.equal(tokens.length,18);assert.equal(tokens[tokens.length-1].quad[0].y,8880);
  assert.equal(selectedText(tokens,0,tokens.length-1),merged.text);
});
test('approximate token quads and offsets are rebased after seam ownership',()=>{
  const size={width:500,height:9000},tiles=planOCRTiles(size),tile=tiles[4];
  const value=result(tile,[{text:'ON',x:10,y:200,width:80,height:30,line:0,confidence:95}]);
  const line=value.document!.blocks[0].lines[0],base=line.tokens[0];
  line.tokens=[{...base,text:'O',geometry:'ctc',wordId:'w0:0',quad:[{x:10,y:200},{x:35,y:200},{x:35,y:230},{x:10,y:230}]},
    {...base,text:'N',geometry:'ctc',wordId:'w0:0',quad:[{x:35,y:200},{x:90,y:200},{x:90,y:230},{x:35,y:230}]}];
  const parts=tiles.map(part=>({tile:part,result:part.index===tile.index?value:result(part,[])}));
  const merged=mergeOCRTiles(parts,size,hash),tokens=readingTokens(merged.document!);
  assert.equal(merged.text,'ON');assert.equal(tokens.length,2);assert.ok(tokens.every(token=>token.geometry==='ctc'));
  assert.equal(tokens[0].quad[0].y,tile.top+200);assert.equal(tokens[1].quad[0].x,35);
  assert.equal(tokens[0].sourceStart,0);assert.equal(tokens[1].sourceStart,1);assert.equal(tokens[1].sourceEnd,2);
  assert.equal(selectedText(tokens,0,1),'ON');
  value.document!.engine.model='different';assert.throws(()=>mergeOCRTiles(parts,size,hash),/模型/);
});
test('seam jitter does not drop both copies when neither center is in its ownership region',()=>{
  const size={width:500,height:9000},tiles=planOCRTiles(size);
  const parts=tiles.map(tile=>({tile,result:result(tile,tile.index<2?[{text:'SEAM',x:20,y:(tile.index?1771:1773)-tile.top,width:100,height:40,line:0,confidence:95}]:[])}));
  const merged=mergeOCRTiles(parts,size,hash);assert.equal(merged.text,'SEAM');assert.equal(merged.words.length,1);
});
test('two dimensional crops preserve global columns and join same-row fragments',()=>{
  const size={width:4000,height:4000},tiles=planOCRTiles(size),source=[{text:'LEFT',x:1740,y:100,width:80,height:30,line:0,confidence:95},{text:'RIGHT',x:1840,y:100,width:80,height:30,line:0,confidence:95}];
  const parts=tiles.map(tile=>({tile,result:result(tile,source.filter(word=>word.x>=tile.left&&word.x+word.width<=tile.left+tile.width&&word.y>=tile.top&&word.y+word.height<=tile.top+tile.height).map(word=>({...word,x:word.x-tile.left,y:word.y-tile.top})))}));
  const merged=mergeOCRTiles(parts,size,hash);assert.equal(merged.text,'LEFT RIGHT');assert.equal(merged.words.length,2);
  assert.deepEqual(merged.words.map(word=>word.x),[1740,1840]);assert.equal(merged.words[0].line,merged.words[1].line);
});
