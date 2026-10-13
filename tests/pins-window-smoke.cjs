const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const koffi=require('koffi'),user32=koffi.load('user32.dll'),dwm=koffi.load('dwmapi.dll');
const windowStyle=user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t, int)');
const windowAttribute=dwm.func('long __stdcall DwmGetWindowAttribute(intptr_t, uint32_t, void *, uint32_t)');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'pins-window-'));let app;const errors=[];
  const start=async()=>{const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_TRAY_MENU:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));const page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);return page;};
  try{
    let main=await start();const source=path.join(profile,'sample.png'),textFile=path.join(profile,'document.txt'),exported=path.join(profile,'original.png');
    await app.evaluate(async({dialog,nativeImage,clipboard,BrowserWindow},{source,textFile,exported})=>{
      const fs=process.getBuiltinModule('fs/promises'),png=nativeImage.createFromBitmap(Buffer.alloc(400*240*4,255),{width:400,height:240}).toPNG();
      await fs.writeFile(source,png);await fs.writeFile(textFile,'File pin reference');global.pinOriginal=png;global.pinCopies=[];global.pinFiles=[source];
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:global.pinFiles});dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});
      clipboard.write=async items=>{for(const item of items)global.pinCopies.push(Buffer.from(await(await item.getType('image/png')).arrayBuffer()));};
      clipboard.read=async()=>[];clipboard.readText=async()=>'One 文字贴图\n第二行';
      // Keep this isolated test independent of the user's real CF_HDROP clipboard.
      const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),koffi=require('koffi'),load=koffi.load;
      koffi.load=function(file,...args){const library=load.call(this,file,...args);if(file!=='user32.dll')return library;return{func(...args){if(String(args[0]).includes('IsClipboardFormatAvailable'))return()=>false;return library.func(...args);}};};
      BrowserWindow.getAllWindows()[0].setSize(1120,820);
    },{source,textFile,exported});
    await main.locator('.nav[data-page=materials]').click();await main.getByRole('button',{name:'导入图片',exact:true}).click();
    await expect(main.getByRole('button',{name:'贴出图片',exact:true})).toBeEnabled();await main.getByRole('button',{name:'贴出图片',exact:true}).click();
    let pin;await expect.poll(()=>{pin=app.windows().find(page=>page.url().endsWith('?view=pin'));return!!pin;}).toBe(true);
    await pin.waitForFunction(()=>document.body.dataset.pinReady==='true'||!!document.body.dataset.pinError);
    assert.equal(await pin.evaluate(()=>document.body.dataset.pinError||''),'');await expect(pin.locator('#pin-content img')).toHaveJSProperty('naturalWidth',400);
    const original=await pin.evaluate(()=>window.one.pin.state()),id=original.record.id,imageURL=original.image;
    const native=await app.evaluate(({BrowserWindow})=>{
      const windows=BrowserWindow.getAllWindows(),pin=windows.find(window=>window.webContents.getURL().endsWith('?view=pin')),
        main=windows.find(window=>window.webContents.getURL().endsWith('?view=main'));
      return{pin:Number(pin.getNativeWindowHandle().readBigUInt64LE()),main:Number(main.getNativeWindowHandle().readBigUInt64LE()),shadow:pin.hasShadow(),background:pin.getBackgroundColor()};
    });
    assert.equal(native.shadow,true);assert.notEqual(native.background,'#00000000');
    assert.equal(windowStyle(native.pin,-16)&0x00c00000,windowStyle(native.main,-16)&0x00c00000,'image pin must retain the same native caption/border style as the main window');
    assert.notEqual(windowStyle(native.pin,-16)&0x00c00000,0);
    const rendering=Buffer.alloc(4);assert.equal(windowAttribute(native.pin,1,rendering,4),0);
    assert.equal(rendering.readInt32LE(0),1,'DWM must render the native non-client border');
    assert.equal(await pin.evaluate(()=>typeof window.one.pinsState),'undefined');
    assert.equal(await main.evaluate(async url=>{try{return(await fetch(url)).ok;}catch{return false;}},imageURL),false);
    await main.getByRole('button',{name:'删除素材',exact:true}).click();await expect(main.locator('#material-results .asset-card')).toHaveCount(0);
    const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=pin')).getContentBounds());assert.equal(bounds.width,400);assert.equal(bounds.height,240);
    await pin.locator('#pin-content').click({button:'right',position:{x:100,y:100}});
    let controls;await expect.poll(()=>{controls=app.windows().find(page=>page.url().endsWith('?view=pin-controls'));return!!controls;}).toBe(true);await controls.waitForFunction(()=>document.body.dataset.pinReady==='true');
    await controls.getByRole('button',{name:'旋转',exact:true}).click();await expect.poll(()=>main.evaluate(async id=>(await window.one.pinsState()).pins.find(p=>p.id===id).view.rotation,id)).toBe(1);
    await controls.getByRole('button',{name:'水平镜像',exact:true}).click();await expect(controls.getByRole('button',{name:'水平镜像',exact:true})).toHaveAttribute('aria-pressed','true');
    await controls.locator('#pin-opacity').fill('65');await controls.locator('#pin-opacity').press('Tab');await expect.poll(()=>main.evaluate(async id=>(await window.one.pinsState()).pins.find(p=>p.id===id).view.opacity,id)).toBe(.65);
    await controls.screenshot({path:path.join(root,'pin-controls.png'),scale:'css'});
    await controls.getByRole('button',{name:/复制原内容/}).click();await expect.poll(()=>app.evaluate(()=>global.pinCopies.length)).toBe(1);assert.equal(await app.evaluate(()=>global.pinCopies[0].equals(global.pinOriginal)),true);
    await controls.getByRole('button',{name:'保存原内容',exact:true}).click();await expect.poll(()=>fs.stat(exported).then(s=>s.size).catch(()=>0)).toBeGreaterThan(0);assert.deepEqual(await fs.readFile(exported),await fs.readFile(source));
    // This action immediately hides the native panel; dispatch its click without waiting for a mouse-up in that hidden window.
    await controls.getByRole('button',{name:'开启鼠标穿透',exact:true}).dispatchEvent('click');await expect.poll(()=>main.evaluate(async id=>(await window.one.pinsState()).pins.find(p=>p.id===id).view.passThrough,id)).toBe(true);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=pin-controls')).isVisible()),false);
    await main.locator('.nav[data-page=pins]').click();await expect(main.locator('#page-pins .pin-card')).toHaveCount(1);
    await main.locator('[data-pin-menu=pins-manage-menu]').click();await main.locator('#pins-restore-group').click();await expect.poll(()=>main.evaluate(async id=>(await window.one.pinsState()).pins.find(p=>p.id===id).view.passThrough,id)).toBe(false);
    const trayAction=async action=>{
      await app.evaluate(()=>globalThis.oneTestTrayMenu.open({x:150,y:150,width:24,height:24}));
      const rootId=await app.evaluate(()=>globalThis.oneTestTrayMenu.window.webContents.id);
      let tray;await expect.poll(async()=>{for(const page of app.windows())if(!page.isClosed()&&page.url().includes('view=tray-menu')&&await (await app.browserWindow(page)).evaluate(w=>w.webContents.id)===rootId){tray=page;return true;}return false;}).toBe(true);
      if(!await tray.locator('[data-action='+action+']').count()){const parent=tray;await parent.locator('.tray-menu-heading').hover();await parent.locator('[data-action=more]').hover();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.moreWindow?.isVisible()??false)).toBe(true);await expect.poll(async()=>{for(const page of app.windows())if(page!==parent&&!page.isClosed()&&page.url().includes('view=tray-menu')&&await page.locator('body').evaluate(e=>e.classList.contains('tray-submenu-window'))){tray=page;return true;}return false;}).toBe(true);}
      const button=tray.locator('[data-action='+action+']');await expect(button).toBeVisible();
      assert.equal(await tray.locator('#tray-menu-items').evaluate(menu=>menu.scrollHeight>menu.clientHeight+1),false);
      await button.click();await expect.poll(()=>app.evaluate(()=>globalThis.oneTestTrayMenu.window?.isVisible()??false)).toBe(false);
    };
    await main.evaluate(id=>window.one.pinsAction(id,{kind:'pass',value:true}),id);await trayAction('pins-restore');assert.equal((await main.evaluate(()=>window.one.pinsState())).pins[0].view.passThrough,false);
    await main.locator('[data-pin-menu=pins-manage-menu]').click();await main.locator('#pins-new-group').click();await main.locator('#pin-name').fill('参考图');await main.getByRole('button',{name:'保存',exact:true}).click();await expect(main.locator('#pin-name-dialog')).toHaveCount(0);
    const group=(await main.evaluate(()=>window.one.pinsState())).groups[0];assert.equal(group.name,'参考图');
    await main.locator('[data-select-pin]').check();await main.locator('#pins-batch-group').click();await main.getByRole('option',{name:'参考图',exact:true}).click();
    await expect.poll(()=>main.evaluate(async id=>(await window.one.pinsState()).pins.find(p=>p.id===id).group,id)).toBe(group.id);
    await main.locator('#page-pins .pin-card').hover();await main.locator('[data-pin-action=controls]').click();
    const previousControls=controls;await expect.poll(()=>{const next=app.windows().find(page=>page!==previousControls&&page.url().endsWith('?view=pin-controls'));if(next)controls=next;return controls!==previousControls;}).toBe(true);
    await expect(controls.locator('#pin-group')).toContainText('参考图');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=pin-controls')).close());
    await main.locator('#pins-search').fill('不存在');await expect(main.locator('#page-pins .pin-card')).toHaveCount(0);await main.locator('.pins-page .search-clear').click();await expect(main.locator('#page-pins .pin-card')).toHaveCount(1);
    await main.locator('#pins-clipboard-add').click();await expect(main.locator('#page-pins .pin-card')).toHaveCount(2);
    await app.evaluate((_e,file)=>{global.pinFiles=[file];},textFile);await main.locator('#pins-file-add').click();await expect(main.locator('#page-pins .pin-card')).toHaveCount(3);
    const state=await main.evaluate(()=>window.one.pinsState());assert.equal(state.format,'one-pin-workspace');assert.deepEqual(state.pins.map(p=>p.content.kind).sort(),['files','image','text']);
    await trayAction('pins-next-group');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.filter(p=>p.view.visible).length)).toBe(2);
    await trayAction('pins-next-group');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.filter(p=>p.view.visible).length)).toBe(1);
    await main.evaluate(()=>window.one.pinsGroup(null,{kind:'show'}));
    await main.locator('[data-pin-menu=pins-manage-menu]').click();await main.locator('#pins-toggle-all').click();await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.filter(p=>p.view.visible).length)).toBe(0);
    await main.locator('[data-pin-menu=pins-manage-menu]').click();await main.locator('#pins-toggle-all').click();await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.filter(p=>p.view.visible).length)).toBe(3);
    await main.evaluate(async()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(main.locator('#page-pins')).toHaveAttribute('data-capture-scale','150');
    const geometry=await main.locator('#page-pins').evaluate(page=>({width:page.clientWidth,scroll:page.scrollWidth,overflow:[...page.querySelectorAll('.pins-selection,.pins-selection>* ,.pins-selection .actions>*')].map(node=>({tag:node.tagName,id:node.id,class:node.className,width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right,scroll:node.scrollWidth,client:node.clientWidth,css:getComputedStyle(node).cssText}))}));
    if(geometry.scroll>geometry.width+1){console.error('Pins overflow:',JSON.stringify(geometry));await main.screenshot({path:path.join(root,'pins-layout-failure.png'),scale:'css'});}
    assert(geometry.scroll<=geometry.width+1);
    await main.evaluate(async()=>window.one.patchSettings({capture:{uiScale:100}}));await main.screenshot({path:path.join(root,'pins-page.png'),scale:'css'});
    await main.locator('.nav[data-page=home]').click();await main.evaluate(id=>window.one.pinsAction(id,{kind:'rename',title:'重命名图片'}),id);await main.locator('.nav[data-page=pins]').click();await expect(main.locator('#page-pins')).toContainText('重命名图片');
    await app.close();app=undefined;main=await start();
    const recovered=await main.evaluate(()=>window.one.pinsState());assert.equal(recovered.pins.length,3);assert.equal(recovered.groups[0].name,'参考图');assert(recovered.pins.every(p=>!p.view.visible&&!p.view.passThrough));
    assert.equal(recovered.pins.find(p=>p.id===id).view.rotation,1);assert.equal(recovered.pins.find(p=>p.id===id).view.opacity,.65);
    await main.evaluate(id=>window.one.pinsAction(id,{kind:'show'}),id);await expect.poll(()=>app.windows().filter(page=>page.url().endsWith('?view=pin')).length).toBe(1);
    await main.evaluate(id=>window.one.pinsAction(id,{kind:'remove'}),id);assert.equal((await main.evaluate(()=>window.one.pinsState())).pins.length,2);
    await fs.access(source);await fs.access(textFile);assert.deepEqual(errors,[]);
    console.log('Pins: One windows/resources, material/text/file entries, controls/transforms, original copy/export, pass-through recovery, groups/search/batch selection, toggling, scaling, restart and original-file preservation passed.');
  }catch(error){
    if(app)console.error('Pin windows at failure:',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible(),bounds:w.getContentBounds()}))).catch(()=>[]));
    throw error;
  }finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    const actual=await fs.realpath(profile),base=await fs.realpath(root);assert(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith('pins-window-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
