import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,lstat,readdir,realpath,rm,mkdtemp} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
import sharp from 'sharp';
import {OCRModels,ocrPacks} from '../../src/main/recognition/ocr-models';
import {OCRRunner} from '../../src/main/recognition/ocr-runner';
import {detectSensitive} from '../../src/shared/recognition/sensitive-api';

const cache=resolve('work/current/fixtures/recognition-models'),models=new OCRModels(cache);
let png:Buffer;
const size={width:1400,height:320};
test.before(async()=>{
  await mkdir(cache,{recursive:true});assert.equal((await lstat(cache)).isSymbolicLink(),false);assert.equal(await realpath(cache),cache);
  const marker=join(cache,'.one-fixture');
  if((await readdir(cache)).length)assert.equal(await readFile(marker,'utf8'),'One recognition test models\n');else await writeFile(marker,'One recognition test models\n',{flag:'wx'});
  // Explicit fixture preparation; production state/prepare never download automatically.
  try{const packs=await models.prepare('chi_sim+eng');for(const pack of packs)pack.data.fill(0);}catch{await models.install();}
  png=await sharp(Buffer.from('<svg width="1400" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="64"><text x="50" y="95">ONE OCR 2026</text><text x="50" y="190">sample@example.com</text></g><text x="50" y="280" fill="black" font-family="Microsoft YaHei" font-size="54">截图识别测试</text></svg>')).png().toBuffer();
});

test('built Tesseract worker loads verified English and Chinese packs and returns real text with image coordinates',async()=>{
  const runner=new OCRRunner(models),progress:number[]=[],result=await runner.run(png,size,'chi_sim+eng',value=>progress.push(value));
  assert.match(result.text,/ONE OCR 2026/i);assert.match(result.text,/sample@example\.com/i);assert.match(result.text.replace(/\s/g,''),/截图识别测试/);
  assert.ok(result.words.length>=5);assert.ok(result.words.every(word=>word.x>=0&&word.y>=0&&word.x+word.width<=size.width&&word.y+word.height<=size.height));
  assert.ok(progress.length>0&&progress.every(value=>value>=0&&value<=1));
  const sensitive=detectSensitive(result);assert.ok(sensitive.regions.some(region=>region.kind==='email'));assert.equal(JSON.stringify(sensitive).includes('sample@'),false);
});

test('real OCR cancellation rejects overlap, waits for worker shutdown and permits the next table recognition',async()=>{
  const runner=new OCRRunner(models),pending=runner.run(png,size,'eng');
  const rejected=assert.rejects(pending,/取消/);
  await assert.rejects(runner.run(png,size,'eng'),/正在识别/);await runner.cancel();await rejected;
  const result=await runner.run(png,size,'eng',()=>{},'table');assert.match(result.text,/ONE OCR 2026/i);assert.ok(result.words.length>=4);
});

test('missing or corrupt language packs never trigger implicit networking and failed installation removes partial files',async()=>{
  const root=resolve(process.env.ONE_RECOGNITION_TEST_ROOT!),directory=await mkdtemp(join(root,'models-'));let requests=0;
  const missing=new OCRModels(directory,async()=>{requests++;return new Response(new Uint8Array(8),{headers:{'content-length':'8'}});});
  try{
    assert.equal((await missing.state()).ready,false);await assert.rejects(missing.prepare('eng'),/语言包/);assert.equal(requests,0);
    await assert.rejects(missing.install(),/大小不符/);assert.equal(requests,1);assert.deepEqual(await readdir(directory),[]);
    for(const pack of ocrPacks)await writeFile(join(directory,pack.id+'.traineddata'),Buffer.alloc(pack.bytes));
    await assert.rejects(missing.prepare('chi_sim+eng'),/语言包/);assert.equal(requests,1);
  }finally{await missing.settle();const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));assert.ok(basename(actual).startsWith('models-'));await rm(actual,{recursive:true,force:true});}
});
