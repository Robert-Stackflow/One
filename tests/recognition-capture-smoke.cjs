const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline');
(async()=>{
  const output=path.resolve('work/current/capture-migration'),root=await fs.mkdtemp(path.join(output,'recognition-capture-')),profile=path.join(root,'profile');
  await fs.mkdir(path.join(profile,'recognition/models'),{recursive:true});
  for(const language of ['eng','chi_sim'])await fs.copyFile(path.resolve('work/current/fixtures/recognition-models',language+'.traineddata'),path.join(profile,'recognition/models',language+'.traineddata'));
  let app,fixture,hold=true;const requests=[],errors=[];
  const server=http.createServer((request,response)=>{let text='';request.on('data',chunk=>text+=chunk);request.on('end',()=>{requests.push(JSON.parse(text));if(hold)return;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.parse(text).messages?.[0]?.content?.includes('mathematical formula')?'x^2':'One 截图流程已翻译'}}]}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    fixture=spawn(path.resolve('dist/native/One.CaptureProbe.exe'),['--fixture'],{windowsHide:true,stdio:'pipe'});
    const lines=createInterface({input:fixture.stdout});await once(lines,'line');lines.close();
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one?.captureWindows);
    async function visible(page){const handle=await app.browserWindow(page);try{return await handle.evaluate(window=>window.isVisible());}finally{await handle.dispose();}}
    await app.evaluate(({clipboard})=>{global.recognitionCaptureCopies=0;clipboard.write=async()=>{global.recognitionCaptureCopies++;};});
    async function workflow(actions){await home.evaluate(async actions=>{const settings=await window.one.settings(),preset={...settings.capture.workflows[0],id:'recognition-flow',name:'识别流程测试',actions,translationTarget:'zh-Hans'};await window.one.patchSettings({capture:{workflows:[preset],workflowId:preset.id}});},actions);}
    async function start(){
      const source=await home.evaluate(async()=>{const values=await window.one.captureWindows();return values.find(value=>value.name==='One capture native verification')?.token;});assert.ok(source);
      await home.evaluate(token=>{window.recognitionCaptureDone=false;window.recognitionCaptureError='';void window.one.captureWindow(token,{hideMainWindow:true}).then(()=>{window.recognitionCaptureDone=true;},error=>{window.recognitionCaptureError=String(error);window.recognitionCaptureDone=true;});},source);
      let page;await expect.poll(()=>{page=app.windows().find(page=>!page.isClosed()&&page.url().endsWith('?view=capture'));return !!page;},{timeout:15000}).toBe(true);
      await page.waitForFunction(()=>document.body.dataset.captureReady==='true',{},{timeout:15000});return page;
    }
    async function run(capture){if(!await capture.locator('#run-workflow').isVisible())await capture.locator('#capture-more').evaluate(node=>node.click());await capture.locator('#run-workflow').evaluate(node=>node.click());}
    await workflow(['copy','translate']);let capture=await start();let opened=app.waitForEvent('window');await run(capture);let recognition=await opened;await recognition.waitForURL('**view=recognition');
    await expect(recognition.locator('#workflow-back')).toBeVisible();await expect(recognition.locator('#message')).toContainText('配置翻译服务');
    assert.equal(await app.evaluate(()=>global.recognitionCaptureCopies),1);assert.equal(requests.length,0);
    assert.equal(await visible(capture),false);
    const endpoint='http://127.0.0.1:'+server.address().port+'/capture/exact/completions';
    await recognition.evaluate(async endpoint=>{const config=await window.one.recognition.translationConfig();await window.one.recognition.saveTranslation({...config,provider:'chat',endpoint,model:'fixture',key:'capture-fixture-key'});},endpoint);
    await recognition.locator('#workflow-back').click();await expect.poll(()=>visible(capture)).toBe(true);
    await run(capture);await expect.poll(()=>requests.length,{timeout:30000}).toBe(1);await expect(recognition.locator('#overlay-cancel')).toBeVisible();
    await recognition.locator('#overlay-cancel').click();await expect(recognition.locator('#workflow-back')).toBeVisible();
    assert.equal(await app.evaluate(()=>global.recognitionCaptureCopies),1);await recognition.locator('#workflow-back').click();await expect.poll(()=>visible(capture)).toBe(true);
    hold=false;await run(capture);await expect.poll(()=>home.evaluate(()=>window.recognitionCaptureDone),{timeout:30000}).toBe(true);
    assert.equal(await home.evaluate(()=>window.recognitionCaptureError),'');assert.equal(requests.length,2);assert.equal(await app.evaluate(()=>global.recognitionCaptureCopies),1);
    await expect(recognition.locator('#translated')).toHaveValue('One 截图流程已翻译');assert.match(requests[1].messages[1].content,/Native|native|One|test|editable|button/i);
    await recognition.close();
    await workflow(['ocr']);capture=await start();opened=app.waitForEvent('window');await run(capture);recognition=await opened;await recognition.waitForURL('**view=recognition');
    await expect.poll(()=>home.evaluate(()=>window.recognitionCaptureDone)).toBe(true);await expect(recognition.locator('#run')).toBeEnabled();assert.equal(requests.length,2);
    const state=await recognition.evaluate(()=>window.one.recognition.state());assert.equal(state.running,false);assert.equal(state.workflow,undefined);await expect(recognition.locator('#result')).toHaveValue(/Native|native|One|test|editable|button/i,{timeout:30000});
    await recognition.evaluate(async endpoint=>{const api=window.one.formulaRecognition,config=await api.formulaConfig();await api.saveFormula({revision:config.revision,provider:'chat',endpoint,model:'formula-fixture',region:'',key:'test-only'});},endpoint);
    await recognition.close();capture=await start();opened=app.waitForEvent('window');await capture.locator('#translate').evaluate(node=>node.click());recognition=await opened;await recognition.waitForURL('**view=recognition');
    await expect(recognition.locator('#translated')).toHaveValue('One 截图流程已翻译',{timeout:30000});assert.equal(requests.length,3);await expect(recognition.locator('#tab-translation')).toHaveAttribute('aria-selected','true');
    await recognition.close();capture=await start();opened=app.waitForEvent('window');await capture.locator('#capture-more').evaluate(node=>node.click());await capture.locator('#formula').evaluate(node=>node.click());recognition=await opened;await recognition.waitForURL('**view=recognition');
    await expect(recognition.locator('#formula-text')).toHaveValue('x^2',{timeout:20000});await expect(recognition.locator('#task-run')).toBeEnabled();assert.equal(requests.length,4);
    await recognition.locator('#tab-ocr').click();await recognition.locator('#tab-formula').click();await recognition.waitForTimeout(1000);assert.equal(requests.length,4,'polling and result tabs must not rerun an entry');
    const ai=await home.evaluate(()=>window.one.aiState());assert.deepEqual(ai.history,[]);assert.deepEqual(ai.conversations,[]);assert.deepEqual(errors,[]);
    console.log('Capture recognition passed: owned native source, OCR output, missing-service recovery, local OCR then translation, cancel/back/retry, no duplicate copy or chat history.');
  }finally{
    if(app)await app.close().catch(()=>{});if(fixture&&fixture.exitCode===null){const done=once(fixture,'close');fixture.stdin.write('quit\n');await done;}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('recognition-capture-'));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
