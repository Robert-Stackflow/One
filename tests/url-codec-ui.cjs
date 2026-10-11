const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('URL codec tab encodes and decodes without changing the input',async()=>{
 const profile=await mkdtemp(path.resolve('work/current/url-codec-ui-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-url-codec').click();
  await page.locator('#url-codec-input').fill('https://a.test/路径?q=中文 空格');
  await expect(page.locator('#url-codec-status')).toHaveText('已编码');
  assert.equal(await page.locator('#url-codec-output').inputValue(),'https://a.test/%E8%B7%AF%E5%BE%84?q=%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC');
  assert.equal(await page.locator('#url-codec-input').inputValue(),'https://a.test/路径?q=中文 空格');
  await page.locator('#url-codec-scope').click();await page.locator('#url-codec-scope-options [role="option"][aria-label="参数值"]').click();await page.locator('#url-codec-input').fill('a+b%2Bc');
  await page.locator('[data-url-action="decode"]').click();await expect(page.locator('#url-codec-output')).toHaveValue('a b+c');
  await page.locator('#url-codec-input').fill('%E4%A');await expect(page.locator('#url-codec-status')).toContainText('无效');
  assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
