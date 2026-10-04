const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const assert=require('node:assert/strict');
const {snapshot}=require('./app-memory-benchmark.cjs');

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mb=value=>Math.round(value/1024**2*10)/10;

async function main(){
  const file=process.env.ONE_LARGE_MDX;
  if(!file)throw new Error('Set ONE_LARGE_MDX to a representative local .mdx file');
  const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/markdown-memory');
  await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-'));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.')],env});
  const stage=async name=>{const result=await snapshot(app);return {name,privateMB:mb(result.private),privateResidentMB:mb(result.privateResident),residentMB:mb(result.resident),processes:result.processes.length,byProcess:result.processes.map(item=>({name:item.name,privateMB:mb(item.private)})),windows:result.windows.map(({view,visible})=>({view,visible}))};};
  try{
    const main=await app.firstWindow();await main.waitForSelector('#overview-index');await pause(1500);
    const states=[await stage('idle')];
    const start=performance.now(),opened=app.waitForEvent('window');await main.evaluate(value=>window.one.preview(value),file);const preview=await opened;
    await expect(preview.frameLocator('iframe').locator('.markdown-content')).toBeVisible();
    await expect(preview.frameLocator('iframe').locator('.katex').first()).toBeVisible();
    const readyMs=Math.round(performance.now()-start);
    states.push(await stage('rendered'));
    const image=preview.frameLocator('iframe').locator('.markdown-content img').first();await expect.poll(()=>image.evaluate(value=>value.naturalWidth)).toBeGreaterThan(0);
    const galleryStart=performance.now();await image.evaluate(value=>value.click());await expect(preview.frameLocator('iframe').locator('.markdown-lightbox')).toBeVisible();
    const thumbs=preview.frameLocator('iframe').locator('.lightbox-thumb img'),imageCount=await preview.frameLocator('iframe').locator('.markdown-content img').count();
    await expect.poll(()=>thumbs.evaluateAll(items=>items.filter(item=>item.src.startsWith('data:image/')).length),{timeout:30000}).toBe(imageCount);
    const thumbnailsMs=Math.round(performance.now()-galleryStart);
    states.push(await stage('gallery'));
    const maxGalleryDelta=Number(process.env.ONE_MAX_GALLERY_DELTA_MB||0);
    if(maxGalleryDelta>0)assert.ok(states.at(-1).privateMB-states.at(-2).privateMB<maxGalleryDelta,`Gallery retained too much memory: ${states.at(-1).privateMB-states.at(-2).privateMB} MiB`);
    await preview.close();await pause(5000);states.push(await stage('closed'));
    const cooldown=Number(process.env.ONE_BENCH_COOLDOWN_MS||5000);
    if(cooldown>5000){await pause(cooldown-5000);states.push(await stage('closed-idle'));}
    const report={file,size:(await fs.stat(file)).size,readyMs,thumbnailsMs,images:imageCount,states};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await app.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
