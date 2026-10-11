const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('developer UUID tab generates single and batch values with copy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-developer-uuid-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:join(root,'profile'),ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-developer-uuid').click();await page.locator('#developer-uuid-generate').click();
  const first=await page.locator('#developer-uuid-output').inputValue();assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);await page.locator('#developer-uuid-copy').click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),first);
  await page.locator('#developer-uuid-count').fill('12');await page.locator('#developer-uuid-format').click();await page.locator('#developer-uuid-format-options [role="option"][aria-label="紧凑（无连字符）"]').click();await page.locator('#developer-uuid-uppercase').check();await page.locator('#developer-uuid-generate').click();
  const batch=(await page.locator('#developer-uuid-output').inputValue()).split('\n');assert.equal(batch.length,12);assert.equal(new Set(batch).size,12);assert(batch.every(value=>/^[0-9A-F]{32}$/.test(value)));await expect(page.locator('#developer-uuid-status')).toHaveText('已生成 12 个 UUID v4');assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
