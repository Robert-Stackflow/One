const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'materials-page-'));let app;const errors=[];
  try{
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);
    const first=path.join(profile,'first.png'),second=path.join(profile,'second.png'),exported=path.join(profile,'export.png');
    await app.evaluate(async({BrowserWindow,dialog,nativeImage,clipboard,shell},{first,second,exported})=>{
      const png=nativeImage.createFromBitmap(Buffer.alloc(640*400*4,255),{width:640,height:400}).toPNG();
      const fs=process.getBuiltinModule('fs/promises');await fs.writeFile(first,png);await fs.writeFile(second,png);
      global.materialPNG=png;global.openFiles=[];global.openCount=0;global.copies=[];global.directories=[];
      dialog.showOpenDialog=async()=>{global.openCount++;return{canceled:!global.openFiles.length,filePaths:global.openFiles};};
      dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});
      clipboard.write=async items=>{for(const item of items)global.copies.push(Buffer.from(await(await item.getType('image/png')).arrayBuffer()));};
      shell.openPath=async directory=>{global.directories.push(directory);return '';};
      BrowserWindow.getAllWindows()[0].setSize(1120,800);
    },{first,second,exported});
    const nav=main.locator('.nav[data-page=materials]'),cards=main.locator('#material-results .asset-card');
    await nav.click();await expect(main.locator('#page-name')).toHaveText('素材');
    await expect(main.locator('#material-results')).toContainText('还没有图片');
    const importButton=main.getByRole('button',{name:'导入图片',exact:true});
    await importButton.click();await expect(importButton).toBeEnabled();assert.equal(await app.evaluate(()=>global.openCount),1);await expect(cards).toHaveCount(0);
    await app.evaluate((_e,file)=>{global.openFiles=[file];},first);
    await importButton.evaluate(button=>{button.click();button.click();});await expect(cards).toHaveCount(1);await expect(importButton).toBeEnabled();assert.equal(await app.evaluate(()=>global.openCount),2);
    await expect(main.locator('#material-images small')).toHaveText('1');
    await expect(main.locator('.asset-preview img')).toHaveJSProperty('naturalWidth',240);
    await main.getByRole('button',{name:'复制图片',exact:true}).click();await expect.poll(()=>app.evaluate(()=>global.copies.length)).toBe(1);
    assert.equal(await app.evaluate(()=>global.copies[0].equals(global.materialPNG)),true);
    await main.getByRole('button',{name:'导出图片',exact:true}).click();await expect.poll(()=>fs.stat(exported).then(info=>info.size).catch(()=>0)).toBeGreaterThan(0);
    assert.deepEqual(await fs.readFile(exported),await fs.readFile(first));
    await main.getByRole('button',{name:'素材目录',exact:true}).click();await expect.poll(()=>app.evaluate(()=>global.directories.length)).toBe(1);
    await main.getByRole('button',{name:'编辑 first.png',exact:true}).click();
    let editor;await expect.poll(()=>{editor=app.windows().find(page=>page.url().includes('view=image-editor'));return !!editor;}).toBe(true);
    await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');
    await main.getByRole('button',{name:'删除素材',exact:true}).click();await expect(main.locator('#toast')).toContainText('请先关闭当前图片编辑');await expect(cards).toHaveCount(1);
    await Promise.all([editor.waitForEvent('close'),editor.getByRole('button',{name:'关闭',exact:true}).click()]);
    const search=main.getByRole('searchbox',{name:'搜索素材',exact:true});
    await search.fill('FIRST');await expect(cards).toHaveCount(1);await search.fill('不存在');await expect(cards).toHaveCount(0);await expect(main.locator('#material-results')).toContainText('没有匹配的素材');
    await search.fill('first');await main.locator('.nav[data-page=home]').click();
    await app.evaluate((_e,file)=>{global.openFiles=[file];},second);
    await main.evaluate(()=>new Promise((resolve,reject)=>{const stop=window.one.onMaterialsChanged(()=>{stop();resolve();});window.one.materialsImportImages().catch(error=>{stop();reject(error);});}));
    await expect(cards).toHaveCount(1);await nav.click();await expect(search).toHaveValue('first');await expect(main.locator('#material-images small')).toHaveText('2');await expect(cards).toHaveCount(1);
    await main.locator('.materials-page .search-clear').click();await expect(cards).toHaveCount(2);await expect(search).toBeFocused();
    await main.getByRole('tab',{name:/^图片/}).focus();await main.keyboard.press('ArrowRight');await expect(main.getByRole('tab',{name:/^录制/})).toHaveAttribute('aria-selected','true');await expect(main.locator('#material-results')).toContainText('还没有录制');
    await main.getByRole('tab',{name:/^图片/}).click();await expect(cards).toHaveCount(2);
    await main.evaluate(async()=>{await window.one.patchSettings({capture:{uiScale:150}});});
    await expect(main.locator('.materials-page')).toHaveAttribute('data-capture-scale','150');await expect(main.locator('#materials-heading-actions')).toHaveAttribute('data-capture-scale','150');
    const overflow=await main.locator('.materials-page').evaluate(page=>page.scrollWidth>page.clientWidth+1);assert.equal(overflow,false);
    await main.evaluate(async()=>{await window.one.patchSettings({capture:{uiScale:100}});});
    await expect(main.locator('.materials-page')).toHaveAttribute('data-capture-scale','100');
    await main.screenshot({path:path.join(root,'materials-page.png'),scale:'css'});
    await main.evaluate(async()=>{await window.one.patchSettings({capture:{uiScale:150},appearance:{mode:'dark'}});});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(850,700));
    await expect(main.locator('.materials-page')).toHaveAttribute('data-capture-scale','150');
    assert.equal(await main.locator('.materials-page').evaluate(page=>page.scrollWidth>page.clientWidth+1),false);
    await main.screenshot({path:path.join(root,'materials-page-dark-narrow.png'),scale:'css'});
    await app.evaluate((_e,file)=>{global.openFiles=[file];},path.join(profile,'missing.png'));
    await importButton.click();await expect(main.locator('#toast')).toContainText('文件不存在');await expect(importButton).toBeEnabled();await expect(cards).toHaveCount(2);
    await main.getByRole('button',{name:'删除素材',exact:true}).first().click();await expect(cards).toHaveCount(1);await expect(main.locator('#material-images small')).toHaveText('1');
    for(let i=0;i<3;i++){await main.locator('.nav[data-page=home]').click();await nav.click();}
    await expect(main.locator('.materials-page')).toHaveCount(1);await expect(main.locator('#materials-heading-actions [data-material-action]')).toHaveCount(3);await expect(cards).toHaveCount(1);
    await expect(main.locator('.materials-error')).toBeHidden();assert.deepEqual(errors,[]);
    console.log('Materials page: native navigation, import/cancel/deduplication, search/tabs, image editor, active-edit deletion guard, copy/export/directory, live scale and inactive/reactivated state passed.');
  }finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    const actual=await fs.realpath(profile),base=await fs.realpath(root);assert(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith('materials-page-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
