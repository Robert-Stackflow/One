const {_electron:electron,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp'),{build}=require('esbuild'),{fixtures}=require('./application-preview-fixtures.cjs');
(async()=>{
 const base=path.resolve('work/current');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'search-preview-ui-')),profile=path.join(root,'profile');let app,main;const errors=[],externalRequests=[];
 try{
  const files=await fixtures(root);await fs.mkdir(profile);
  await build({entryPoints:['src/shared/settings.ts'],outfile:path.join(root,'settings.cjs'),bundle:true,platform:'node',packages:'external',logLevel:'warning'});
  const settings=require(path.join(root,'settings.cjs')).defaultSettings();settings.diskMonitor.enabled=false;settings.preview.held=true;settings.search.roots=[root];settings.search.excluded=[profile];settings.search.shortcut='';settings.search.programShortcut='';
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  async function launch(){
   app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>{page.on('pageerror',error=>errors.push(String(error)));page.on('request',request=>{if(request.url().startsWith('https://untrusted.invalid/'))externalRequests.push(request.url());});void page.route('https://untrusted.invalid/**',route=>route.abort());});
   main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.settings);
   await app.evaluate(({shell})=>{global.openedSearchUrls=[];global.openedSearchPaths=[];shell.openPath=async value=>{global.openedSearchPaths.push(value);return '';};shell.openExternal=async value=>{global.openedSearchUrls.push(value);};});
  }
  async function preview(file){
   await main.evaluate(file=>window.one.preview(file),file);let found;
   await expect.poll(async()=>{for(const page of app.windows()){if(!page.url().endsWith('?view=preview'))continue;try{if(await page.evaluate(()=>window.one.previewData().then(data=>data.path))===file){found=page;return true;}}catch{}}return false;},{timeout:20000}).toBe(true);
   return found;
  }
  await launch();await main.locator('.nav[data-page=preview]').click();const toggle=main.locator('#preview-applications');await expect(toggle).not.toBeChecked();
  const blocked=await preview(files['example.exe']);await expect(blocked.locator('#preview-body')).toContainText('应用程序预览已关闭');assert.equal((await blocked.evaluate(()=>window.one.previewData())).application,undefined);
  await toggle.check();await expect.poll(()=>blocked.evaluate(()=>window.one.previewData().then(data=>data.type)),{timeout:20000}).toBe('application');await expect(blocked.locator('.application-preview')).toContainText('Example application');await expect(blocked.locator('.application-preview')).toContainText('1.2.3.4');await expect(blocked.locator('.application-preview')).toContainText('KERNEL32.dll');assert.ok(await blocked.locator('.application-preview-icon .windows-file-icon').evaluate(node=>node.getBoundingClientRect().width)>=47);
  await sharp(await blocked.screenshot()).resize({width:1280,withoutEnlargement:true}).png().toFile(path.join(base,'search-preview-program.png'));
  for(const name of ['example.dll','sample.msix','sample.appx','sample.msixbundle','sample.appxbundle']){const page=await preview(files[name]);await expect(page.locator('.application-preview')).toBeVisible();if(name.endsWith('bundle'))await expect(page.locator('.application-preview-table')).toContainText('arm64');}
  const escaped=await preview(files['unsafe-name.dll']);await expect(escaped.locator('.application-preview h2')).toContainText('<img src=');assert.equal(await escaped.locator('.application-preview img[src^="https:"]').count(),0);
  const document=await preview(files['document.rtf']);await expect(document.locator('.rich-text-preview')).toContainText('中文');await expect(document.locator('.rich-text-preview')).toContainText('Literal <img');assert.equal(await document.locator('.rich-text-preview img,.rich-text-preview object,.rich-text-preview iframe').count(),0);assert.equal(await document.locator('.rich-text-preview span').first().evaluate(node=>getComputedStyle(node).fontWeight),'700');assert.equal(await document.locator('.rich-text-preview p').first().evaluate(node=>getComputedStyle(node).color),'rgb(34, 34, 34)');
  await sharp(await document.screenshot()).resize({width:1280,withoutEnlargement:true}).png().toFile(path.join(base,'search-preview-rtf.png'));
  await toggle.uncheck();await expect(blocked.locator('#preview-body')).toContainText('应用程序预览已关闭');assert.equal((await blocked.evaluate(()=>window.one.previewData())).application,undefined);assert.equal((await document.evaluate(()=>window.one.previewData())).type,'rtf');
  const malformed=await preview(files['broken.exe']);await expect(malformed.locator('#preview-body')).toContainText('应用程序预览已关闭');
  await toggle.check();await expect(malformed.locator('#preview-body')).toContainText('不是有效的 Windows 程序文件');assert.equal(JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).preview.applicationFiles,true);
  await main.evaluate(()=>window.one.showSearch());let search;await expect.poll(()=>{search=app.windows().find(page=>page.url().endsWith('?view=search'));return !!search;}).toBe(true);await search.waitForFunction(()=>!!window.one?.searchOpenUrl);
  const input=search.locator('#file-query');if(!await input.count())throw Error('Search input selector changed');
  for(const address of ['https://example.com/a?x=1#part','example.com','例子.中国/路径','192.168.1.2:8080/a','[::1]:3000','localhost:5173']){
   await input.fill(address);await expect(search.locator('.search-result').first()).toContainText('在浏览器打开网页');await expect(search.locator('.search-result').first()).toHaveAttribute('aria-selected','true');
  }
  await input.fill('https://example.com/instant');await input.press('Enter');await expect.poll(()=>app.evaluate(()=>global.openedSearchUrls.at(-1))).toBe('https://example.com/instant');
  await main.evaluate(()=>window.one.showSearch());const longAddress='https://example.com/search?q='+'a'.repeat(3000);await input.fill(longAddress);await input.press('Enter');await expect.poll(()=>app.evaluate(()=>global.openedSearchUrls.at(-1))).toBe(longAddress);
  await main.evaluate(()=>window.one.showSearch());await input.fill('example.com');await expect(search.locator('.search-result').first()).toContainText('在浏览器打开网页');await input.press('Enter');await expect.poll(()=>app.evaluate(()=>global.openedSearchUrls.at(-1))).toBe('https://example.com/');
  await main.evaluate(()=>window.one.showSearch());await input.fill('document.rtf');await expect.poll(()=>search.locator('.search-result').allTextContents().then(items=>items.some(item=>item.includes('在浏览器打开网页'))),{timeout:20000}).toBe(false);await expect(search.locator('.search-result').first()).toContainText('document.rtf');
  await main.evaluate(()=>window.one.showSearch());await input.fill('example.com');await expect(search.locator('.search-result').first()).toContainText('在浏览器打开网页');await expect.poll(()=>search.locator('.search-result').count(),{timeout:20000}).toBeGreaterThan(1);await input.press('ArrowDown');await input.press('Enter');await expect.poll(()=>app.evaluate(()=>global.openedSearchPaths.at(-1))).toBe(files['example.com']);
  await assert.rejects(search.evaluate(()=>window.one.searchOpenUrl('javascript:alert(1)')),/网页地址/);assert.deepEqual(externalRequests,[]);
  await app.evaluate(({app})=>app.exit(0));await app.close();app=undefined;
  await launch();await main.locator('.nav[data-page=preview]').click();await expect(main.locator('#preview-applications')).toBeChecked();const reopened=await preview(files['example.dll']);await expect(reopened.locator('.application-preview')).toContainText('Example library');await main.locator('#preview-applications').uncheck();await fs.unlink(files['example.dll']);await main.locator('#preview-applications').check();await expect(reopened.locator('#preview-body')).toContainText('文件无法读取');assert.deepEqual(errors,[]);
  console.log('Window checks passed: default-off gate, immediate enable/disable, persisted setting, EXE/DLL/MSIX/APPX/bundles, RTF styles/Unicode, escaped metadata, URL first result/Enter/invalid scheme/file-name regression.');
 }finally{
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(base));assert.ok(path.basename(actual).startsWith('search-preview-ui-'));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:150});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
