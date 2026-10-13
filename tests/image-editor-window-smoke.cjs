const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'editor-window-'));let app;const errors=[];
  try{
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one);
    const source=path.join(profile,'source.png'),project=path.join(profile,'edited.oneimage'),exported=path.join(profile,'edited.png');
    await app.evaluate(async({dialog,nativeImage,clipboard},{source,project})=>{
      const png=nativeImage.createFromBitmap(Buffer.alloc(640*400*4,255),{width:640,height:400}).toPNG();
      await process.getBuiltinModule('fs/promises').writeFile(source,png);global.editorOriginal=png;global.editorCopies=[];
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});dialog.showSaveDialog=async()=>({canceled:false,filePath:project});
      clipboard.write=async items=>{for(const item of items)global.editorCopies.push(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));};
    },{source,project});
    const [id]=await main.evaluate(()=>window.one.materialsImportImages());
    await main.evaluate(id=>window.one.materialsEditImage(id),id);
    let editor=app.windows().find(page=>page.url().includes('view=image-editor'));
    assert(editor);await editor.waitForFunction(()=>document.body.dataset.editorReady==='true'||!!document.body.dataset.editorError).catch(async error=>{
      console.error('Editor initialization:',await editor.evaluate(()=>({message:document.querySelector('#message')?.textContent,body:document.body.innerText.slice(0,1200)})),errors.slice(0,4));throw error;
    });
    assert.equal(await editor.evaluate(()=>document.body.dataset.editorError||''),'');
    await expect(editor.locator('#source-name')).toHaveText('source.png');
    await assert.rejects(main.evaluate(id=>window.one.materialsRemoveImage(id),id),/关闭当前图片编辑/);
    assert.equal(await editor.evaluate(()=>typeof window.one.patchSettings),'undefined');
    await expect(editor.locator('#save')).toBeEnabled();
    await editor.locator('[data-tool="text"]:visible').click();
    for(const name of ['加粗','斜体','描边']) await editor.getByRole('button',{name,exact:true}).click();
    await editor.evaluate(()=>{const color=document.getElementById('color');color.value='#f0e060';color.dispatchEvent(new Event('change',{bubbles:true}));});
    await expect.poll(()=>main.evaluate(async()=>(await window.one.settings()).capture.annotationStyles.text)).toMatchObject({color:'#f0e060',fontWeight:700,italic:true,textOutline:true});
    await editor.locator('[data-tool="rectangle"]:visible').click();
    assert.equal(await editor.locator('#color').inputValue(),'#e34e4e');
    await editor.locator('[data-tool="text"]:visible').click();
    await expect(editor.getByRole('button',{name:'描边',exact:true})).toHaveAttribute('aria-pressed','true');
    const workerAsset=(await fs.readdir(path.resolve('dist/renderer/assets'))).find(name=>/^mosaic-worker-.*\.js$/.test(name));assert(workerAsset);
    const matching=await editor.evaluate(url=>new Promise((resolve,reject)=>{
      const worker=new Worker(url,{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('Matching worker timeout'));},5000);
      worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('Matching worker load failed'));};
      worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();resolve(data);};
      const width=64,height=32,pixels=new Uint8ClampedArray(width*height*4).fill(255);
      for(const left of [8,40])for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const at=((8+y)*width+left+x)*4,value=(x*31+y*73)%251;pixels[at]=value;pixels[at+1]=255-value;pixels[at+2]=(x*17+y*41)%233;
      }
      worker.postMessage({pixels,width,height,template:{x:8,y:8,width:8,height:8}});
    }),'one://app/assets/'+workerAsset);assert.equal(matching.error,undefined);assert.equal(matching.matches.length,2);
    await editor.locator('[data-tool="rectangle"]:visible').click();
    const rect=await editor.locator('#overlay').boundingBox();assert(rect&&rect.width>200&&rect.height>150);
    await editor.mouse.move(rect.x+rect.width*.15,rect.y+rect.height*.2);await editor.mouse.down();await editor.mouse.move(rect.x+rect.width*.55,rect.y+rect.height*.65,{steps:5});await editor.mouse.up();
    await expect(editor.locator('#steps')).toHaveText('1 个标注');await expect(editor.locator('#undo')).toBeEnabled();
    await editor.locator('#editor-more').click();await editor.locator('#save-project').click();
    await expect(editor.locator('#message')).toContainText('保存');await expect.poll(async()=>{try{return (await fs.stat(project)).size;}catch{return 0;}}).toBeGreaterThan(100);
    await editor.locator('#copy').click();await expect.poll(()=>app.evaluate(()=>global.editorCopies.length)).toBe(1);
    assert.equal(await app.evaluate(()=>global.editorCopies[0].equals(global.editorOriginal)),false);
    await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);
    await editor.locator('#editor-more').click();await editor.locator('#export').click();
    await expect.poll(async()=>{try{return (await fs.stat(exported)).size;}catch{return 0;}}).toBeGreaterThan(100);
    await editor.locator('#save').click();await expect.poll(async()=>(await main.evaluate(()=>window.one.materialsState())).images.length).toBe(2);
    const saved=(await main.evaluate(()=>window.one.materialsState())).images.find(item=>item.id!==id);
    assert.equal(await app.evaluate(async(_e,file)=>(await process.getBuiltinModule('fs/promises').readFile(file)).equals(global.editorOriginal),source),true);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(editor.locator('body')).toHaveAttribute('data-capture-scale','150');
    await editor.locator('#editor-more').click();
    const bounds=await editor.locator('#editor-more-menu').boundingBox();const viewport=await editor.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1);
    await editor.keyboard.press('Escape');
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:100}}));
    await editor.screenshot({path:path.join(root,'image-editor-window.png'),scale:'css'});
    await Promise.all([editor.waitForEvent('close'),editor.locator('#window-close').click()]);
    await main.evaluate(id=>window.one.materialsEditImage(id),saved.id);editor=app.windows().find(page=>page.url().includes('view=image-editor'));
    await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');await expect(editor.locator('#steps')).toHaveText('1 个标注');
    await editor.locator('#undo').click();await expect(editor.locator('#steps')).toHaveText('0 个标注');
    await editor.locator('#redo').click();await expect(editor.locator('#steps')).toHaveText('1 个标注');
    await editor.locator('[data-tool="text"]:visible').click();
    await editor.evaluate(()=>{const size=document.getElementById('text-size');size.value='96';size.dispatchEvent(new Event('change',{bubbles:true}));});
    const canvas=await editor.locator('#overlay').boundingBox();await editor.mouse.click(canvas.x+canvas.width*.1,canvas.y+canvas.height*.1);
    assert.equal(await editor.locator('#color').inputValue(),'#f0e060');
    for(const name of ['加粗','斜体','描边']) await expect(editor.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
    const emptyInput=await editor.locator('#text-value').boundingBox();
    const textGeometry=()=>editor.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const input=document.getElementById('text-value'),form=input.form,caret=form.querySelector('.inline-annotation-caret');
      const frame=document.getElementById('annotation-selection').getBoundingClientRect(),position=form.getBoundingClientRect();
      const context=document.createElement('canvas').getContext('2d');context.font=input.style.font;context.textBaseline='top';
      const glyph=context.measureText('输入文字'),scale=new DOMMatrix(getComputedStyle(form).transform).a;
      return {frame:frame.toJSON(),caret:caret.getBoundingClientRect().toJSON(),caretHidden:caret.hidden,lineHeight:parseFloat(getComputedStyle(input).lineHeight)*scale,
        bottomGap:frame.bottom-(position.top+glyph.actualBoundingBoxDescent*scale),topGap:position.top-glyph.actualBoundingBoxAscent*scale-frame.top};
    });
    const empty=await textGeometry();assert(empty.bottomGap<12,JSON.stringify(empty));assert(empty.topGap<12,JSON.stringify(empty));
    await editor.screenshot({path:path.join(root,'text-input-empty.png'),clip:{x:empty.frame.x-12,y:empty.frame.y-12,width:empty.frame.width+24,height:empty.frame.height+24}});
    await editor.locator('#text-value').fill('中');assert.deepEqual(await editor.locator('#text-value').boundingBox(),emptyInput);
    const first=await textGeometry();assert.deepEqual(first.frame,empty.frame);assert.equal(first.caret.y,empty.caret.y);assert.equal(first.caret.height,empty.caret.height);
    await editor.locator('#text-value').fill('中\n文');const multiline=await textGeometry();assert(Math.abs(multiline.frame.height-first.frame.height-first.lineHeight)<1,JSON.stringify({first,multiline}));
    await editor.locator('#text-value').fill('');assert.deepEqual((await textGeometry()).frame,empty.frame);
    await fs.writeFile(path.join(root,'text-input-geometry.json'),JSON.stringify({empty,first,multiline},null,2));
    await editor.locator('#text-value').fill('One 标注');await editor.locator('#text-value').press('Control+Enter');
    await expect(editor.locator('#steps')).toHaveText('2 个标注');
    const font=await editor.evaluate(async()=>{const fonts=await window.one.imageEditor.fonts();return fonts.find(font=>font.family==='Arial')||fonts[0];});assert(font);
    await assert.rejects(editor.evaluate(family=>window.one.uiFontSource(family),font.family),/未被选择/);
    await editor.locator('#font-family').click();await editor.getByRole('option',{name:font.label,exact:true}).click();
    await expect.poll(()=>editor.evaluate(family=>[...document.fonts].some(font=>font.family.replaceAll('"','')===family&&font.status==='loaded'),font.family)).toBe(true);
    await editor.getByRole('button',{name:'文字工具',exact:true}).click();await editor.getByRole('menuitemradio',{name:'文字水印',exact:true}).click();
    await expect(editor.locator('#steps')).toHaveText('3 个标注');await editor.locator('.watermark-menu-button').last().click();
    const watermarkBounds=()=>editor.locator('.watermark-menu:popover-open').boundingBox();
    await expect.poll(async()=>(await watermarkBounds())?.width||0).toBeGreaterThan(240);
    await editor.keyboard.press('Escape');await editor.locator('.watermark-menu-button').last().click();
    await expect.poll(async()=>(await watermarkBounds())?.width||0).toBeGreaterThan(240);
    await editor.locator('#watermark-position').click();await editor.getByRole('option',{name:'居中',exact:true}).click();
    await expect(editor.locator('.watermark-menu-button').last()).toContainText('居中');await editor.keyboard.press('Escape');
    await editor.locator('#copy').click();await expect.poll(()=>app.evaluate(()=>global.editorCopies.length)).toBe(2);
    await editor.locator('#editor-more').click();await app.evaluate(({app})=>app.quit());await expect(editor.locator('dialog[open]')).toBeVisible();
    await editor.keyboard.press('Escape');await expect(editor.locator('dialog[open]')).toHaveCount(0);
    assert.equal(await main.evaluate(async()=>(await window.one.materialsState()).images.length),2);
    await editor.locator('#window-close').click();await expect(editor.locator('dialog[open]')).toBeVisible();
    await Promise.all([editor.waitForEvent('close'),editor.getByRole('button',{name:'放弃并关闭',exact:true}).click()]);
    assert.deepEqual(errors,[]);
    console.log('One image editor window: drawing, project/PNG/material save, clipboard, history reopen, text/fonts, watermark controls, scaled menus and cancelled exit passed.');
  }finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    const resolved=await fs.realpath(profile),boundary=await fs.realpath(root);if(!resolved.toLowerCase().startsWith(boundary.toLowerCase()+path.sep))throw Error('Fixture escaped profile root');await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
