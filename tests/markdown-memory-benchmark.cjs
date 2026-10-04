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
    await expect(preview.frameLocator('iframe').locator('.math-pending,.katex').first()).toBeAttached();
    const readyMs=Math.round(performance.now()-start);
    states.push(await stage('rendered'));
    const maxRenderedDelta=Number(process.env.ONE_MAX_RENDERED_DELTA_MB||0),maxReadyMs=Number(process.env.ONE_MAX_READY_MS||0);
    if(maxRenderedDelta>0)assert.ok(states[1].privateMB-states[0].privateMB<maxRenderedDelta,`Initial Markdown render retained too much memory: ${states[1].privateMB-states[0].privateMB} MiB`);
    if(maxReadyMs>0)assert.ok(readyMs<maxReadyMs,`Initial Markdown render took ${readyMs} ms`);
    const dom=process.env.ONE_DIAGNOSTIC_DOM==='1'?await preview.frameLocator('iframe').locator('.markdown-content').evaluate(root=>{
      const math=Array.from(root.querySelectorAll('.katex'));
      const images=Array.from(root.querySelectorAll('img'));
      return {elements:root.querySelectorAll('*').length,math:math.length,pendingMath:root.querySelectorAll('.math-pending').length,mathElements:math.reduce((sum,node)=>sum+node.querySelectorAll('*').length,0),images:images.map(image=>({loaded:image.complete&&image.naturalWidth>0,width:image.naturalWidth,height:image.naturalHeight,top:Math.round(image.getBoundingClientRect().top)}))};
    }):undefined;
    const image=preview.frameLocator('iframe').locator('.markdown-content img').first();
    if(process.env.ONE_DIAGNOSTIC_DOM==='1')console.error(JSON.stringify(await image.evaluate(value=>({src:value.getAttribute('src'),deferred:!!value.dataset.previewSrc,loading:value.loading,top:value.getBoundingClientRect().top,height:value.getBoundingClientRect().height,viewport:value.ownerDocument.documentElement.clientHeight,lightbox:!!value.ownerDocument.querySelector('.markdown-lightbox')}))));
    await expect.poll(()=>image.evaluate(value=>value.naturalWidth)).toBeGreaterThan(0);
    const galleryStart=performance.now();await image.evaluate(value=>value.click());await expect(preview.frameLocator('iframe').locator('.markdown-lightbox')).toBeVisible();
    const thumbs=preview.frameLocator('iframe').locator('.lightbox-thumb img'),imageCount=await preview.frameLocator('iframe').locator('.markdown-content img').count();
    await expect.poll(()=>thumbs.evaluateAll(items=>items.filter(item=>item.src.startsWith('data:image/')).length),{timeout:30000}).toBe(imageCount);
    const thumbnailsMs=Math.round(performance.now()-galleryStart);
    states.push(await stage('gallery'));
    const maxGalleryDelta=Number(process.env.ONE_MAX_GALLERY_DELTA_MB||0);
    if(maxGalleryDelta>0)assert.ok(states.at(-1).privateMB-states.at(-2).privateMB<maxGalleryDelta,`Gallery retained too much memory: ${states.at(-1).privateMB-states.at(-2).privateMB} MiB`);
    let walk;
    if(process.env.ONE_SCROLL_WALK==='1'){
      await preview.frameLocator('iframe').locator('[data-gallery-action=close]').click();
      await preview.evaluate(()=>{window.markdownGaps=[];let last=performance.now();window.markdownHeartbeat=setInterval(()=>{const now=performance.now();window.markdownGaps.push(now-last);last=now;},20);});
      let offset=0,steps=0;
      const body=preview.frameLocator('iframe').locator('body');
      for(;steps<600;steps++){
        const position=await body.evaluate((element,value)=>{const scroller=element.ownerDocument.scrollingElement;scroller.scrollTop=value;return {height:scroller.scrollHeight,viewport:scroller.clientHeight};},offset);
        if(offset>=position.height-position.viewport)break;
        offset+=Math.max(450,position.viewport*.75);
        await pause(20);
      }
      await pause(500);
      const elements=await body.evaluate(element=>({renderedMath:element.querySelectorAll('.katex').length,pendingMath:element.querySelectorAll('.math-pending').length,loadedImages:Array.from(element.querySelectorAll('.markdown-content img')).filter(image=>image.naturalWidth>0).length,elements:element.querySelectorAll('.markdown-content *').length}));
      const gaps=await preview.evaluate(()=>{clearInterval(window.markdownHeartbeat);return window.markdownGaps;});
      walk={steps,maxGapMs:Math.round(Math.max(...gaps)),...elements};
      states.push(await stage('walked'));
    }
    await preview.close();await pause(5000);states.push(await stage('closed'));
    const cooldown=Number(process.env.ONE_BENCH_COOLDOWN_MS||5000);
    if(cooldown>5000){await pause(cooldown-5000);states.push(await stage('closed-idle'));}
    const report={file,size:(await fs.stat(file)).size,readyMs,thumbnailsMs,images:imageCount,dom,walk,states};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await app.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
