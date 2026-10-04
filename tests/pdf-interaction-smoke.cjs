const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/pdf-interaction'),files=path.resolve(process.env.ONE_PDF_FIXTURE_DIR||'work/pdf-scroll/files');
 await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(output,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await main.evaluate(()=>window.one.patchSettings({preview:{held:true,files:true,leftWidth:300}}));
  const opening=app.waitForEvent('window',{predicate:page=>page.url().includes('view=preview')});await main.evaluate(file=>window.one.preview(file),path.join(files,'2050-pages.pdf'));const preview=await opening;
  await expect(preview.locator('.pdf-sheet')).toHaveCount(2050);await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/);
  const start=async value=>preview.locator('#pdf-search').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#pdf-find').click();},value);
  await start('MISSING_PDF_MARKER');await expect(preview.locator('#pdf-find')).toHaveText('停止');await expect(preview.locator('#pdf-found')).toHaveText(/查找 \d+\/2050 页/);
  const cancelStart=Date.now();await preview.locator('#pdf-find').evaluate(button=>button.click());await expect(preview.locator('#pdf-found')).toHaveText('已停止');await expect(preview.locator('#pdf-find')).toHaveText('查找');const cancelMs=Date.now()-cancelStart;
  await preview.waitForTimeout(350);await expect(preview.locator('#pdf-found')).toHaveText('已停止');
  // The older no-match search must not clear the replacement search's final result.
  await preview.evaluate(()=>{
   const input=document.querySelector('#pdf-search'),button=document.querySelector('#pdf-find');
   input.value='MISSING_PDF_MARKER';input.dispatchEvent(new Event('input',{bubbles:true}));button.click();
   setTimeout(()=>{input.value='PDF_MARKER_2050_END';input.dispatchEvent(new Event('input',{bubbles:true}));button.click();},25);
  });
  await expect(preview.locator('#pdf-found')).toHaveText('1/1 页',{timeout:20000});await expect(preview.locator('#pdf-page')).toHaveValue('2050');await expect(preview.locator('.pdf-sheet[data-page="2050"] .pdf-hit')).toContainText('PDF_MARKER_2050_END');
  await preview.waitForTimeout(400);await expect(preview.locator('#pdf-found')).toHaveText('1/1 页');
  const selected=await preview.locator('.pdf-sheet[data-page="2050"] .textLayer').evaluate(layer=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(layer);selection.removeAllRanges();selection.addRange(range);return String(selection);});assert.match(selected,/PDF_MARKER_2050_END/);
  await start('PDF_MARKER_');await preview.locator('#pdf-search').fill('');await preview.waitForTimeout(350);await expect(preview.locator('#pdf-found')).toBeEmpty();await expect(preview.locator('#pdf-find')).toHaveText('查找');await expect(preview.locator('.pdf-hit')).toHaveCount(0);
  await start('PDF_MARKER_');await expect(preview.locator('#pdf-found')).toHaveText('1/2050 页',{timeout:20000});await expect(preview.locator('#pdf-page')).toHaveValue('1');await preview.locator('#pdf-search').press('Enter');await expect(preview.locator('#pdf-found')).toHaveText('2/2050 页');await expect(preview.locator('#pdf-page')).toHaveValue('2');
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'80-images.pdf'));await expect(preview.locator('.pdf-sheet')).toHaveCount(80);await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/);
  await preview.locator('#side-overview').click();await expect.poll(()=>preview.locator('.preview-overview-card').count()).toBeGreaterThan(0);assert.ok(await preview.locator('.preview-overview-card').count()<30);await expect(preview.locator('.overview-thumbnail canvas').first()).toBeVisible();
  await preview.locator('#preview-overview').evaluate(host=>host.scrollTop=host.scrollHeight);const last=preview.locator('.preview-overview-card[data-page="79"]');await expect(last).toBeVisible();await expect(last.locator('canvas')).toBeVisible();await last.click();await expect(preview.locator('#pdf-page')).toHaveValue('80');await expect(preview.locator('.pdf-sheet[data-page="80"]')).toHaveClass(/is-rendered/);
  await preview.evaluate(()=>{document.querySelector('#pdf-plus').click();document.querySelector('#pdf-minus').click();document.querySelector('#pdf-rotate').click();document.querySelector('#pdf-rotate').click();document.querySelector('#pdf-rotate').click();document.querySelector('#pdf-rotate').click();});
  await expect(preview.locator('.pdf-sheet[data-page="80"]')).toHaveClass(/is-rendered/,{timeout:10000});await expect(preview.locator('.pdf-sheet[data-page="80"] .textLayer')).toContainText('PDF_MARKER_80_END');
  const pixels=await preview.locator('.pdf-sheet[data-page="80"] canvas').evaluate(canvas=>({width:canvas.width,height:canvas.height,rgb:[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]}));assert.ok(pixels.width>300&&pixels.height>400);assert.ok(pixels.rgb.slice(0,3).some(value=>value<200));
  await preview.locator('#pdf-page').evaluate(input=>{input.value='1';input.dispatchEvent(new Event('change',{bubbles:true}));});await expect(preview.locator('.pdf-sheet[data-page="1"] .textLayer')).toContainText('PDF_MARKER_1_END');
  await preview.screenshot({path:path.join(output,'image-pdf.png')});
  await preview.evaluate(file=>window.one.selectPreview(file),path.join(files,'2050-pages.pdf'));await expect(preview.locator('.pdf-sheet')).toHaveCount(2050);await start('PDF_MARKER_');await preview.locator('#preview-close').click();await expect.poll(()=>preview.isClosed()).toBe(true);await main.waitForTimeout(350);
  assert.deepEqual(errors,[]);const result={result:'PASS',cancelMs,latestQuery:true,clearQuery:true,cycleMatches:2050,textSelection:true,thumbnails:true,rapidLayout:true,pixels,closeDuringSearch:true,errors};await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){for(const page of app.windows())if(!page.isClosed())await page.screenshot({path:path.join(output,page.url().includes('preview')?'failure-preview.png':'failure-main.png')}).catch(()=>{});throw error;}finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
