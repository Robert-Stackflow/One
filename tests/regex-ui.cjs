const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('regex tab shows groups, replacement and cancels slow patterns',async()=>{
 const profile=await mkdtemp(path.resolve('work/current/regex-ui-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-regex').click();
  await page.locator('#regex-pattern').fill('(?<word>[a-z]+)');await page.locator('[data-regex-flag="i"]').check();
  await page.locator('#regex-input').fill('Hi 123 HELLO');await page.locator('#regex-replacement').fill('[$<word>]');await page.locator('#regex-preview').click();
  await expect(page.locator('#regex-status')).toHaveText('替换预览已生成');await expect(page.locator('#regex-count')).toContainText('2 个匹配');
  await expect(page.locator('#regex-matches')).toContainText('word =');await expect(page.locator('#regex-output')).toHaveValue('[Hi] 123 [HELLO]');
  await page.locator('#regex-pattern').fill('(');await page.locator('#regex-test').click();await expect(page.locator('#regex-status')).toContainText('无效');
  await page.locator('#regex-pattern').fill('(a+)+$');await page.locator('#regex-input').fill('a'.repeat(20000)+'!');await page.locator('#regex-test').click();
  await expect(page.locator('#regex-status')).toContainText('超过 500 毫秒',{timeout:5000});
  await page.locator('#regex-test').click();await page.locator('#regex-cancel').click();await expect(page.locator('#regex-status')).toHaveText('已取消');
  assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
