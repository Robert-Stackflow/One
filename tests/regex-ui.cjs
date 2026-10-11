const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readFile}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('regex tab shows groups, replacement and cancels slow patterns',async()=>{
 const profile=await mkdtemp(path.resolve('work/current/regex-ui-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-regex').click();
  await page.locator('#regex-snippets summary').click();await page.locator('#regex-pattern').fill('aZ');await page.locator('#regex-pattern').evaluate(field=>field.setSelectionRange(1,1));
  await page.locator('[data-regex-snippet="digits"]').click();await expect(page.locator('#regex-pattern')).toHaveValue('a\\d+Z');
  await page.locator('#regex-pattern').evaluate(field=>field.setSelectionRange(0,field.value.length));await page.locator('[data-regex-snippet="named"]').click();await expect(page.locator('#regex-pattern')).toHaveValue('(?<name>)');assert.equal(await page.locator('#regex-pattern').evaluate(field=>field.selectionStart),8);
  await page.locator('#regex-pattern').fill('(?<word>[a-z]+)');await page.locator('[data-regex-flag="i"]').check();
  await page.locator('#regex-input').fill('Hi 123 HELLO');await page.locator('#regex-replacement').fill('[$<word>]');await page.locator('#regex-preview').click();
  await expect(page.locator('#regex-status')).toHaveText('替换预览已生成');await expect(page.locator('#regex-count')).toContainText('2 个匹配');
  await expect(page.locator('#regex-matches')).toContainText('word =');await expect(page.locator('#regex-output')).toHaveValue('[Hi] 123 [HELLO]');
  await page.locator('#regex-highlight-toggle').click();await expect(page.locator('#regex-highlights mark')).toHaveCount(2);await expect(page.locator('#regex-highlights')).toContainText('Hi 123 HELLO');
  await page.locator('[data-regex-match="1"]').click();await expect(page.locator('#regex-position')).toHaveText('2 / 2');assert.deepEqual(await page.locator('#regex-input').evaluate(el=>[el.selectionStart,el.selectionEnd,document.activeElement===el]),[7,12,true]);
  await expect(page.locator('[data-regex-highlight="1"]')).toHaveAttribute('data-selected','true');
  await page.locator('#regex-next').click();await expect(page.locator('#regex-position')).toHaveText('1 / 2');assert.deepEqual(await page.locator('#regex-input').evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,2]);
  const destination=path.join(profile,'exports');await mkdir(destination);const opening=app.waitForEvent('window');await page.locator('#regex-export').click();const picker=await opening;await picker.locator('#picker-path').fill(destination);await picker.locator('#picker-go').click();await expect(picker.locator('#picker-name')).toHaveValue('正则匹配.json');await picker.locator('#picker-confirm').click();await expect.poll(async()=>readFile(path.join(destination,'正则匹配.json'),'utf8').then(text=>JSON.parse(text).matches.length).catch(()=>-1)).toBe(2);
  await page.locator('#regex-single').click();await expect(page.locator('#regex-output')).toHaveValue('[Hi] 123 HELLO');await page.locator('#regex-apply').click();await expect(page.locator('#regex-input')).toHaveValue('[Hi] 123 HELLO');await expect(page.locator('#regex-single')).toBeDisabled();
  await page.locator('#regex-input').fill('changed');await expect(page.locator('#regex-next')).toBeDisabled();await expect(page.locator('#regex-matches')).toBeEmpty();
  await page.locator('#regex-pattern').fill('(?=😀)');await page.locator('[data-regex-flag="u"]').check();await page.locator('#regex-input').fill('😀😀');await page.locator('#regex-test').click();await expect(page.locator('#regex-highlights mark')).toHaveCount(2);await expect(page.locator('#regex-highlights mark').first()).toHaveText('∅');await page.locator('#regex-next').click();assert.deepEqual(await page.locator('#regex-input').evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,2]);
  for(const width of [700,900,1280]){await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('view=main')).setSize(w,720),width);const layout=await page.evaluate(()=>{const content=document.querySelector('.content'),panel=document.querySelector('.regex-page'),button=document.querySelector('#regex-test'),r=button.getBoundingClientRect();return{overflow:content.scrollWidth>content.clientWidth+1,panelOverflow:panel.scrollWidth>panel.clientWidth+1,actionVisible:r.top<window.innerHeight&&r.right<=window.innerWidth};});assert.deepEqual(layout,{overflow:false,panelOverflow:false,actionVisible:true},`regex layout ${width}`);}
  await page.locator('#regex-pattern').fill('(');await page.locator('#regex-test').click();await expect(page.locator('#regex-status')).toContainText('无效');
  await page.locator('#regex-pattern').fill('(a+)+$');await page.locator('#regex-input').fill('a'.repeat(20000)+'!');await page.locator('#regex-test').click();
  await expect(page.locator('#regex-status')).toContainText('超过 500 毫秒',{timeout:5000});
  await page.locator('#regex-test').click();await page.locator('#regex-cancel').click();await expect(page.locator('#regex-status')).toHaveText('已取消');
  assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
