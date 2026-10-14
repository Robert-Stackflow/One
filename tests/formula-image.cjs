const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
async function main(){
  const root=path.resolve('work/current/capture-reconstruction/formula'),directory=await fs.mkdtemp(path.join(root,'image-unit-'));let runner;
  try{
    const options={bundle:true,platform:'node',format:'cjs',target:'node22',external:['sharp','koffi'],logLevel:'warning'};
    await Promise.all([build({...options,entryPoints:['src/main/recognition/formula-image-worker.ts'],outfile:path.join(directory,'worker.cjs')}),build({...options,entryPoints:['src/main/recognition/formula-image-runner.ts'],outfile:path.join(directory,'runner.cjs')})]);
    const {FormulaImageRunner}=require(path.join(directory,'runner.cjs'));runner=new FormulaImageRunner(path.join(directory,'worker.cjs'));
    const wrapper=path.join(directory,'offline.cjs');await fs.writeFile(wrapper,`const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){if(String(name).includes('@mathjax'))throw Error('Unexpected runtime font/module load');return load.call(this,name,...args);};require(${JSON.stringify(path.join(directory,'worker.cjs'))});`);await runner.close();runner=new FormulaImageRunner(wrapper);
    for(const text of [String.raw`\frac{a}{b}`,String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,String.raw`f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,String.raw`\sum_{i=1}^{n}\alpha_i+\sqrt{x}`,String.raw`\begin{aligned}a&=b+c\\d&=e\end{aligned}`]){
      const result=await runner.render(text);assert.ok(result.svg.includes('<path'));assert.doesNotMatch(result.svg,/<(?:image|foreignObject|script)\b|https?:\/\/(?!www.w3.org)/);const raw=await sharp(result.png).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(raw.info.width,result.width);assert.ok(raw.data.some((value,index)=>index%4!==3&&value<150));assert.ok(result.width>24&&result.height>24);
    }
    await assert.rejects(runner.render(String.raw`\href{https://example.com}{link}`),/链接|HTML|trust|preview|扩展/);await assert.rejects(runner.render(String.raw`\badcommand`));
    const unicode=await runner.render(String.raw`\alpha+\text{中文}`);assert.ok(unicode.svg.includes('中文'));
    const image=await sharp({create:{width:200,height:120,channels:3,background:'#ffffff'}}).composite([{input:await sharp({create:{width:40,height:30,channels:3,background:'#ef3434'}}).png().toBuffer(),left:20,top:10}]).png().toBuffer();
    for(const rotation of [0,1,2,3]){const result=await runner.crop(image,{width:200,height:120},{region:{left:20,top:10,width:40,height:30},rotation});assert.deepEqual([result.width,result.height],rotation%2?[30,40]:[40,30]);const pixel=await sharp(result.png).removeAlpha().raw().toBuffer();assert.equal(pixel[0],239);assert.equal(pixel[1],52);}
    await assert.rejects(async()=>runner.crop(image,{width:200,height:120},{region:{left:199,top:10,width:40,height:30},rotation:0}),/超出/);
    await runner.close();const pidFile=path.join(directory,'pid'),stall=path.join(directory,'stall.cjs');await fs.writeFile(stall,`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('message',()=>{});setInterval(()=>{},1000);`);
    runner=new FormulaImageRunner(stall,5000);const task=runner.render('x');void task.catch(()=>{});let pid;for(let n=0;n<200;n++){try{pid=Number(await fs.readFile(pidFile,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}assert.ok(pid);await runner.cancel();await assert.rejects(task,/取消/);assert.throws(()=>process.kill(pid,0),/ESRCH/);
    console.log('Formula images: local bundled vector glyphs, fraction/matrix/cases/multiline, bounded PNG, rejected unsafe input, exact rotated crops and cancellation/child exit passed.');
  }finally{await runner?.close();const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('image-unit-'));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
