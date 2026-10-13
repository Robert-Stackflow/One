const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
async function verifyCanvas(page) {
  const viewport=page.locator('.text-image-viewport'),stage=page.locator('.text-image-stage');
  await expect(viewport).toBeVisible();assert.equal(await viewport.evaluate(node=>getComputedStyle(node).overflow),'hidden');
  await expect(page.locator('progress')).toHaveCount(0);await expect(page.getByRole('button',{name:'取消识别',exact:true})).toHaveCount(0);
  const box=await viewport.boundingBox(),before=await stage.boundingBox(),x=box.x+box.width*.4,y=box.y+box.height*.4;
  await page.mouse.move(x,y);await page.mouse.wheel(0,-180);
  await expect.poll(async()=>(await stage.boundingBox()).width).toBeGreaterThan(before.width*1.15);
  const after=await stage.boundingBox();assert.ok(Math.abs((x-before.x)/before.width-(x-after.x)/after.width)<.01,'wheel zoom must preserve the image point under the pointer');
  const panBefore=await stage.boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height-35);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+40,box.y+box.height-10,{steps:5});await page.mouse.up();
  const panAfter=await stage.boundingBox();assert.ok(Math.abs(panAfter.x-panBefore.x-40)<2&&Math.abs(panAfter.y-panBefore.y-25)<2,'background drag must pan the canvas: '+JSON.stringify({before:panBefore,after:panAfter}));
  await page.locator('[data-text-action=fit]').click();
  for(const action of ['fit','zoom-in','zoom-out','rotate']) { const button=page.locator(`[data-text-action=${action}]`);await expect(button.locator('svg')).toHaveCount(1);assert.equal(await button.evaluate(node=>!!node.closest('.ocr-commandbar,.formula-commandbar')),true); }
}
async function main(){
  const output=path.resolve('work/current/capture-migration');await fs.mkdir(output,{recursive:true});
  const root=await fs.mkdtemp(path.join(output,'recognition-window-')),profile=path.join(root,'profile'),input=path.join(root,'recognition.png');
  await fs.mkdir(path.join(profile,'recognition/models'),{recursive:true});
  for(const language of ['eng','chi_sim'])await fs.copyFile(path.resolve('work/current/fixtures/recognition-models',language+'.traineddata'),path.join(profile,'recognition/models',language+'.traineddata'));
  const png=await sharp(Buffer.from('<svg width="1400" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="64"><text x="50" y="95">ONE OCR 2026</text><text x="50" y="190">sample@example.com</text></g><text x="50" y="280" fill="black" font-family="Microsoft YaHei" font-size="54">截图识别测试</text></svg>')).png().toBuffer();await fs.writeFile(input,png);
  const requests=[],errors=[];let hold=false,app,formulaPage;
  const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
    const value=JSON.parse(body);requests.push({url:request.url,authorization:request.headers.authorization,body:value});
    if(hold)return;
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:request.url==='/vision/exact/completions'?'\\frac{a}{b}':'你好，One。'}}]}));
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+server.address().port;
  try{
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});
    const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one);
    await app.evaluate(({dialog,clipboard},{input})=>{
      global.recognitionCopies=[];
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});
      clipboard.writeText=async text=>{global.recognitionCopies.push({text});};
      clipboard.write=async items=>{const item=items[0];global.recognitionCopies.push({text:await(await item.getType('text/plain')).text(),html:await(await item.getType('text/html')).text()});};
    },{input});
    await home.locator('[data-page=materials]').click();await home.getByRole('button',{name:'导入图片',exact:true}).click();
    const cards=home.locator('#material-results .asset-card');await expect(cards).toHaveCount(1);
    const materialId=await cards.first().getAttribute('data-material-card');
    const opening=app.waitForEvent('window');await home.getByRole('button',{name:'识别文字',exact:true}).click();let page=await opening;
    page.on('pageerror',error=>errors.push(String(error)));await page.waitForURL('**view=recognition');
    await expect(page.locator('#run')).toBeEnabled();await expect(page.locator('#source')).toHaveJSProperty('naturalWidth',1400);await verifyCanvas(page);
    const bridge=await page.evaluate(()=>({keys:Object.keys(window.one),old:'frameOCR' in window,api:!!window.one.recognition}));
    assert.equal(bridge.api,true);assert.equal(bridge.old,false);assert.equal(bridge.keys.includes('aiState'),false);assert.equal(bridge.keys.includes('materialsState'),false);
    const initial=await page.evaluate(()=>window.one.recognition.state());
    await expect(page.locator('#translation-result')).toBeVisible();await expect(page.locator('#translation-tab')).toHaveCount(0);await expect(page.locator('#formula-tab')).toHaveCount(0);
    const imageBefore=await page.locator('.source-preview').boundingBox(),resultBefore=await page.locator('#ocr-results').boundingBox();assert.ok(imageBefore.width>resultBefore.width*1.5);
    const divider=await page.locator('#ocr-divider').boundingBox(),workspace=await page.locator('#ocr-workspace').boundingBox();
    await page.mouse.move(divider.x+4,divider.y+30);await page.mouse.down();await page.mouse.move(workspace.x+workspace.width*.55,divider.y+30,{steps:10});await page.mouse.up();
    await expect.poll(async()=>Math.round((await page.locator('.source-preview').boundingBox()).width)).toBeLessThan(Math.round(imageBefore.width)-20);
    await page.locator('#result-panel-toggle').click();await expect(page.locator('#ocr-results')).not.toBeVisible();assert.ok((await page.locator('.source-preview').boundingBox()).width>imageBefore.width*1.3);
    await page.locator('#result-panel-toggle').click();await expect(page.locator('#ocr-results')).toBeVisible();await page.locator('#ocr-divider').dblclick();
    const sourceBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),initial.image);
    assert.ok((await sharp(Buffer.from(sourceBytes)).ensureAlpha().raw().toBuffer()).equals(await sharp(png).ensureAlpha().raw().toBuffer()));
    assert.equal(await home.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},initial.image),true);
    await page.evaluate(()=>new Promise(resolve=>{const frame=document.createElement('iframe');frame.id='recognition-security-fixture';frame.onload=()=>resolve();frame.src='about:blank';document.body.append(frame);}));
    const childFrame=page.frames().find(frame=>frame.parentFrame()===page.mainFrame());assert.ok(childFrame);
    // about:blank requests can be attributed to their parent; the dedicated window
    // rejects resource and business access while any child document is attached.
    const childDenied=await childFrame.evaluate(async url=>{try{await fetch(url,{cache:'no-store'});return false;}catch{return true;}},initial.image);
    assert.equal(childDenied,true);
    assert.equal(await page.evaluate(async()=>{try{await window.one.recognition.state();return false;}catch{return true;}}),true);
    await page.locator('#recognition-security-fixture').evaluate(frame=>frame.remove());
    const unauthorized=await app.evaluate(async({BrowserWindow},{preload,url})=>{
      const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
      try{await window.loadURL('one://app/index.html?view=recognition');return await window.webContents.executeJavaScript(`Promise.all([window.one.recognition.state().then(()=>false,()=>true),fetch(${JSON.stringify(url)}).then(()=>false,()=>true)])`);}finally{window.destroy();}
    },{preload:path.resolve('dist/preload/recognition.cjs'),url:initial.image});assert.deepEqual(unauthorized,[true,true]);
    await page.locator('#run').click();await expect(page.locator('#result')).toHaveValue(/ONE OCR 2026/i,{timeout:30000});await expect(page.locator('#run')).toBeEnabled();
    assert.match((await page.locator('#result').inputValue()).replace(/\s/g,''),/截图识别测试/);
    await page.locator('#copy').click();await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.length)).toBe(1);
    assert.match(await app.evaluate(()=>global.recognitionCopies[0].text),/sample@example.com/);
    const fullText=await page.locator('#result').inputValue(),firstWord=fullText.trim().split(/\s+/)[0];
    await sharp(await page.screenshot({scale:'css'})).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toFile(path.resolve('work/current/capture-reconstruction/ocr-workspace-review.png'));
    const viewport=page.locator('.text-image-viewport'),unit=page.locator('.text-selection-unit');
    await viewport.evaluate(node=>{
      window.textGesture=[];
      for(const name of ['pointerdown','pointermove','pointerup'])node.addEventListener(name,event=>{
        if(name==='pointermove'&&!event.buttons)return;
        const stage=node.querySelector('.text-image-stage'),inner=node.querySelector('.text-image-inner'),rect=stage.getBoundingClientRect();
        window.textGesture.push({type:name,x:event.clientX,y:event.clientY,stage:[rect.x,rect.y,rect.width,rect.height],inner:[inner.style.width,inner.style.height,inner.style.transform],scroll:[node.scrollLeft,node.scrollTop],range:[node.dataset.selectionStart,node.dataset.selectionEnd],hit:document.elementFromPoint(event.clientX,event.clientY)?.textContent?.slice(0,10)});
        if(window.textGesture.length>16)window.textGesture.shift();
      });
    });
    await expect(unit.first()).toHaveAttribute('data-geometry','character');
    await unit.first().dblclick();assert.match(await page.locator('.text-selection-actions').evaluate(node=>getComputedStyle(node).backgroundColor),/^rgb\(/);assert.deepEqual(await page.locator('[data-text-action=copy]').evaluate(node=>{const style=getComputedStyle(node);return [style.borderTopRightRadius,style.borderBottomRightRadius];}),['0px','0px']);await page.locator('[data-text-action=copy]').click();
    await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.at(-1).text)).toBe(firstWord);
    await page.locator('[data-text-action=translate]').click();
    await expect(page.locator('#translation-settings')).toBeVisible();
    await expect(page.locator('#result')).toHaveValue(fullText);assert.equal(requests.length,0);
    await page.locator('#modal-close').click();await expect(page.locator('#translation-settings')).not.toBeVisible();
    await viewport.focus();await viewport.press('Control+a');await viewport.press('Control+c');
    await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.at(-1).text)).toBe(fullText.trim());
    async function dragChinese(){
      await unit.filter({hasText:/^截$/}).waitFor({state:'attached',timeout:3000}).catch(async error=>{
        console.error('Text viewport:',await viewport.evaluate(node=>({size:[node.clientWidth,node.clientHeight],scroll:[node.scrollLeft,node.scrollTop],stage:node.querySelector('.text-image-stage').getBoundingClientRect().toJSON(),transform:node.querySelector('.text-image-inner').style.transform,rendered:node.querySelector('.text-selection-layer').dataset.renderedTokens,characters:Array.from(node.querySelectorAll('.text-selection-unit')).slice(0,12).map(node=>node.textContent)})));throw error;
      });
      await unit.filter({hasText:/^截$/}).hover();
      await unit.filter({hasText:/^图$/}).hover();
      let pair;
      await expect.poll(async()=>{pair=await page.evaluate(()=>{
        const nodes=Array.from(document.querySelectorAll('.text-selection-unit'));
        const first=nodes.find(node=>node.textContent==='截'),last=nodes.find(node=>node.textContent==='图');
        return first&&last?[first.getBoundingClientRect().toJSON(),last.getBoundingClientRect().toJSON()]:null;
      });return !!pair;}).toBe(true);
      const [first,last]=pair;await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();
      await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:5});await page.mouse.up();
      await page.locator('[data-text-action=copy]').click();
      await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.at(-1).text)).toBe('截图').catch(async error=>{
        console.error('Drag coordinates:',JSON.stringify(await page.evaluate(()=>window.textGesture)));throw error;
      });
    }
    await dragChinese();await viewport.focus();await viewport.press('Shift+ArrowRight');await viewport.press('Control+c');
    await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.at(-1).text)).toBe('截图识');
    await unit.filter({hasText:/^截$/}).click({clickCount:3});await page.locator('[data-text-action=copy]').click();
    await expect.poll(()=>app.evaluate(()=>global.recognitionCopies.at(-1).text)).toBe(fullText.split('\n').find(line=>line.includes('截图')).trim());
    await page.locator('[data-text-action=zoom-in]').click();await page.locator('[data-text-action=zoom-in]').click();
    await page.locator('[data-text-action=rotate]').click();await page.locator('[data-text-action=fit]').click();await dragChinese();
    await home.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(page.locator('#app')).toHaveAttribute('data-capture-scale','150');
    await dragChinese();
    await sharp(await page.screenshot({scale:'css'})).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(output,'recognition-text-selection.png'));
    await home.evaluate(()=>window.one.patchSettings({capture:{uiScale:100}}));await expect(page.locator('#app')).toHaveAttribute('data-capture-scale','100');
    const windowHandle=await app.browserWindow(page),originalSize=await windowHandle.evaluate(window=>window.getContentSize());
    await windowHandle.evaluate(window=>window.setContentSize(680,760));
    await page.locator('[data-text-action=fit]').click();
    const narrow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,image:document.querySelector('.text-image-viewport').getBoundingClientRect().height,result:document.getElementById('result').getBoundingClientRect().height}));
    assert.ok(narrow.scroll<=narrow.width&&narrow.image>=170&&narrow.result>=100,JSON.stringify(narrow));
    await windowHandle.evaluate((window,size)=>window.setContentSize(...size),originalSize);await windowHandle.dispose();
    await expect(page.locator('#table-tab')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => ['table', 'copyTable', 'saveTable'].map(name => typeof window.one.recognition[name])), ['undefined', 'undefined', 'undefined']);
    assert.deepEqual(await page.evaluate(()=>['formulaConfig','recognizeFormula'].map(name=>typeof window.one.recognition[name])),['undefined','undefined']);
    await page.locator('#translation-configure').click();await expect(page.locator('#translation-settings')).toBeVisible();
    await page.locator('#translation-endpoint').fill(endpoint+'/translate/exact/completions');await page.locator('#translation-model').fill('fixture-translation');await page.locator('#translation-key').fill('translation-fixture-key');
    await page.locator('#translation-save').click();await expect(page.locator('#translation-settings')).not.toBeVisible();
    await page.locator('#result').fill('Hello, One.');await page.locator('#translate').click();await expect(page.locator('#translated')).toHaveValue('你好，One。');
    assert.equal(requests[0].url,'/translate/exact/completions');assert.equal(requests[0].authorization,'Bearer translation-fixture-key');assert.equal(JSON.stringify(requests[0]).includes('data:image/'),false);
    const ai=await home.evaluate(()=>window.one.aiState());assert.deepEqual(ai.conversations,[]);assert.deepEqual(ai.history,[]);assert.deepEqual(ai.profiles,[]);
    const formulaOpening=app.waitForEvent('window');await page.locator('#open-formula').click();formulaPage=await formulaOpening;await formulaPage.waitForURL('**view=formula-recognition');formulaPage.on('pageerror',error=>errors.push(String(error)));await formulaPage.locator('#formula-configure').click();
    assert.equal(await formulaPage.evaluate(()=>!!window.one.formulaRecognition&&!window.one.recognition),true);
    const formulaSource=await formulaPage.evaluate(async()=> (await window.one.formulaRecognition.state()).image);
    assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},formulaSource),true);
    await formulaPage.locator('#formula-endpoint').fill(endpoint+'/vision/exact/completions');await formulaPage.locator('#formula-model').fill('fixture-vision');await formulaPage.locator('#formula-key').fill('vision-fixture-key');
    await formulaPage.locator('#formula-save').click();await expect(formulaPage.locator('#formula-settings')).not.toBeVisible();assert.equal(requests.length,1);await verifyCanvas(formulaPage);
    await formulaPage.locator('#formula-recognize').click();await expect(formulaPage.locator('#formula-text')).toHaveValue('\\frac{a}{b}');await expect(formulaPage.locator('#formula-preview .katex')).toBeVisible();
    assert.equal(requests[1].url,'/vision/exact/completions');assert.equal(requests[1].authorization,'Bearer vision-fixture-key');
    const image=requests[1].body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(value=>value.type==='image_url');assert.equal(image.image_url.url,'data:image/png;base64,'+Buffer.from(sourceBytes).toString('base64'));
    await formulaPage.locator('#formula-text').fill('\\href{https://example.test}{x}');await expect(formulaPage.locator('#formula-preview-status')).toContainText('预览不可用');await expect(formulaPage.locator('#formula-preview .katex')).toHaveCount(0);
    await formulaPage.locator('#formula-text').fill('x^2');await expect(formulaPage.locator('#formula-preview .katex')).toBeVisible();
    await home.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'},capture:{uiScale:150}}));
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=formula-recognition'));window.setSize(850,700);});
    await expect(formulaPage.locator('#app')).toHaveAttribute('data-capture-scale','150');await formulaPage.locator('#formula-configure').click();
    await expect(formulaPage.locator('#formula-settings')).toBeVisible();await formulaPage.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#formula-settings')).opacity)===1);
    await formulaPage.screenshot({path:path.join(output,'recognition-settings.png'),scale:'css'});
    const layout=await formulaPage.evaluate(()=>{const dialog=document.querySelector('#formula-settings'),rect=dialog.getBoundingClientRect(),body=dialog.querySelector('.one-dialog-body');return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,overflow:body.scrollWidth-body.clientWidth};});
    assert.ok(layout.left>=0&&layout.top>=0&&layout.right<=layout.width&&layout.bottom<=layout.height&&layout.overflow<2,JSON.stringify(layout));
    await formulaPage.locator('#formula-modal-close').click();await expect(formulaPage.locator('#formula-settings')).not.toBeVisible();
    const raw=await fs.readFile(path.join(profile,'ai-data.json'),'utf8');assert.equal(raw.includes('vision-fixture-key'),false);assert.equal(raw.includes('translation-fixture-key'),false);
    hold=true;await formulaPage.locator('#formula-recognize').click();await expect(formulaPage.locator('#formula-cancel')).toHaveCount(0);await expect(formulaPage.locator('#image-loading')).toBeVisible();assert.match(await formulaPage.locator('#image-loading').evaluate(node=>getComputedStyle(node).backgroundColor),/^rgb\(/);assert.equal(await formulaPage.locator('#image-loading').evaluate(node=>getComputedStyle(node).backdropFilter),'none');await expect.poll(()=>requests.length).toBe(3);await formulaPage.locator('#overlay-cancel').click();await expect(formulaPage.locator('#image-loading')).not.toBeVisible();await expect(formulaPage.locator('#formula-recognize')).toBeEnabled();
    await page.close();assert.equal(await home.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},initial.image),true);
    assert.equal(await formulaPage.evaluate(async()=>{const state=await window.one.formulaRecognition.state();return (await (await fetch(state.image,{cache:'no-store'})).arrayBuffer()).byteLength;}),sourceBytes.length);await formulaPage.close();
    const editing=app.waitForEvent('window');await home.evaluate(id=>window.one.materialsEditImage(id),materialId);const editor=await editing;editor.on('pageerror',error=>errors.push(String(error)));
    await expect(editor.locator('#copy')).toBeEnabled();await editor.locator('[data-tool="mosaic"]:visible').click();await editor.locator('#sensitive-scan').click();
    await expect(editor.locator('#sensitive-apply')).toBeVisible({timeout:30000});await expect(editor.locator('#sensitive-count')).toContainText('1');
    await editor.locator('#sensitive-apply').click();await expect(editor.locator('#steps')).toHaveText('1 个标注');await editor.locator('#undo').click();await expect(editor.locator('#steps')).toHaveText('0 个标注');
    await editor.locator('#editor-more').click();const reopened=app.waitForEvent('window');await editor.locator('#ocr').click();page=await reopened;await page.waitForURL('**view=recognition');await expect(page.locator('#run')).toBeEnabled();await editor.close();
    const reloaded=await page.evaluate(async()=>({translation:await window.one.recognition.translationConfig(),state:await window.one.recognition.state()}));
    assert.equal(reloaded.translation.ready,true);assert.notEqual(reloaded.state.token,initial.token);
    assert.equal(await page.evaluate(async token=>{try{await window.one.recognition.run(token,'eng');return false;}catch{return true;}},initial.token),true);
    const nextFormula=app.waitForEvent('window');await home.getByRole('button',{name:'识别公式',exact:true}).click();formulaPage=await nextFormula;await formulaPage.waitForURL('**view=formula-recognition');await expect(formulaPage.locator('#formula-recognize')).toBeEnabled();await formulaPage.locator('#formula-recognize').click();await expect.poll(()=>requests.length).toBe(4);
    const appProcess=app.process();await app.evaluate(({app})=>app.quit());await expect.poll(()=>appProcess.exitCode,{timeout:15000}).not.toBeNull();app=undefined;
    assert.deepEqual(errors,[]);console.log('Recognition window passed: real OCR, correction/copy and removed table bridge, encrypted exact endpoints, formula worker, cancellation, resource isolation, reopen, scale and active-request exit.');
  }finally{
    if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('recognition-window-'));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
