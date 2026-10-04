const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createPDF}=require('./pdf-scroll-fixtures.cjs');

async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/pdf-body-virtual');await fs.mkdir(output,{recursive:true});
 const file=path.join(output,'mixed-pages.pdf'),sizes=[[612,792],[792,612],[420,1000],[1000,420]];
 if(!await fs.stat(file).catch(()=>null))await createPDF(file,120,0,sizes);
 const longFile=path.join(output,'12000-pages.pdf');if(!await fs.stat(longFile).catch(()=>null))await createPDF(longFile,12000);
 const profile=await fs.mkdtemp(path.join(output,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await main.evaluate(()=>window.one.patchSettings({preview:{held:true,files:false}}));
  const opening=app.waitForEvent('window',{predicate:page=>page.url().includes('view=preview')});await main.evaluate(file=>window.one.preview(file),file);const preview=await opening;
  await expect(preview.locator('#pdf-total')).toHaveText('/ 120');await expect(preview.locator('.pdf-sheet[data-page="1"]')).toHaveClass(/is-rendered/);
  for(const n of [2,3,4,87,120,1]){
   await preview.locator('#pdf-page').evaluate((input,n)=>{input.value=String(n);input.dispatchEvent(new Event('change',{bubbles:true}));},n);
   const sheet=preview.locator(`.pdf-sheet[data-page="${n}"]`);await expect(sheet).toHaveClass(/is-rendered/);
   await expect(sheet.locator('.textLayer')).toContainText(`PDF_MARKER_${n}_END`);
   const bounds=await sheet.evaluate(sheet=>{const root=document.querySelector('.pdf-scroll').getBoundingClientRect(),rect=sheet.getBoundingClientRect();return{top:rect.top-root.top,width:rect.width,height:rect.height};});
   assert.ok(bounds.top>=-2&&bounds.top<70,JSON.stringify({n,bounds}));
   assert.ok(Math.abs(bounds.width/bounds.height-sizes[(n-1)%4][0]/sizes[(n-1)%4][1])<.02,JSON.stringify({n,bounds}));
   if(n===4){const horizontal=await preview.locator('.pdf-scroll').evaluate(root=>{const max=root.scrollWidth-root.clientWidth;root.scrollLeft=max;return{max,left:root.scrollLeft};});assert.ok(horizontal.max>0&&Math.abs(horizontal.left-horizontal.max)<2,JSON.stringify(horizontal));}
   assert.ok(await preview.locator('.pdf-sheet').count()<30);
  }
  await preview.locator('#pdf-plus').click();await expect(preview.locator('.pdf-sheet[data-page="1"] canvas')).toBeVisible();
  await preview.locator('#pdf-rotate').click();await expect(preview.locator('.pdf-sheet[data-page="1"] canvas')).toBeVisible();
  await preview.locator('.pdf-scroll').evaluate(root=>root.scrollTop=root.scrollHeight);
  await expect(preview.locator('#pdf-page')).toHaveValue('120');await expect(preview.locator('.pdf-sheet[data-page="120"]')).toHaveClass(/is-rendered/);
  await preview.evaluate(file=>window.one.selectPreview(file),longFile);await expect(preview.locator('#pdf-total')).toHaveText('/ 12000',{timeout:30000});
  await preview.locator('.pdf-scroll').evaluate(root=>root.scrollTop=root.scrollHeight);
  await expect(preview.locator('#pdf-page')).toHaveValue('12000');await expect(preview.locator('.pdf-sheet[data-page="12000"]')).toHaveClass(/is-rendered/);
  assert.ok(await preview.locator('.pdf-sheet').count()<30);assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',mixedPages:120,longPages:12000,mixedSizes:true,jumpAndReturn:true,zoomAndRotation:true,scrollToEnd:true,errors}));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
