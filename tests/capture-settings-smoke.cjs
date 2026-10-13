const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

(async()=>{
  const output=path.resolve('work/current/capture-migration/capture-settings');
  await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-'));
  await fs.writeFile(path.join(profile,'.owned-capture-settings'),'capture-settings-smoke');
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;const errors=[];
  const launch=async()=>{
    app=await electron.launch({args:[path.resolve('.')],env});
    app.on('window',page=>page.on('pageerror',e=>errors.push(String(e))));
    const page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);
    await page.locator('.nav[data-page=settings]').click();
    await page.locator('[data-settings-tab=capture]').click();
    await expect(page.locator('.workflow-name')).toHaveValue('复制图片');
    return page;
  };
  const select=async(page,selector,name)=>{await page.locator(selector).click();await page.getByRole('option',{name,exact:true}).click();};
  try{
    let page=await launch();
    const defaults=await page.evaluate(()=>window.one.settings());
    assert.equal(await page.locator('[data-settings-tab=capture] svg').getAttribute('data-lucide-icon'),'capture');
    await select(page,'#capture-pref-scale','125%');
    await page.locator('#capture-pref-remote').uncheck();
    await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).capture.remoteCompatible)).toBe(false);
    await page.locator('.workflow-add').click();
    await expect(page.locator('.workflow-name')).toHaveValue('新流程');
    await page.locator('.workflow-name').fill('校对并归档');await page.locator('.workflow-name').press('Tab');
    await page.locator('[data-add-action=save]').click();
    await page.locator('[data-add-action=translate]').click();
    await select(page,'.workflow-translation-target','英文');
    await page.locator('.workflow-action-order li').last().getByRole('button',{name:/上移$/}).click();
    await page.locator('.workflow-make-default').click();
    await page.locator('.output-effect-panel summary').click();
    await page.locator('[data-effect=radius]').fill('24');await page.locator('[data-effect=radius]').press('Tab');
    await expect(page.locator('.workflow-feedback')).toHaveText('流程已保存');
    assert.equal(await page.locator('.settings-workflow-editor').evaluate(el=>getComputedStyle(el).paddingTop),'16px');
    const chosen=await page.evaluate(async()=>{const s=(await window.one.settings()).capture;return s.workflows.find(w=>w.id===s.workflowId);});
    assert.equal(chosen.name,'校对并归档');assert.deepEqual(chosen.actions,['copy','translate','save']);
    assert.equal(chosen.translationTarget,'en');assert.equal(chosen.effects.radius,24);
    await select(page,'.workflow-select','复制图片');
    await expect(page.locator('.workflow-name')).toHaveValue('复制图片');
    await select(page,'.workflow-select','校对并归档');
    await expect(page.locator('[data-effect=radius]')).toHaveValue('24');
    // Real custom-capture dialog persists through the same One settings writer.
    await page.locator('#capture-pref-custom').click();
    await expect(page.locator('#custom-capture-dialog')).toBeVisible();
    await page.locator('#use-delay').check();await page.locator('#cd').fill('3');
    await page.locator('#custom-save').click();await expect(page.locator('#custom-capture-dialog')).toHaveCount(0);
    await expect.poll(()=>page.evaluate(async()=>(await window.one.settings()).capture.custom.delay)).toBe(3);
    // A real filesystem write failure must not claim success or corrupt persisted state.
    const temporary=path.join(profile,'settings.json.tmp');await fs.mkdir(temporary);
    await page.locator('#capture-pref-remote').click();
    await expect(page.locator('#capture-pref-message')).not.toHaveText('');
    await expect(page.locator('#capture-pref-remote')).not.toBeChecked();
    assert.equal((await page.evaluate(()=>window.one.settings())).capture.remoteCompatible,false);
    await page.locator('.workflow-name').fill('未保存的流程');await page.locator('.workflow-name').press('Tab');
    await expect(page.locator('.workflow-feedback')).toContainText('保存失败');
    assert.equal((await page.evaluate(()=>window.one.settings())).capture.workflows.find(w=>w.id===chosen.id).name,'校对并归档');
    await fs.rmdir(temporary);
    await page.locator('.workflow-name').fill('校对并归档');await page.locator('.workflow-name').press('Tab');
    await expect(page.locator('.workflow-feedback')).toHaveText('流程已保存');
    // Seed real material data and separate recovery/credential files; reset must only change preferences.
    const original=path.join(profile,'source.png');
    await app.evaluate(async({nativeImage,dialog},file)=>{
      await process.getBuiltinModule('fs/promises').writeFile(file,nativeImage.createFromBitmap(Buffer.alloc(40*30*4,255),{width:40,height:30}).toPNG());
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    },original);
    await page.evaluate(()=>window.one.materialsImportImages());
    const materialsBefore=await page.evaluate(()=>window.one.materialsState());
    assert.equal(materialsBefore.images.length,1);
    const protectedFiles=['drafts/recovery-evidence.txt','pins/reset-evidence.txt','recognition/credential-evidence.txt'];
    for(const file of protectedFiles){await fs.mkdir(path.dirname(path.join(profile,file)),{recursive:true});await fs.writeFile(path.join(profile,file),'preserve-'+file);}
    // Export must include a settings write accepted before the backup request, even if disk writes are slow.
    const racingBackup=path.join(output,'pending-save-backup.json');
    await app.evaluate(({dialog},file)=>{
      const fs=process.getBuiltinModule('fs/promises');globalThis.originalSettingsWrite=fs.writeFile;
      fs.writeFile=async function(target,...args){if(String(target).endsWith('settings.json.tmp'))await new Promise(resolve=>setTimeout(resolve,120));return globalThis.originalSettingsWrite.call(this,target,...args);};
      dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
    },racingBackup);
    await page.evaluate(()=>{
      const name=document.querySelector('.workflow-name');name.value='连续修改后的流程';name.dispatchEvent(new Event('change',{bubbles:true}));
      return Promise.all([window.one.patchSettings({capture:{uiScale:110}}),window.one.settingsBackupExport()]);
    });
    await app.evaluate(()=>{process.getBuiltinModule('fs/promises').writeFile=globalThis.originalSettingsWrite;delete globalThis.originalSettingsWrite;});
    assert.equal(JSON.parse(await fs.readFile(racingBackup,'utf8')).settings.capture.uiScale,110,'backup must wait for accepted settings writes');
    assert.equal(JSON.parse(await fs.readFile(racingBackup,'utf8')).settings.capture.workflows.find(w=>w.id===chosen.id).name,'连续修改后的流程');
    await page.locator('.workflow-name').fill('校对并归档');await page.locator('.workflow-name').press('Tab');
    await expect(page.locator('.workflow-feedback')).toHaveText('流程已保存');
    await page.evaluate(()=>window.one.patchSettings({capture:{uiScale:125}}));
    await page.evaluate(()=>window.one.patchSettings({appearance:{mode:'light'},general:{closeToTray:false},capture:{watermark:{text:'One settings test'}}}));
    const backup=path.join(output,'settings.json');
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backup);
    await page.evaluate(()=>window.one.settingsBackupExport());
    const saved=JSON.parse(await fs.readFile(backup,'utf8')).settings;
    assert.equal(saved.capture.uiScale,125);assert.equal(saved.capture.custom.delay,3);
    assert.equal(JSON.stringify(saved).includes('credential-evidence'),false);
    await page.locator('.output-effect-panel summary').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,900));
    await page.locator('.capture-settings').evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:path.join(output,'settings-light.png'),scale:'css'});
    await page.locator('#capture-pref-reset').click();
    await page.locator('dialog[open] [data-dialog-dismiss]').last().click();
    assert.deepEqual((await page.evaluate(()=>window.one.settings())).capture,saved.capture);
    await page.locator('#capture-pref-reset').click();
    await page.locator('dialog[open] [data-dialog-confirm]').click();
    await expect(page.locator('#capture-pref-message')).toHaveText('已恢复默认设置。');
    const reset=await page.evaluate(()=>window.one.settings());
    assert.deepEqual(reset.capture,defaults.capture);
    assert.equal(reset.general.closeToTray,false);assert.equal(reset.appearance.mode,'light');
    const materialsAfter=await page.evaluate(()=>window.one.materialsState());
    const metadata=state=>state.images.map(({thumbnail,...image})=>image);
    assert.deepEqual(metadata(materialsAfter),metadata(materialsBefore));
    for(const file of protectedFiles)assert.equal(await fs.readFile(path.join(profile,file),'utf8'),'preserve-'+file);
    await expect(page.locator('.workflow-name')).toHaveValue('复制图片');
    await expect(page.locator('#capture-pref-scale')).toHaveText('100%');
    // Use the actual backup button; mounted controls must refresh immediately after import.
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backup);
    await page.locator('[data-settings-tab=backup]').click();
    await page.locator('#settings-backup-import').click();await expect(page.locator('#backup-message')).toContainText('设置已导入');
    await page.locator('[data-settings-tab=capture]').click();
    await expect(page.locator('#capture-pref-scale')).toHaveText('125%');
    assert.deepEqual((await page.evaluate(()=>window.one.settings())).capture,saved.capture);
    await select(page,'.workflow-select','校对并归档');
    await expect(page.locator('.workflow-name')).toHaveValue('校对并归档');
    await page.locator('.nav[data-page=materials]').click();
    await expect(page.locator('.materials-page')).toHaveAttribute('data-capture-scale','125');
    await page.locator('.nav[data-page=settings]').click();
    for(let i=0;i<3;i++){await page.locator('[data-settings-tab=general]').click();await page.locator('[data-settings-tab=capture]').click();}
    await expect(page.locator('.settings-workflow-editor')).toHaveCount(1);
    await page.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'}}));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(850,740));
    await expect.poll(()=>page.locator('.capture-settings').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.locator('.workflow-editor-bar').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'settings-dark-narrow.png'),scale:'css'});
    await page.locator('.output-effect-panel summary').click();
    await page.locator('.output-effect-fields').scrollIntoViewIfNeeded();
    const effectLayout=await page.locator('.output-effect-fields').evaluate(root=>[...root.querySelectorAll(':scope>label')].filter(row=>row.getClientRects().length).map(row=>{
      const control=row.lastElementChild.getBoundingClientRect(),bounds=row.getBoundingClientRect();
      return {label:row.textContent.trim(),aligned:Math.abs(control.right-bounds.right)<2,inside:control.left>=bounds.left&&control.right<=bounds.right+1};
    }));
    assert.ok(effectLayout.every(row=>row.aligned&&row.inside),JSON.stringify(effectLayout));
    await page.screenshot({path:path.join(output,'settings-effects-dark.png'),scale:'css'});
    await app.close();app=undefined;
    // Reopen with the persisted custom workflow and verify the controls, not just stored JSON.
    app=await electron.launch({args:[path.resolve('.')],env});
    page=await app.firstWindow();await page.locator('.nav[data-page=settings]').click();await page.locator('[data-settings-tab=capture]').click();
    await expect(page.locator('.workflow-name')).toHaveValue('校对并归档');
    await expect(page.locator('#capture-pref-scale')).toHaveText('125%');
    await expect(page.locator('#capture-pref-remote')).not.toBeChecked();
    assert.deepEqual((await page.evaluate(()=>window.one.settings())).capture,saved.capture);
    assert.deepEqual(errors,[]);
    const result={result:'PASS',workflowEditOrderLanguageEffects:true,customCapture:true,failedWriteAndRetry:true,
      resetCancelAndPreserveData:true,backupWaitsForAcceptedWrites:true,backupRefresh:true,restartControls:true,repeatedActivation:true,narrowLayout:true,effectLayout,errors};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{
    if(app)await app.close();
    const real=await fs.realpath(profile),parent=await fs.realpath(output);
    assert.equal(path.dirname(real).toLowerCase(),parent.toLowerCase());
    assert.equal(await fs.readFile(path.join(real,'.owned-capture-settings'),'utf8'),'capture-settings-smoke');
    await fs.rm(real,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
