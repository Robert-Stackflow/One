const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');

async function run(){
  const out=path.resolve('work/current/capture-migration/capture-system-entry');await fs.mkdir(out,{recursive:true});
  const root=await fs.mkdtemp(path.join(out,'fixture-')),profile=path.join(root,'profile'),ids=['region','copy','custom','screen','pinClipboard','togglePins','nextPinGroup','recording'];
  let app,owner,main;const errors=[];
  async function launch(){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_CAPTURE_SHORTCUTS:'1',ONE_TEST_TRAY_MENU:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);
    await app.evaluate(({clipboard,nativeImage})=>{
      global.p9Calls=[];global.p9Failures=[];global.p9ClipboardImage=false;
      global.p9PNG=nativeImage.createFromBitmap(Buffer.alloc(24*16*4,255),{width:24,height:16}).toPNG();
      clipboard.read=async()=>global.p9ClipboardImage?[{types:['image/png'],getType:async()=>new Blob([global.p9PNG],{type:'image/png'})}]:[];
      clipboard.readText=async()=>'One P9 文字贴图';
      const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),koffi=require('koffi'),load=koffi.load;
      koffi.load=function(file,...args){const library=load.call(this,file,...args);return file==='user32.dll'?{func(...args){return String(args[0]).includes('IsClipboardFormatAvailable')?()=>false:library.func(...args);}}:library;};
      // Acquisition already has dedicated native/host tests; this fixture checks entry dispatch without reading the desktop.
      const host=global.oneTestCaptureHost;host.take=async mode=>{host.context.assertAvailable();global.p9Calls.push(mode);};
      global.oneTestCaptureShortcuts.dependencies.failed=error=>global.p9Failures.push(error.message);
    });
    return main;
  }
  const settings=async()=>{await main.locator('.nav[data-page=settings]').click();await main.locator('[data-settings-tab=capture]').click();await expect(main.locator('#capture-shortcut-region')).toBeVisible();};
  const state=()=>main.evaluate(()=>window.one.captureShortcutStatus());
  const trigger=id=>app.evaluate((_electron,id)=>global.oneTestCaptureShortcuts.trigger(id),id);
  async function trayAction(id){
    await app.evaluate(()=>global.oneTestTrayMenu.open({x:120,y:120,width:24,height:24}));
    await expect.poll(()=>app.windows().some(page=>page.url().includes('view=tray-menu'))).toBe(true);
    const tray=app.windows().find(page=>page.url().includes('view=tray-menu'));await tray.waitForFunction(()=>!!window.one?.trayMenuAction);
    await expect(tray.locator('[data-action=settings]')).toHaveCount(1);
    await tray.locator('[data-action=quit]').scrollIntoViewIfNeeded();await expect(tray.locator('[data-action=quit]')).toBeInViewport();
    if(id==='materials'){await tray.locator('[data-action=capture-region]').scrollIntoViewIfNeeded();await tray.screenshot({path:path.join(out,'tray-menu.png')});}
    await tray.evaluate(id=>window.one.trayMenuAction(id),id);
  }
  async function startOwner(){
    const script=path.join(root,'shortcut-owner.cjs');
    await fs.writeFile(script,"const {app,globalShortcut}=require('electron'),fs=require('node:fs');app.setPath('userData',process.env.ONE_OWNER_PROFILE);app.whenReady().then(()=>{const key=JSON.parse(process.env.ONE_OWNER_KEYS).find(key=>globalShortcut.register(key,()=>{}));if(!key){console.error('No fixture key available');app.exit(2);return;}console.log('READY '+key);setInterval(()=>{if(fs.existsSync(process.env.ONE_OWNER_PROFILE+'.stop')){globalShortcut.unregisterAll();app.exit(0);}},100);});\n");
    const env={...process.env,ONE_OWNER_PROFILE:path.join(root,'owner'),ONE_OWNER_KEYS:JSON.stringify(['Control+Alt+Shift+F24','Control+Shift+Super+F24','Control+Alt+Super+F24'])};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),[script],{cwd:process.cwd(),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const exit=new Promise(resolve=>child.once('exit',resolve));owner={child,exit};
    return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Shortcut owner did not become ready')),15000);child.stdout.on('data',chunk=>{text=(text+chunk).slice(-1000);const found=/READY ([^\r\n]+)/.exec(text);if(found){clearTimeout(timer);resolve(found[1]);}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);if(!/READY /.test(text))reject(Error('Shortcut owner exited: '+code));});child.stderr.on('data',()=>{});});
  }
  async function stopOwner(){if(!owner)return;const current=owner;owner=undefined;await fs.writeFile(path.join(root,'owner.stop'),'stop');let timer;await Promise.race([current.exit,new Promise((resolve,reject)=>{timer=setTimeout(()=>{current.child.kill();reject(Error('Shortcut owner did not exit'));},10000);})]).finally(()=>clearTimeout(timer));}
  async function search(){await main.evaluate(()=>window.one.showSearch());await expect.poll(()=>app.windows().some(page=>/[?&]view=search(?:$|&)/.test(page.url())&&!page.url().includes('embedded'))).toBe(true);return app.windows().find(page=>/[?&]view=search(?:$|&)/.test(page.url())&&!page.url().includes('embedded'));}
  try{
    await launch();let bindings=Object.fromEntries(ids.map((id,i)=>[id,`Ctrl+Alt+Shift+F${15+i}`]));
    await main.evaluate(bindings=>window.one.patchSettings({capture:{shortcuts:bindings}}),bindings);
    await expect.poll(async()=>Object.values((await state()).entries).every(item=>item.active&&!item.error)).toBe(true);
    await settings();await main.locator('#capture-shortcut-region').focus();await expect.poll(async()=>(await state()).paused).toBe(true);
    await main.reload();await main.waitForFunction(()=>!!window.one);
    await expect.poll(async()=>!(await state()).paused&&Object.values((await state()).entries).every(item=>item.active)).toBe(true);
    await settings();assert.equal(await main.locator('.capture-shortcut-settings input').count(),8);
    for(const id of ids)await expect(main.locator('#capture-shortcut-'+id)).toHaveValue(bindings[id]);
    await main.bringToFront();await main.locator('#capture-shortcut-region').focus();
    await expect.poll(async()=>(await state()).paused).toBe(true);
    assert.equal(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('Control+Alt+Shift+F15')),false);
    await trigger('region');assert.deepEqual(await app.evaluate(()=>global.p9Calls),[]);
    const conflict=await main.evaluate(()=>window.one.hotkeyConflict('Ctrl+Alt+O','capture-shortcut-region'));assert.equal(conflict.source,'one');assert.match(conflict.label,/打开 One/);
    await main.locator('#capture-shortcut-region').evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'F23',code:'F23',ctrlKey:true,altKey:true,shiftKey:true,bubbles:true})));
    await expect.poll(()=>main.evaluate(async()=>(await window.one.settings()).capture.shortcuts.region)).toBe('Ctrl+Alt+Shift+F23');
    await main.locator('#capture-shortcut-region').evaluate(element=>element.dispatchEvent(new KeyboardEvent('keyup',{key:'F23',bubbles:true})));
    await expect.poll(async()=>(await state()).entries.region.active).toBe(true);bindings.region='Ctrl+Alt+Shift+F23';
    const external=await startOwner();await main.locator('#capture-shortcut-copy').evaluate((element,key)=>{element.value=key;element.dispatchEvent(new Event('change',{bubbles:true}));},external);
    await expect.poll(async()=>(await state()).entries.copy.error).toContain('占用');assert.equal((await state()).entries.region.active,true);
    await expect(main.locator('#capture-shortcut-copy')).toHaveValue(external);await expect(main.locator('#capture-shortcut-copy')).toHaveAttribute('aria-invalid','true');
    await stopOwner();await main.evaluate(()=>window.one.retryCaptureShortcuts());await expect.poll(async()=>(await state()).entries.copy.active).toBe(true);bindings.copy=external;
    await main.evaluate(()=>window.one.patchSettings({capture:{shortcuts:{screen:'Shift+Win+C'}}}));await expect.poll(async()=>(await state()).entries.screen.error).toContain('屏幕取色');
    await main.evaluate(key=>window.one.patchSettings({capture:{shortcuts:{screen:key}}}),bindings.screen);
    const temporary=path.join(profile,'settings.json.tmp');await fs.mkdir(temporary);
    await main.locator('#capture-shortcut-custom').evaluate(element=>{element.value='Ctrl+Alt+Shift+F13';element.dispatchEvent(new Event('change',{bubbles:true}));});
    await expect(main.locator('#capture-shortcut-custom')).toHaveAttribute('aria-invalid','true');assert.equal((await main.evaluate(()=>window.one.settings())).capture.shortcuts.custom,bindings.custom);
    assert.equal((await state()).entries.custom.active,true);await expect(main.locator('#capture-shortcut-custom')).toHaveValue('Ctrl+Alt+Shift+F13');
    await main.evaluate(()=>window.one.retryCaptureShortcuts());await expect(main.locator('#capture-shortcut-custom')).toHaveAttribute('aria-invalid','true');
    await fs.rmdir(temporary);
    await main.locator('#capture-shortcut-custom').evaluate(element=>element.dispatchEvent(new Event('change',{bubbles:true})));
    await expect.poll(()=>main.evaluate(async()=>(await window.one.settings()).capture.shortcuts.custom)).toBe('Ctrl+Alt+Shift+F13');bindings.custom='Ctrl+Alt+Shift+F13';
    await expect.poll(async()=>Object.values((await state()).entries).every(item=>item.active&&!item.error)).toBe(true);
    for(const id of ['region','copy','screen'])await trigger(id);assert.deepEqual(await app.evaluate(()=>global.p9Calls),['region','copy','screen']);
    await trigger('pinClipboard');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.length)).toBe(1);
    await trigger('togglePins');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins[0].view.visible)).toBe(false);await trigger('togglePins');
    await main.evaluate(async()=>{const state=await window.one.pinsState();await window.one.pinsGroup(null,{kind:'create',name:'快捷键组'});const next=await window.one.pinsState();await window.one.pinsAction(state.pins[0].id,{kind:'group',group:next.groups[0].id});});
    await trigger('pinClipboard');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.length)).toBe(2);
    await trigger('nextPinGroup');await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.filter(pin=>pin.view.visible).length)).toBe(1);
    const firstGroup=await main.evaluate(async()=>(await window.one.pinsState()).pins.find(pin=>pin.view.visible).group);await trigger('nextPinGroup');
    await expect.poll(()=>main.evaluate(async()=>(await window.one.pinsState()).pins.find(pin=>pin.view.visible)?.group)).not.toBe(firstGroup);
    await trigger('recording');await expect(main.locator('.content')).toHaveAttribute('data-current-page','recording');
    await trigger('custom');await expect(main.locator('#custom-capture-dialog')).toBeVisible();await main.locator('#custom-save').click();
    const panel=await search();await panel.locator('#file-query').evaluate(element=>{element.value='> 区域截图';element.dispatchEvent(new Event('input',{bubbles:true}));});
    await panel.locator('.search-result').filter({hasText:'区域截图'}).first().dblclick();await expect.poll(()=>app.evaluate(()=>global.p9Calls.length)).toBe(4);
    await main.evaluate(()=>window.one.searchAction('capture-copy')).then(()=>assert.fail('main cannot impersonate search'),error=>assert.match(String(error),/拒绝|无效/));
    await search();await panel.evaluate(()=>window.one.searchAction('page:recording'));await expect(main.locator('.content')).toHaveAttribute('data-current-page','recording');
    for(const [page,label] of [['capture','打开截图'],['recording','打开录制'],['materials','打开素材'],['pins','打开贴图']]){
      const popup=await search();await popup.locator('#file-query').evaluate((element,label)=>{element.value='> '+label;element.dispatchEvent(new Event('input',{bubbles:true}));},label);
      await popup.locator('.search-result').filter({hasText:label}).first().dblclick();await expect(main.locator('.content')).toHaveAttribute('data-current-page',page);
    }
    await trayAction('materials');await expect(main.locator('.content')).toHaveAttribute('data-current-page','materials');
    await trayAction('capture-recording');await expect(main.locator('.content')).toHaveAttribute('data-current-page','recording');
    await trayAction('capture-custom');await expect(main.locator('#custom-capture-dialog')).toBeVisible();await main.locator('#custom-save').click();
    await app.evaluate(()=>{global.p9ClipboardImage=true;});await trayAction('capture-clipboard');
    await expect.poll(()=>app.windows().some(page=>page.url().includes('view=image-editor'))).toBe(true);
    const editor=app.windows().find(page=>page.url().includes('view=image-editor'));await editor.waitForFunction(()=>!!window.one?.imageEditor);
    assert.equal((await editor.evaluate(()=>window.one.imageEditor.state())).name,'剪贴板图片');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=image-editor')).destroy());
    await settings();const before=await main.evaluate(()=>window.one.settings());assert.deepEqual(before.capture.shortcuts,bindings);
    await main.locator('.capture-shortcut-settings').screenshot({path:path.join(out,'shortcut-settings.png')});
    await app.close();app=undefined;await launch();await expect.poll(async()=>Object.values((await state()).entries).every(item=>item.active&&!item.error)).toBe(true);
    assert.deepEqual((await main.evaluate(()=>window.one.settings())).capture.shortcuts,bindings);assert.deepEqual(errors,[]);
    const result={result:'PASS',eightBindings:true,nativeRecordingPauseResume:true,recordingReloadRecovery:true,oneAndExternalConflicts:true,writeFailureRetry:true,dispatcherModes:['region','copy','screen'],customDialog:true,pinsClipboardToggleGroups:true,recordingPage:true,searchFourPagesAndRoleGuard:true,trayActions:true,clipboardEditor:true,restart:true,desktopAcquisitionStubbed:true,systemClipboardUnchanged:true};
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(result);
  }catch(error){await fs.writeFile(path.join(out,'failure.txt'),String(error));if(app)await fs.writeFile(path.join(out,'failure-state.json'),JSON.stringify(await app.evaluate(()=>({calls:global.p9Calls,failures:global.p9Failures,shortcuts:global.oneTestCaptureShortcuts?.state()})),null,2));throw error;}
  finally{try{await stopOwner();}finally{if(app)await app.close();}const actual=await fs.realpath(root);assert.ok(actual.startsWith(out+path.sep));await fs.rm(actual,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
