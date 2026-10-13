const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
async function main(){
  const output=path.resolve('work/current/capture-migration');await fs.mkdir(output,{recursive:true});
  const root=await fs.mkdtemp(path.join(output,'recognition-window-')),profile=path.join(root,'profile'),input=path.join(root,'recognition.png');
  await fs.mkdir(path.join(profile,'recognition/models'),{recursive:true});
  for(const language of ['eng','chi_sim'])await fs.copyFile(path.resolve('work/current/fixtures/recognition-models',language+'.traineddata'),path.join(profile,'recognition/models',language+'.traineddata'));
  const png=await sharp(Buffer.from('<svg width="1400" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="64"><text x="50" y="95">ONE OCR 2026</text><text x="50" y="190">sample@example.com</text></g><text x="50" y="280" fill="black" font-family="Microsoft YaHei" font-size="54">截图识别测试</text></svg>')).png().toBuffer();await fs.writeFile(input,png);
  const requests=[],errors=[];let hold=false,app;
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
    await expect(page.locator('#run')).toBeEnabled();await expect(page.locator('#source')).toHaveJSProperty('naturalWidth',1400);
    const bridge=await page.evaluate(()=>({keys:Object.keys(window.one),old:'frameOCR' in window,api:!!window.one.recognition}));
    assert.equal(bridge.api,true);assert.equal(bridge.old,false);assert.equal(bridge.keys.includes('aiState'),false);assert.equal(bridge.keys.includes('materialsState'),false);
    const initial=await page.evaluate(()=>window.one.recognition.state());
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
    await page.screenshot({path:path.join(output,'recognition-window.png'),scale:'css'});
    await expect(page.locator('#table-tab')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => ['table', 'copyTable', 'saveTable'].map(name => typeof window.one.recognition[name])), ['undefined', 'undefined', 'undefined']);
    await page.locator('#translation-tab').click();await page.locator('#translation-configure').click();await expect(page.locator('#translation-settings')).toBeVisible();
    await page.locator('#translation-endpoint').fill(endpoint+'/translate/exact/completions');await page.locator('#translation-model').fill('fixture-translation');await page.locator('#translation-key').fill('translation-fixture-key');
    await page.locator('#translation-save').click();await expect(page.locator('#translation-settings')).not.toBeVisible();
    await page.locator('#result').fill('Hello, One.');await page.locator('#translate').click();await expect(page.locator('#translated')).toHaveValue('你好，One。');
    assert.equal(requests[0].url,'/translate/exact/completions');assert.equal(requests[0].authorization,'Bearer translation-fixture-key');assert.equal(JSON.stringify(requests[0]).includes('data:image/'),false);
    const ai=await home.evaluate(()=>window.one.aiState());assert.deepEqual(ai.conversations,[]);assert.deepEqual(ai.history,[]);assert.deepEqual(ai.profiles,[]);
    await page.locator('#formula-tab').click();await page.locator('#formula-configure').click();
    await page.locator('#formula-endpoint').fill(endpoint+'/vision/exact/completions');await page.locator('#formula-model').fill('fixture-vision');await page.locator('#formula-key').fill('vision-fixture-key');
    await page.locator('#formula-save').click();await expect(page.locator('#formula-settings')).not.toBeVisible();assert.equal(requests.length,1);
    await page.locator('#formula-recognize').click();await expect(page.locator('#formula-text')).toHaveValue('\\frac{a}{b}');await expect(page.locator('#formula-preview .katex')).toBeVisible();
    assert.equal(requests[1].url,'/vision/exact/completions');assert.equal(requests[1].authorization,'Bearer vision-fixture-key');
    const image=requests[1].body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(value=>value.type==='image_url');assert.equal(image.image_url.url,'data:image/png;base64,'+Buffer.from(sourceBytes).toString('base64'));
    await page.locator('#formula-text').fill('\\href{https://example.test}{x}');await expect(page.locator('#formula-preview-status')).toContainText('预览不可用');await expect(page.locator('#formula-preview .katex')).toHaveCount(0);
    await page.locator('#formula-text').fill('x^2');await expect(page.locator('#formula-preview .katex')).toBeVisible();
    await home.evaluate(()=>window.one.patchSettings({appearance:{mode:'dark'},capture:{uiScale:150}}));
    await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=recognition'));window.setSize(850,700);});
    await expect(page.locator('#app')).toHaveAttribute('data-capture-scale','150');await page.locator('#formula-configure').click();
    await expect(page.locator('#formula-settings')).toBeVisible();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#formula-settings')).opacity)===1);
    await page.screenshot({path:path.join(output,'recognition-settings.png'),scale:'css'});
    const layout=await page.evaluate(()=>{const dialog=document.querySelector('#formula-settings'),rect=dialog.getBoundingClientRect(),body=dialog.querySelector('.one-dialog-body');return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,overflow:body.scrollWidth-body.clientWidth};});
    assert.ok(layout.left>=0&&layout.top>=0&&layout.right<=layout.width&&layout.bottom<=layout.height&&layout.overflow<2,JSON.stringify(layout));
    await page.locator('#formula-modal-close').click();await expect(page.locator('#formula-settings')).not.toBeVisible();
    const raw=await fs.readFile(path.join(profile,'ai-data.json'),'utf8');assert.equal(raw.includes('vision-fixture-key'),false);assert.equal(raw.includes('translation-fixture-key'),false);
    hold=true;await page.locator('#formula-recognize').click();await expect(page.locator('#formula-cancel')).toBeVisible();await expect.poll(()=>requests.length).toBe(3);await page.locator('#formula-cancel').click();await expect(page.locator('#formula-recognize')).toBeEnabled();
    await page.close();assert.equal(await home.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},initial.image),true);
    const editing=app.waitForEvent('window');await home.evaluate(id=>window.one.materialsEditImage(id),materialId);const editor=await editing;editor.on('pageerror',error=>errors.push(String(error)));
    await expect(editor.locator('#copy')).toBeEnabled();await editor.locator('[data-tool="mosaic"]:visible').click();await editor.locator('#sensitive-scan').click();
    await expect(editor.locator('#sensitive-apply')).toBeVisible({timeout:30000});await expect(editor.locator('#sensitive-count')).toContainText('1');
    await editor.locator('#sensitive-apply').click();await expect(editor.locator('#steps')).toHaveText('1 个标注');await editor.locator('#undo').click();await expect(editor.locator('#steps')).toHaveText('0 个标注');
    await editor.locator('#editor-more').click();const reopened=app.waitForEvent('window');await editor.locator('#ocr').click();page=await reopened;await page.waitForURL('**view=recognition');await expect(page.locator('#run')).toBeEnabled();await editor.close();
    const reloaded=await page.evaluate(async()=>({translation:await window.one.recognition.translationConfig(),formula:await window.one.recognition.formulaConfig(),state:await window.one.recognition.state()}));
    assert.equal(reloaded.translation.ready,true);assert.equal(reloaded.formula.ready,true);assert.notEqual(reloaded.state.token,initial.token);
    assert.equal(await page.evaluate(async token=>{try{await window.one.recognition.run(token,'eng');return false;}catch{return true;}},initial.token),true);
    await page.locator('#formula-tab').click();await page.locator('#formula-recognize').click();await expect.poll(()=>requests.length).toBe(4);
    const appProcess=app.process();await app.evaluate(({app})=>app.quit());await expect.poll(()=>appProcess.exitCode,{timeout:15000}).not.toBeNull();app=undefined;
    assert.deepEqual(errors,[]);console.log('Recognition window passed: real OCR, correction/copy and removed table bridge, encrypted exact endpoints, formula worker, cancellation, resource isolation, reopen, scale and active-request exit.');
  }finally{
    if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('recognition-window-'));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
