const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const output=path.resolve('work/current/windows-bugfix');await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-')),errors=[],results=[];
  const env={...process.env,ONE_TEST_MODE:'1',ONE_TEST_CAPTURE_SHORTCUTS:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.')],env});
  app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
  try{
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.captureTake);
    if(!process.argv.includes('--pins-only')){
    const displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(display=>({id:display.id,scaleFactor:display.scaleFactor})));
    for(const display of displays){
      await app.evaluate(async({},{id})=>{
        const host=global.oneTestCaptureHost;host.service.prepare(id);await host.service.warm.loaded;
        host.service.host.fonts=async()=>{await new Promise(resolve=>setTimeout(resolve,2500));return [];};
      },display);
      const started=Date.now();
      await main.evaluate(async id=>{
        window.captureFinished=false;window.captureFailure='';
        void window.one.captureTake('region',id).then(()=>window.captureFinished=true,error=>{window.captureFinished=true;window.captureFailure=String(error);});
        const repeated=await Promise.all(Array.from({length:30},()=>window.one.captureTake('region',id)));
        if(repeated.some(value=>value!==null))throw Error('Repeated capture created an output');
      },display.id);
      const capture=app.windows().find(page=>page.url().endsWith('?view=capture'));
      await capture.waitForFunction(()=>document.body.dataset.captureReady==='true');
      await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=capture')).isVisible())).toBe(true);
      const readyMs=Date.now()-started;
      assert(readyMs<2500,`Capture should show before delayed fonts complete: ${readyMs}`);
      const pixels=await capture.evaluate(async()=>{
        const data=await window.one.capture.data(),canvas=document.getElementById('capture-preview'),image=new Image();image.crossOrigin='anonymous';image.src=data.image;await image.decode();
        const reference=document.createElement('canvas');reference.width=128;reference.height=96;reference.getContext('2d').drawImage(image,0,0);
        const actual=canvas.getContext('2d').getImageData(0,0,128,96).data,expected=reference.getContext('2d').getImageData(0,0,128,96).data;
        return {width:canvas.width,height:canvas.height,sourceWidth:data.width,sourceHeight:data.height,exact:actual.every((value,index)=>value===expected[index]),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
      });
      const geometry=await app.evaluate(({BrowserWindow,screen})=>{
        const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=capture'));
        const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),koffi=require('koffi'),u=koffi.load('user32.dll');
        const hwnd=window.getNativeWindowHandle().readBigUInt64LE(),rect=Buffer.alloc(16),client=Buffer.alloc(16);
        u.func('bool __stdcall GetWindowRect(uintptr_t,void*)')(hwnd,rect);u.func('bool __stdcall GetClientRect(uintptr_t,void*)')(hwnd,client);
        return {bounds:window.getBounds(),content:window.getContentBounds(),rect:[0,4,8,12].map(i=>rect.readInt32LE(i)),client:[0,4,8,12].map(i=>client.readInt32LE(i)),zoom:window.webContents.getZoomFactor(),display:screen.getDisplayMatching(window.getBounds()).bounds};
      });
      await fs.writeFile(path.join(output,'capture-geometry.json'),JSON.stringify({display,pixels,geometry},null,2));
      assert.equal(pixels.width,pixels.sourceWidth,JSON.stringify({display,pixels,geometry}));assert.equal(pixels.height,pixels.sourceHeight,JSON.stringify({display,pixels,geometry}));assert.equal(pixels.exact,true,JSON.stringify({display,pixels,geometry}));
      await capture.evaluate(()=>{void window.one.capture.complete(null);});await expect.poll(()=>main.evaluate(()=>window.captureFinished)).toBe(true);
      assert.equal(await main.evaluate(()=>window.captureFailure),'');results.push({display,readyMs,pixels});
    }
    // Validate a real failed composition, then start another capture immediately.
    await app.evaluate(async()=>{const host=global.oneTestCaptureHost;await host.service.warm.loaded;host.service.warm.overlay.webContents.capturePage=async()=>{throw Error('fixture compositor unavailable');};});
    const failed=await main.evaluate(async()=>{try{await window.one.captureTake('region');return '';}catch(error){return String(error);}});
    assert.match(failed,/fixture compositor unavailable/);assert.equal((await main.evaluate(()=>window.one.captureState())).active,false);
    await main.evaluate(()=>{window.captureFinished=false;void window.one.captureTake('region').then(()=>window.captureFinished=true);});
    let recovered;await expect.poll(()=>{recovered=app.windows().find(page=>page.url().endsWith('?view=capture'));return !!recovered;}).toBe(true);
    await recovered.waitForFunction(()=>document.body.dataset.captureReady==='true');await recovered.evaluate(()=>{void window.one.capture.complete(null);});
    await expect.poll(()=>main.evaluate(()=>window.captureFinished)).toBe(true);
    }
    await app.evaluate(({clipboard,nativeImage})=>{
      global.clipboardMode='text';global.clipboardText='One 已有贴图\n保持原位置与内容';
      global.clipboardPNG=nativeImage.createFromBitmap(Buffer.alloc(420*260*4,255),{width:420,height:260}).toPNG();
      clipboard.read=async()=>global.clipboardMode==='image'?[{types:['image/png'],getType:async()=>new Blob([global.clipboardPNG],{type:'image/png'})}]:[];
      clipboard.readText=async()=>global.clipboardText;
      const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'),koffi=require('koffi'),load=koffi.load;
      koffi.load=function(file,...args){const library=load.call(this,file,...args);return file==='user32.dll'?{func(...args){return String(args[0]).includes('IsClipboardFormatAvailable')?()=>false:library.func(...args);}}:library;};
    });
    const text=await main.evaluate(()=>window.one.pinsClipboard());
    const repeated=await main.evaluate(()=>Promise.all(Array.from({length:25},()=>window.one.pinsClipboard())));
    assert(repeated.every(id=>id===text));assert.equal((await main.evaluate(()=>window.one.pinsState())).pins.length,1);
    const pin=app.windows().find(page=>page.url().endsWith('?view=pin'));await pin.waitForFunction(()=>document.body.dataset.pinReady==='true');
    const before=await pin.evaluate(()=>window.one.pin.state());
    await main.evaluate(id=>window.one.pinsAction(id,{kind:'hide'}),text);assert.equal(await main.evaluate(()=>window.one.pinsClipboard()),text);
    const restored=await pin.evaluate(()=>window.one.pin.state());assert.equal(restored.record.view.x,before.record.view.x);assert.equal(restored.record.view.y,before.record.view.y);
    for(const mode of ['light','dark']){
      await main.evaluate(mode=>window.one.patchSettings({appearance:{mode}}),mode);
      await pin.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
      await main.evaluate(()=>window.one.pinsClipboard());await expect(pin.locator('#toast')).toHaveText('已显示已有贴图');
      const style=await pin.locator('#toast').evaluate(node=>{const css=getComputedStyle(node);return {border:[css.borderTopWidth,css.borderRightWidth,css.borderBottomWidth,css.borderLeftWidth],background:css.backgroundColor,color:css.color,shadow:css.boxShadow};});
      assert.deepEqual(style.border,['0px','0px','0px','0px']);assert.notEqual(style.shadow,'none');assert.notEqual(style.background,style.color);
      assert.equal(style.background,mode==='light'?'rgb(48, 48, 48)':'rgb(51, 51, 51)');
      const tooltip=await pin.evaluate(()=>{const node=document.createElement('div');node.className='one-tooltip';document.body.append(node);const css=getComputedStyle(node),result={background:css.backgroundColor,color:css.color};node.remove();return result;});
      assert.deepEqual(tooltip,{background:'rgb(48, 48, 48)',color:'rgb(255, 255, 255)'});
      const highlight=await pin.locator('.pin-recall-highlight').evaluate(node=>{const css=getComputedStyle(node);return {inset:css.inset,radius:css.borderRadius,clip:css.clipPath};});assert.equal(highlight.inset,'0px');assert.equal(highlight.radius,'7px');assert.equal(highlight.clip,'inset(0px round 7px)');
      await pin.screenshot({path:path.join(output,`pin-toast-${mode}.png`)});results.push({toast:mode,style,highlight});
    }
    await app.evaluate(()=>{global.clipboardMode='image';});
    const image=await main.evaluate(()=>window.one.pinsClipboard());
    assert((await main.evaluate(()=>Promise.all(Array.from({length:15},()=>window.one.pinsClipboard())))).every(id=>id===image));
    assert.equal((await main.evaluate(()=>window.one.pinsState())).pins.length,2);
    assert.deepEqual(errors,[]);
    const captureChecked=!process.argv.includes('--pins-only');
    const report={result:'PASS',...(captureChecked?{captureBurst:30,paintFailureRecovery:true}:{}),clipboardBursts:{text:25,image:15},results};
    await fs.writeFile(path.join(output,'smoke-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
