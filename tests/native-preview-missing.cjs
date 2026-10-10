const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),JSZip=require('jszip'),{_electron:electron,expect}=require('@playwright/test');
(async()=>{
 const dir=path.resolve('work/current/native-preview/missing');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'日常 表格.xlsx'),z=new JSZip();
 z.file('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="日常" sheetId="1" r:id="r1"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');z.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>日常表格</t></is></c></row></sheetData></worksheet>');await fs.writeFile(file,await z.generateAsync({type:'nodebuffer'}));
 execFileSync(process.execPath,['scripts/build-preview.mjs'],{env:{...process.env,ONE_PREVIEW_BUILD_TEST:'missing'},windowsHide:true,stdio:'pipe'});
 const profile=await fs.mkdtemp(path.join(dir,'profile-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_TEST_NATIVE_PREVIEW_HOST:path.resolve('work/current/native-preview/build/One.Preview.Missing.exe')};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');await app.evaluate(({app})=>app.on('browser-window-created',(_e,w)=>setImmediate(()=>w.removeAllListeners('blur'))));
  const opening=app.waitForEvent('window');await main.evaluate(f=>window.one.preview(f),file);const preview=await opening;
  await expect(preview.locator('#native-preview-open')).toBeVisible({timeout:30000});await expect(preview.locator('.preview-error-detail')).toContainText('未找到可用');assert.equal(await preview.locator('.sheet-table').count(),0);
  await preview.locator('#native-preview-retry').click();await expect(preview.locator('.preview-error-detail')).toContainText('未找到可用');
  await app.evaluate(({ipcMain})=>{globalThis.nativePreviewOpened=[];ipcMain.removeHandler('one:open-file');ipcMain.handle('one:open-file',(_e,file)=>globalThis.nativePreviewOpened.push(file));});
  await preview.locator('#native-preview-open').click();assert.deepEqual(await app.evaluate(()=>globalThis.nativePreviewOpened),[file]);
  const screenshot=path.join(dir,'missing-component.png');await preview.screenshot({path:screenshot});await preview.close();await fs.rename(file,file+'.moved');await fs.rename(file+'.moved',file);
  const report={checks:6,simulatedComponent:'missing',screenshot,scope:'Dedicated missing-component test build, independent of installed Office; default-open dispatch intercepted'};await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log('Missing-component UI: 6 checks passed (simulated missing handler).');
 }finally{await app.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
