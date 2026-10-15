const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
const {createWorker}=require('tesseract.js');
async function main(){
 const output=path.resolve('work/current/capture-reconstruction'),root=await fs.mkdtemp(path.join(output,'unified-window-')),profile=path.join(root,'profile'),input=path.join(root,'image.png');
 let app,worker,hold=false;const errors=[],calls=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',data=>raw+=data);req.on('end',()=>void(async()=>{try{
   if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
   const body=JSON.parse(raw);calls.push(body);if(hold)return;
   let text;if(Array.isArray(body))text=undefined;else{
    const system=body.messages?.[0]?.content||'';
    if(system.includes('six digits')){const image=body.messages[1].content.find(item=>item.type==='image_url').image_url.url.split(',')[1];text=(await worker.recognize(Buffer.from(image,'base64'))).data.text.replace(/\D/g,'');}
    else if(system.includes('Transcribe all'))text='Fixture OCR text\nsecond line';
    else if(system.includes('mathematical expression'))text='\\frac{a}{b}';
    else{const paragraphs=JSON.parse(body.messages[1].content).paragraphs;text=JSON.stringify({paragraphs:paragraphs.map(({id,text})=>({id,text:'译文:'+text}))});}
   }
   res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(body)?body.map(item=>({translations:[{to:'zh-Hans',text:'专用:'+item.Text}]})):{model:'fixture-model',choices:[{message:{content:text}}]}));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:{message:String(error)}}));}})());});
 try{
  worker=await createWorker('eng',1,{langPath:path.resolve('work/dev-profile/recognition/models'),gzip:false,cacheMethod:'none',logger:()=>{}});await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+server.address().port;
  await sharp(Buffer.from('<svg width="640" height="320"><rect width="640" height="320" fill="white"/><text x="40" y="100" font-family="Arial" font-size="38">One OCR workbench</text></svg>')).png().toFile(input);
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));const home=await app.firstWindow();await home.waitForFunction(()=>!!window.one);
  await app.evaluate(({dialog},args)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[args.input]});const original=global.fetch;global.fetch=(value,options)=>{const url=new URL(String(value));return original(url.hostname==='api.cognitive.microsofttranslator.com'?args.endpoint+url.pathname+url.search:value,options);};},{input,endpoint});
  await home.evaluate(()=>window.one.saveTranslationService({name:'Azure fixture',provider:'azure',region:'eastasia',plan:'pro',timeoutSeconds:5,apiKey:'test-only'}));
  await home.locator('[data-page=materials]').click();await home.getByRole('button',{name:'导入图片',exact:true}).click();await expect(home.locator('#material-results .asset-card')).toHaveCount(1);const material=await home.locator('#material-results .asset-card').getAttribute('data-material-card');
  const opening=app.waitForEvent('window');await home.getByRole('button',{name:'识别文字',exact:true}).click();const page=await opening;await page.waitForURL('**view=recognition');await expect(page.locator('#source')).toHaveJSProperty('naturalWidth',640);
  await page.locator('#task-configure').click();await expect(page.locator('#workbench-service-settings')).toBeVisible();
  const editor=page.locator('#workbench-service-settings');await editor.locator('[name=name]').fill('Vision fixture');await editor.locator('[name=base]').fill(endpoint+'/v1');await editor.getByRole('button',{name:'读取模型',exact:true}).click();await expect(editor.locator('[name=model]')).toHaveValue('fixture-model');await expect(editor.locator('[name=models]')).toHaveValue('fixture-model');await page.screenshot({path:path.join(output,'unified-service-editor.png'),animations:'disabled'});await editor.locator('[data-save]').click();await expect(editor).toHaveCount(0);
  await expect(page.locator('#task-service')).toContainText('Vision fixture');await page.locator('#task-service').click();await expect(page.locator('.select-option-group').getByText('本地模型',{exact:true})).toBeVisible();await expect(page.locator('.select-option-group').getByText('AI 服务',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('#task-run').click();await expect(page.locator('#result')).toHaveValue('Fixture OCR text\nsecond line',{timeout:20000});
  await page.locator('#tab-translation').click();await expect(page.locator('#text-result')).toBeHidden();await expect(page.locator('#translation-result')).toBeVisible();
  await page.locator('#task-service').click();await expect(page.locator('.select-option-group').getByText('专用服务',{exact:true})).toBeVisible();await page.getByRole('option',{name:'Vision fixture · fixture-model',exact:true}).click();await expect(page.locator('#task-run')).toBeEnabled();await page.locator('#task-run').click();await expect(page.locator('#translated')).toHaveValue(/译文:Fixture OCR text/);
  await page.locator('#tab-ocr').click();await page.locator('#result').fill('');await page.locator('#tab-translation').click();await expect(page.locator('#task-run')).toHaveText('识别并翻译');await page.locator('#task-run').click();await expect(page.locator('#translated')).toHaveValue(/译文:Fixture OCR text/);await expect(page.locator('#task-run')).toBeEnabled();
  await page.locator('#task-service').click();await page.getByRole('option',{name:'Azure fixture',exact:true}).click();await expect(page.locator('#task-run')).toBeEnabled();await page.locator('#task-run').click();await expect(page.locator('#translated')).toHaveValue(/专用:Fixture OCR text/);
  await page.locator('#task-configure').click();const dedicated=page.locator('#workbench-service-settings');await expect(dedicated.locator('[name=name]')).toHaveValue('Azure fixture');await expect(dedicated.locator('[name=key]')).toHaveValue('');await expect(dedicated.locator('[data-field=appId]')).toBeHidden();await expect(dedicated.locator('[data-field=plan]')).toBeHidden();await dedicated.locator('[name=name]').fill('Azure edited');await dedicated.locator('[data-save]').click();await expect(dedicated).toHaveCount(0);await expect(page.locator('#task-service')).toContainText('Azure edited');assert.equal((await page.evaluate(()=>window.one.recognition.serviceCatalog())).translation[0].hasKey,true);
  await page.locator('#tab-formula').click();await page.locator('#task-service').click();await page.getByRole('option',{name:'Vision fixture · fixture-model',exact:true}).click();await expect(page.locator('#task-run')).toBeEnabled();await page.locator('#task-run').click();await expect(page.locator('#formula-text')).toHaveValue('\\frac{a}{b}');
  const before=await page.evaluate(()=>window.one.recognition.state());await page.evaluate(async()=>{const api=window.one.formulaRecognition,state=await api.state(),config=await api.formulaConfig();await api.recognizeFormula(state.token,config.revision,0,{left:20,top:30,width:120,height:50});});const after=await page.evaluate(()=>window.one.recognition.state());assert.equal(after.token,before.token);assert.equal(after.width,640);
  const image=calls.at(-1).messages[1].content.find(item=>item.type==='image_url').image_url.url.split(',')[1],metadata=await sharp(Buffer.from(image,'base64')).metadata();assert.equal(metadata.width,120);assert.equal(metadata.height,50);
  await page.locator('#tab-ocr').click();await expect(page.locator('#result')).toHaveValue('Fixture OCR text\nsecond line');
  hold=true;await page.locator('#task-run').click();await expect(page.locator('#image-loading')).toBeVisible();await page.locator('#overlay-cancel').click();await expect(page.locator('#image-loading')).toBeHidden();hold=false;await expect(page.locator('#task-run')).toBeEnabled();
  await page.locator('#task-configure').click();await page.locator('#workbench-service-settings [data-models]').click();await expect(page.locator('#local-model-settings')).toBeVisible();assert.equal(await page.locator('#local-model-settings [data-select-model*="formula"]').count(),0);await page.locator('#local-model-settings [data-dialog-dismiss]').click();
  await page.locator('#tab-formula').click();await page.locator('#task-configure').click();await page.locator('#workbench-service-settings [data-models]').click();await expect(page.locator('#formula-local-model-settings')).toBeVisible();await page.locator('#formula-local-model-settings [data-dialog-dismiss]').click();
  const count=app.windows().length;await home.evaluate(id=>window.one.materialsRecognizeFormula(id),material);await expect(page.locator('#formula-panel')).toBeVisible();assert.equal(app.windows().length,count);
  await home.evaluate(id=>window.one.materialsRecognizeImage(id),material);await expect(page.locator('#text-result')).toBeVisible();assert.equal(app.windows().length,count);
  await page.locator('#tab-formula').click();await page.setViewportSize({width:1000,height:700});await page.screenshot({path:path.join(output,'unified-workbench.png'),animations:'disabled'});
  await page.close();const second=app.waitForEvent('window');await home.evaluate(id=>window.one.materialsRecognizeFormula(id),material);const formula=await second;await formula.waitForURL('**view=recognition');await expect(formula.locator('#formula-panel')).toBeVisible();await expect(formula.locator('#text-result')).toBeHidden();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,calls:calls.length,errors:errors.length,sharedWindow:true,regionLeavesSourceIntact:true}));
 }finally{
  if(app)await app.close();if(worker)await worker.terminate();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('unified-window-'));await fs.rm(actual,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
