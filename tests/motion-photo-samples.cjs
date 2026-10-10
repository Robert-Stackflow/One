// Read-only verification for user-provided phone originals. No screenshots or file copies.
const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
async function digest(file){const hash=crypto.createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
async function run(){
 const files=process.argv.slice(2).map(file=>path.resolve(file));if(!files.length)throw Error('Provide the original image paths as arguments.');
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/image-preview/phone-samples');await fs.mkdir(output,{recursive:true});
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env:{...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(output,'profile')},timeout:30000}),results=[],errors=[];app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);await main.evaluate(()=>window.one.patchSettings({preview:{held:true,pinned:false,files:false}}));let page;
  for(const file of files){const before=await digest(file),started=Date.now();
   if(!page){const opening=app.waitForEvent('window',{predicate:p=>p.url().includes('view=preview')});await main.evaluate(p=>window.one.preview(p),file);page=await opening;}else await page.evaluate(p=>window.one.selectPreview(p),file);
   await expect(page.locator('#preview-name')).toHaveText(path.basename(file));await expect(page.locator('.photo-visual img')).toBeVisible();await expect.poll(()=>page.locator('.photo-visual img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await expect(page.locator('#image-motion')).toBeVisible();
   const source=await page.evaluate(async()=>{const data=await window.one.previewData();return {source:data.motionPhoto?.source,presentationTime:data.motionPhoto?.presentationTime};});
   const metadata=await page.evaluate(async()=>{const d=await window.one.previewData();return {flash:d.metadata?.['闪光灯'],hasGPS:!!d.photoLocation,hasStoredPlace:!!d.metadata?.['拍摄地点']};});
   await expect(page.locator('#preview-details-list')).toContainText('闪光灯');if(metadata.hasGPS)await expect(page.locator('#preview-details-list')).toContainText('GPS 坐标');
   await page.locator('#image-motion').click();await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime),{timeout:15000}).toBeGreaterThan(.15);
   const media=await page.locator('video').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,muted:v.muted,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames}));if(!media.width||!media.height||!media.muted||media.decodedFrames<1)throw Error('Video did not decode: '+path.basename(file));
   await expect(page.locator('video')).toBeHidden({timeout:20000});
   // Check the sound control without playing private audio into the room.
   await page.locator('#image-sound').click();if(await page.locator('video').evaluate(v=>v.muted))throw Error('Sound control did not change mute state');await page.locator('#image-sound').click();
   const unchanged=before===await digest(file);if(!unchanged)throw Error('Original changed: '+file);
   results.push({name:path.basename(file),source,...metadata,...media,unchanged,elapsedMs:Date.now()-started});
  }
  if(errors.length)throw Error(errors.join('\n'));
 }finally{await app.close();await fs.mkdir('verification/image-preview',{recursive:true});await fs.writeFile('verification/image-preview/phone-samples.json',JSON.stringify({date:new Date().toISOString(),results,errors,scope:'Original files read locally, playback decoded, mute control checked while paused. No screenshots, uploads or original modifications.'},null,2));}
 console.log(JSON.stringify({passed:results.length,results}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
