const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), sharp = require('sharp');
(async () => {
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'first-frame-')),timing=process.argv.includes('--timing'),durations=[];let app;
  try {
    const input=path.join(directory,'source.png');await sharp({create:{width:800,height:1400,channels:3,background:'white'}}).png().toFile(input);
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(directory,'profile')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog},input)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});},input);
    await home.locator('[data-page=materials]').click();await home.getByRole('button',{name:'导入图片',exact:true}).click();
    async function check(button,view) {
      await app.evaluate(({session,app},timing)=>{
        global.frameGate={css:false,image:false,release:{},shown:[]};
        session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
          const key=details.resourceType==='stylesheet'?'css':/^one-file:\/\/(?:recognition|formula-recognition)\//.test(details.url)&&details.resourceType==='image'?'image':undefined;
          if(!timing&&key&&!global.frameGate[key]){global.frameGate[key]=true;global.frameGate.release[key]=()=>callback({});}else callback({});
        });
        const listener=(_event,window)=>{global.frameGate.createdAt=Date.now();window.once('show',()=>{global.frameGate.shownAt=Date.now();global.frameGate.shown.push(window.id);});};
        global.frameGate.listener=listener;app.on('browser-window-created',listener);
      },timing);
      const opening=app.waitForEvent('window'),started=Date.now();await button.click();const page=await opening;await page.waitForURL('**view='+view,{waitUntil:'commit'});
      const hidden=()=>app.evaluate(({BrowserWindow},view)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('view='+view));return !!window&&!window.isVisible();},view);
      if(!timing){await expect.poll(()=>app.evaluate(()=>global.frameGate.css)).toBe(true);assert.equal(await hidden(),true,'must stay hidden while dynamic CSS is pending');
      await app.evaluate(()=>global.frameGate.release.css());
      await expect.poll(()=>app.evaluate(()=>global.frameGate.image)).toBe(true);await expect.poll(hidden).toBe(false);
      await expect(page.locator('.recognition-image-placeholder')).toBeVisible();
      assert.equal(await page.locator('#source').evaluate(image=>getComputedStyle(image).visibility),'hidden');
      assert.equal(await page.locator('.media-header').evaluate(header=>getComputedStyle(header).display),'flex');
      await app.evaluate(()=>global.frameGate.release.image());}
      await expect.poll(hidden).toBe(false);await expect(page.locator('.recognition-image-placeholder')).toHaveCount(0);
      if(timing){const marks=await app.evaluate(()=>({created:global.frameGate.createdAt,shown:global.frameGate.shownAt}));durations.push({view,clickToCreate:marks.created-started,createToShow:marks.shown-marks.created,total:marks.shown-started});}
      const first=await page.evaluate(()=>{const image=document.querySelector('#source'),header=document.querySelector('.media-header');return {image:image.complete&&image.naturalWidth===800,header:getComputedStyle(header).display,controls:!!document.querySelector('.custom-select'),width:image.getBoundingClientRect().width};});
      assert.equal(first.image,true);assert.equal(first.header,'flex');assert.ok(first.width>0);if(view==='recognition')assert.equal(first.controls,true);
      const viewport=page.locator('.text-image-viewport'),stage=page.locator('.text-image-stage');
      async function contained(){const area=await viewport.boundingBox(),image=await stage.boundingBox();return image.x>=area.x+15&&image.y>=area.y+15&&image.x+image.width<=area.x+area.width-15&&image.y+image.height<=area.y+area.height-15;}
      await expect.poll(contained).toBe(true);
      await viewport.evaluate(node=>node.focus());assert.equal(await viewport.evaluate(node=>getComputedStyle(node).outlineStyle),'none');
      await page.getByRole('button',{name:'旋转',exact:true}).click();await expect.poll(contained).toBe(true);
      await page.getByRole('button',{name:'放大',exact:true}).click();await page.getByRole('button',{name:'适应画布',exact:true}).click();await expect.poll(contained).toBe(true);
      if(view==='recognition'){await page.locator('#result-panel-toggle').click();await expect.poll(contained).toBe(true);await page.locator('#result-panel-toggle').click();await expect.poll(contained).toBe(true);}
      await page.close();await app.evaluate(({session,app})=>{session.defaultSession.webRequest.onBeforeRequest(null);app.removeListener('browser-window-created',global.frameGate.listener);});
    }
    await check(home.getByRole('button',{name:'识别文字',exact:true}),'recognition');
    await check(home.getByRole('button',{name:'识别公式',exact:true}),'formula-recognition');
    if(timing)console.log(JSON.stringify(durations));
    console.log('OCR/formula: styled first frame, nonblocking image placeholder, borderless fit, rotate/reset and panel resize passed');
  } finally {await app?.close();const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
