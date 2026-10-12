const {_electron:electron,expect}=require('@playwright/test');
const http=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');

async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'one-ai-smoke-')),profile=path.join(root,'profile');await fs.mkdir(profile);
 const requests=[];let modelCount=1,modelAuth='';const server=http.createServer((request,response)=>{
  if(request.url==='/v1/models'){modelAuth=request.headers.authorization||'';response.setHeader('Content-Type','application/json');response.end(JSON.stringify({data:[{id:'test-model'},...Array.from({length:modelCount-1},(_,index)=>({id:`extra-model-${index}`}))]}));return;}
  if(request.url.startsWith('/suggest?')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(['pi',['ping suggestion']]));return;}
  if(request.url==='/v1/chat/completions'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{requests.push(JSON.parse(body));response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: '+JSON.stringify({choices:[{delta:{content:'**hello**'},finish_reason:null}]})+'\n\n');response.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});return;}
  response.writeHead(404);response.end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));
  await page.locator('[data-page=ai]').click();await expect(page.locator('[data-ai-panel=chat]')).toBeVisible();
  await page.locator('[data-ai-tab=services]').click();await page.locator('#ai-add-service').click();
  await expect(page.locator('#ai-service-dialog')).toBeVisible();await expect(page.locator('.ai-profile-models')).toBeVisible();
  await page.locator('#ai-kind').click();await page.getByRole('option',{name:'Codex（本机）'}).click();
  await expect(page.locator('#codex-account')).toBeVisible();await expect(page.locator('#codex-executable')).not.toBeEmpty();
  const codex=await page.evaluate(()=>window.one.codexStatus());assert.equal(typeof codex.available,'boolean');
  await page.locator('#ai-service-dialog [data-save]').click();await expect(page.locator('#ai-service-dialog')).toBeHidden();
  assert.equal((await page.evaluate(()=>window.one.aiState())).profiles[0].kind,'codex');
  await page.locator('#ai-add-service').click();await page.locator('#ai-kind').click();await page.getByRole('option',{name:'在线 / OpenAI 兼容接口'}).click();
  await page.locator('#ai-name').fill('Mock');await page.locator('#ai-base').fill(`http://127.0.0.1:${port}/v1`);await page.locator('#ai-key').fill('temporary-token');
  await page.locator('#ai-fetch-models').click();await expect(page.locator('#ai-model-status')).toContainText('找到 1 个模型');await expect(page.locator('#ai-model-rows .ai-model-row')).toHaveCount(1);assert.equal(modelAuth,'Bearer temporary-token');assert.equal((await page.evaluate(()=>window.one.aiState())).profiles.length,1);
  await page.locator('#ai-key').fill('');
  await page.locator('#ai-model-rows [data-model-name]').fill('Test model');await page.locator('#ai-service-dialog [data-save]').click();await expect(page.locator('#ai-service-dialog')).toBeHidden();
  const id=(await page.evaluate(()=>window.one.aiState())).profiles.find(profile=>profile.name==='Mock').id;
  await page.evaluate(id=>window.one.aiProfileDefault(id),id);
  await expect(page.locator(`[data-service-models="${id}"]`)).toBeVisible();
  modelCount=175;await page.locator(`[data-service-models="${id}"]`).click();await expect(page.locator('#ai-model-catalog')).toBeVisible();await expect(page.locator('#ai-catalog-progress')).toContainText('175 个模型');
  await page.locator('#ai-catalog-select').click();await page.locator('.select-popup-search').fill('extra-model-173');await expect(page.getByRole('option',{name:'extra-model-173',exact:true})).toBeVisible();await expect(page.locator('.select-popup [role=option]:visible')).toHaveCount(1);await page.getByRole('option',{name:'extra-model-173',exact:true}).click();await expect(page.locator('#ai-catalog-select')).toContainText('extra-model-173');await page.locator('#ai-model-catalog [data-cancel]').click();
  await page.locator('[data-ai-tab=chat]').click();await expect(page.locator('#ai-main-chat #chat-history')).toBeVisible();await expect(page.locator('#ai-main-chat #chat-new')).toBeVisible();await expect(page.locator('#ai-main-chat #chat-messages')).toBeVisible();assert.equal(await page.locator('#ai-main-chat .chat-header').count(),0);assert.equal(await page.locator('#ai-main-chat #chat-command').count(),0);
  assert.equal(await page.locator('.content').evaluate(node=>getComputedStyle(node).overflowY),'hidden');
  await page.locator('[data-ai-tab=settings]').click();await expect(page.locator('#ai-hotkey')).toBeVisible();await page.locator('[data-ai-tab=services]').click();await expect(page.locator('#ai-add-service')).toBeVisible();assert.equal(await page.locator('[data-ai-panel=services] .section-heading').count(),0);await page.locator(`[data-service-remove="${id}"]`).click();await expect(page.locator('.one-dialog[open]')).toContainText('删除 AI 服务');await page.locator('.one-dialog[open] [data-dialog-cancel]').click();await page.locator('[data-ai-tab=commands]').click();await expect(page.locator('#ai-add-command')).toBeVisible();await page.locator('[data-ai-tab=chat]').click();await page.locator('#ai-open-chat').click();
  await expect.poll(()=>app.windows().some(window=>window.url().includes('view=ai-chat')),{timeout:10000}).toBe(true);
  const chat=app.windows().find(window=>window.url().includes('view=ai-chat'));chat.on('pageerror',error=>errors.push(String(error)));
  await expect(chat.locator('.chat-empty h1')).toHaveText('有什么想聊的？');
  await expect(chat.locator('#chat-pin')).toBeVisible();await expect(chat.locator('#chat-keep')).toBeVisible();await expect(chat.locator('#chat-attach')).toBeVisible();await expect(chat.locator('#chat-reference')).toBeVisible();assert.equal(await chat.locator('#chat-command').count(),0);
  const width=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=ai-chat')).getBounds().width);
  await chat.locator('#chat-history-toggle').click();await expect(chat.locator('#chat-history')).toBeVisible();const expanded=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=ai-chat')).getBounds().width);assert(expanded>width);
  await chat.locator('#chat-history-toggle').click();await expect(chat.locator('#chat-history')).toBeHidden();
  await expect(chat.locator('#chat-profile-trigger')).toContainText('Test model');
  await chat.locator('#chat-profile-trigger').click();await expect(chat.locator('#chat-model-options')).toBeVisible();await expect(chat.locator('.model-picker-services')).toContainText('Mock');await expect(chat.locator('.model-picker-models')).toContainText('test-model');await chat.keyboard.press('Escape');
  await chat.locator('#chat-pin').click();await expect(chat.locator('#chat-pin')).toHaveAttribute('aria-pressed','false');await chat.locator('#chat-pin').click();await expect(chat.locator('#chat-pin')).toHaveAttribute('aria-pressed','true');
  await chat.locator('#chat-input').fill('ping');await chat.locator('#chat-send').click();await expect(chat.locator('.chat-message[data-role=assistant] strong')).toHaveText('hello',{timeout:15000});
  assert.equal(await chat.locator('.chat-history-item>button:first-child').first().evaluate(node=>getComputedStyle(node).borderTopWidth),'0px');
  await app.evaluate(({clipboard})=>clipboard.writeText('引用文字'));await chat.locator('#chat-reference').click();await expect(chat.locator('.chat-reference-popup')).toContainText('引用文字');await chat.locator('[data-reference-text]').click();await expect(chat.locator('#chat-input')).toHaveValue('引用文字');await chat.locator('#chat-input').fill('');
  const tiny=await chat.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);return canvas.toDataURL('image/png').split(',')[1];});await chat.locator('#chat-file-input').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:Buffer.from(tiny,'base64')});await expect(chat.locator('#chat-attachments .chat-attachment'),await chat.locator('#chat-status').textContent()).toHaveCount(1);await chat.locator('#chat-send').click();await expect(chat.locator('.chat-message[data-role=user] .message-images img')).toHaveCount(1);assert(requests.at(-1).messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')));
  const state=await page.evaluate(()=>window.one.aiState());assert.equal(state.conversations[0].messages.at(-1).text,'**hello**');assert.deepEqual(errors,[]);
  await chat.close();
  await app.evaluate(()=>{const original=globalThis.fetch;globalThis.fetch=(url,options)=>String(url).startsWith('https://suggestqueries.google.com/')?Promise.resolve(new Response(JSON.stringify(['pi',['ping suggestion']]),{headers:{'Content-Type':'application/json'}})):original(url,options);});
  await page.evaluate(()=>window.one.showSearch());await expect.poll(()=>app.windows().some(window=>window.url().includes('view=search'))).toBe(true);
  const search=app.windows().find(window=>window.url().includes('view=search'));const input=search.locator('#file-query');search.on('pageerror',error=>errors.push(String(error)));
  await input.fill('ai ');await expect(search.locator('#search-mode-tag strong')).toHaveText('AI 问答');await expect(search.locator('.search-ai-panel')).toBeVisible();assert.equal(await search.locator('.search-ai-heading').count(),0);assert((await search.locator('.search-ai-panel').boundingBox()).height<150);assert.equal(await search.locator('.search-ai-panel').evaluate(node=>getComputedStyle(node).borderTopWidth),'0px');await input.fill('ping');await input.press('Enter');
  await expect(search.locator('.search-ai-answer')).toContainText('**hello**');await expect(search.locator('[data-ai-chat]')).toBeVisible();
  await search.locator('[data-ai-chat]').click();await expect.poll(()=>app.windows().some(window=>window.url().includes('view=ai-chat'))).toBe(true);
  assert.equal((await page.evaluate(()=>window.one.aiState())).history[0].result,'**hello**');
  await app.windows().find(window=>window.url().includes('view=ai-chat')).close();
  assert.deepEqual(await search.evaluate(()=>window.one.searchSuggest('google','pi')),['ping suggestion']);
  assert.deepEqual(errors,[]);
  console.log('AI migration smoke passed');
 }finally{await app.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
