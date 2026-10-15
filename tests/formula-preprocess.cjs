const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),sharp=require('sharp'),{build}=require('esbuild');
// RGB fixtures are independent of resampling. Golden tensors come from pinned Pillow/NumPy.
function fixture({width,height,border}){
  const data=Buffer.alloc(width*height*3,255);
  for(let y=border;y<height-border;y++)for(let x=border;x<width-border;x++){
    const at=(y*width+x)*3;data[at]=(x*17+y*29+47)%256;data[at+1]=(x*43+y*11+83)%256;data[at+2]=(x*7+y*61+19)%256;
  }
  return data;
}
async function main(){
  const root=path.resolve('work/current/capture-reconstruction/formula');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'preprocess-test-'));
  try{
    await build({entryPoints:['src/main/recognition/formula-local.ts'],outfile:path.join(directory,'pipeline.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'warning'});
    const {formulaInput}=require(path.join(directory,'pipeline.cjs')),gold=JSON.parse(await fs.readFile('tests/fixtures/formula-preprocess.json','utf8')),results=[];
    for(const item of gold.cases){
      const data=fixture(item),png=await sharp(data,{raw:{width:item.width,height:item.height,channels:3}}).png().toBuffer(),start=performance.now(),pixels=await formulaInput(png);
      const hash=createHash('sha256').update(Buffer.from(pixels.buffer)).digest('hex');assert.equal(hash,item.sha256,item.id+' differs from '+gold.reference);
      assert.equal(pixels.length,384*384);assert.ok(pixels.every(Number.isFinite));results.push({id:item.id,elapsedMs:Math.round(performance.now()-start),sha256:hash});data.fill(0);pixels.fill(0);
    }
    const blank=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();await assert.rejects(formulaInput(blank),/笔画/);
    const thin=await sharp({create:{width:100,height:4,channels:3,background:'#fff'}}).composite([{input:Buffer.from('<svg width="100" height="4"><rect width="100" height="1" fill="black"/></svg>')}]).png().toBuffer();await assert.rejects(formulaInput(thin),/狭长/);
    await fs.writeFile(path.join(root,'preprocess-golden-report.json'),JSON.stringify({reference:gold.reference,results},null,2));console.log('Formula preprocessing: '+results.length+' RGB fixtures exactly match pinned Pillow float32 tensors; blank/thin inputs rejected.');
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('preprocess-test-'));await fs.rm(actual,{recursive:true,force:true});}
}
module.exports={fixture};if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
