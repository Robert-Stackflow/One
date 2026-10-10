const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-proxy-info-')),output=path.resolve('work/current/proxy-connectivity');
 await fs.mkdir(output,{recursive:true});
 const requests=[],sockets=new Set();let slow=false;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push({method:req.method,url:req.url});
  if(slow||url.pathname==='/hang')return;
  if(url.pathname==='/redirect'){res.writeHead(302,{Location:'/status/204?token=final-ui-secret'});res.end();return;}
  setTimeout(()=>{res.writeHead(Number(url.pathname.split('/').pop())||200);res.end();},80);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 server.on('connect',(req,socket)=>{requests.push({method:'CONNECT',url:req.url});if(!slow)socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 for(const key of Object.keys(env))if(/^(all|https?|no)_proxy$/i.test(key))delete env[key];
 let app;const errors=[];
 try{
  app=await electron.launch({args:[path.resolve('.')],env});
  app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
  await app.evaluate(async({session,BrowserWindow},proxy)=>{
   BrowserWindow.getAllWindows().find(window=>window.isVisible())?.setBounds({width:1550,height:1050});
   await session.defaultSession.setProxy({mode:'fixed_servers',proxyRules:proxy,proxyBypassRules:'<-loopback>'});
  },base);
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));
  await page.locator('[data-page=hardware]').click();await page.locator('#information-tab-proxy').click();
  await expect(page.locator('#information-proxy')).toBeVisible();await expect(page.locator('#proxy-test-sites .proxy-site-row')).toHaveCount(20);
  await page.locator('#proxy-test-cancel').click();await expect(page.locator('#proxy-test-summary')).toContainText('已取消',{timeout:10000});
  await expect(page.locator('#information-groups')).toContainText('系统代理',{timeout:25000});await expect(page.locator('#information-groups')).toContainText('虚拟网卡');
  await expect(page.locator('#information-highlights')).toBeHidden();await expect(page.locator('#information-progress')).toBeHidden();
  const local=await page.evaluate(()=>window.one.systemInformation('proxy'));
  assert.deepEqual(local.groups.map(group=>group.id),['proxy-settings','proxy-environment','proxy-processes','proxy-adapters']);
  assert.equal(await page.locator('select#proxy-test-mode').count(),0);
  await expect(page.locator('#proxy-test-mode')).toHaveClass(/custom-select/);await expect(page.locator('#proxy-test-mode')).toHaveAttribute('role','combobox');
  const choose=async name=>{await page.locator('#proxy-test-mode').click();await page.getByRole('option',{name,exact:true}).click();};
  await choose('仅直连');
  await page.locator('#proxy-test-url').fill(`${base}/status/404?token=input-ui-secret`);await page.locator('#proxy-test-custom').click();
  await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');
  const custom=page.locator('#proxy-test-custom-result');
  await expect(custom).toContainText('已响应 · HTTP 错误');await expect(custom).toContainText('HTTP 404');
  assert.ok(!(await custom.innerText()).includes('input-ui-secret'));
  assert.deepEqual(await custom.locator('.proxy-site-head').allTextContents(),await page.locator('.proxy-connectivity>.proxy-site-table>.proxy-site-head').allTextContents());
  const columns=await page.evaluate(()=>[...document.querySelectorAll('.proxy-site-head')].map(node=>getComputedStyle(node).gridTemplateColumns));assert.equal(columns[0],columns[1]);
  // Retesting a result must use that result's original address, even after editing the input.
  await page.locator('#proxy-test-url').fill(`${base}/status/500`);await custom.locator('[data-proxy-test=custom]').click();
  await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');await expect(custom).toContainText('HTTP 404');
  await choose('直连与代理对比');
  await page.locator('#proxy-test-url').fill(`${base}/redirect?token=redirect-ui-secret`);await page.locator('#proxy-test-custom').click();
  await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 2 项');await expect(custom).toContainText('HTTP 204');await expect(custom).toContainText('最终地址');
  assert.ok(!/redirect-ui-secret|final-ui-secret/.test(await custom.innerText()));
  await choose('仅代理');await page.locator('#information-query').fill('GitHub');await expect(page.locator('#proxy-test-sites .proxy-site-row')).toHaveCount(1);
  await page.locator('#proxy-test-batch').click();await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');
  await expect(page.locator('[data-proxy-site=github]')).toContainText('HTTP 407');await expect(page.locator('[data-proxy-site=github]')).toContainText('要求认证');
  await page.locator('[data-proxy-test=github]').click();await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');
  await page.locator('#information-query').fill('');await expect(page.locator('#proxy-test-sites .proxy-site-row')).toHaveCount(20);
  await page.locator('#proxy-test-batch').click();await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 20 项',{timeout:10000});
  for(const id of ['tiktok','x','twitter','grok','gemini','instagram'])await expect(page.locator(`[data-proxy-site=${id}]`)).toContainText('HTTP 407');
  await choose('仅直连');
  await page.locator('#proxy-test-url').fill(`${base}/hang`);await page.locator('#proxy-test-custom').click();
  await expect(page.locator('#proxy-test-summary')).toContainText('检测中');await expect(page.locator('#proxy-test-mode')).toBeDisabled();
  await page.locator('#proxy-test-url').fill(`${base}/status/401`);await expect(page.locator('#proxy-test-url')).toHaveValue(`${base}/status/401`);
  const cancelStart=Date.now();await page.locator('#proxy-test-cancel').click();await expect(page.locator('#proxy-test-summary')).toContainText('已取消',{timeout:3000});const cancelMs=Date.now()-cancelStart;
  await expect(page.locator('#proxy-test-mode')).toBeEnabled();await page.locator('#proxy-test-custom').click();await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');await expect(custom).toContainText('要求登录');await expect(custom).toContainText('尚未检测');assert.ok(!(await custom.innerText()).includes('HTTP 204'));
  await page.locator('#proxy-test-url').fill('file:///private/path');await page.locator('#proxy-test-custom').click();await expect(page.locator('#proxy-test-summary')).toContainText('仅支持');
  await page.locator('#proxy-test-url').fill(`${base}/status/401`);await page.locator('#proxy-test-custom').click();await expect(page.locator('#proxy-test-summary')).toHaveText('已完成 · 1 项');
  const rejected=await page.evaluate(async()=>{try{await window.one.proxyConnectivity({id:'test-invalid-url',url:'https://user:password@example.com/?token=invalid-ui-secret',modes:['direct']});return false;}catch{return true;}});assert.equal(rejected,true);
  const logFolder=path.join(profile,'logs');
  await expect.poll(async()=>{const text=await fs.readFile(path.join(logFolder,'errors.jsonl'),'utf8').catch(()=>'');return text.includes('ipc:proxy-connectivity');}).toBe(true);
  for(const name of await fs.readdir(logFolder))if(/\.jsonl(?:\.\d)?$/.test(name)){const file=path.join(logFolder,name);assert.ok((await fs.stat(file)).size<=2*1024*1024);assert.ok(!/input-ui-secret|redirect-ui-secret|final-ui-secret|invalid-ui-secret|user:password/.test(await fs.readFile(file,'utf8')));}
  // Existing custom component retains keyboard navigation.
  await page.locator('#proxy-test-mode').focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Home');await page.keyboard.press('Enter');await expect(page.locator('#proxy-test-mode')).toContainText('直连与代理对比');
  const layout=[];
  for(const width of [1550,1000]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(window=>window.isVisible())?.setBounds({width,height:1050}),width);
   await page.waitForTimeout(150);
   const bounds=await page.locator('.proxy-test-panel').evaluate(panel=>{const box=panel.getBoundingClientRect();return {width:innerWidth,overflow:panel.scrollWidth>panel.clientWidth,contained:[...panel.querySelectorAll('input,button')].every(node=>{const r=node.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right+1;})};});
   assert.equal(bounds.overflow,false);assert.equal(bounds.contained,true);layout.push(bounds);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.isVisible())?.setBounds({width:1550,height:1050}));
  await page.locator('.proxy-test-panel').scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  const box=await page.locator('.proxy-test-panel').boundingBox();await page.screenshot({path:path.join(output,'layout.png'),clip:{x:Math.max(0,box.x-4),y:Math.max(0,box.y-4),width:box.width+8,height:Math.min(580,1050-box.y)},animations:'disabled'});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',presets:20,customHeadersMatch:true,customControl:true,logParamsHidden:true,cancelMs,localRequests:requests.length,layout};await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{
  if(app)await app.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
