const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('developer text diff locates changes and handles whitespace',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'one-developer-diff-')),env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const packaged=process.env.ONE_TEST_EXECUTABLE,app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-developer-diff').click();
  await page.locator('#developer-diff-left').fill('same\nold first\nsame again\nold second\n');await page.locator('#developer-diff-right').fill('same\nnew first\nsame again\nnew second\n');
  await page.locator('#developer-diff-run').click();await expect(page.locator('#developer-diff-status')).toContainText('2 处差异');await expect(page.locator('.developer-diff-card')).toHaveCount(2);
  await expect(page.locator('#developer-diff-position')).toHaveText('1 / 2');await page.locator('#developer-diff-next').click();await expect(page.locator('#developer-diff-position')).toHaveText('2 / 2');
  await expect(page.locator('.developer-diff-card[data-selected="true"]')).toContainText('old second');await page.locator('#developer-diff-prev').click();await expect(page.locator('#developer-diff-position')).toHaveText('1 / 2');
  await page.locator('#developer-diff-left').fill('  same  \n');await page.locator('#developer-diff-right').fill('same\n');await page.locator('#developer-diff-whitespace').check();await page.locator('#developer-diff-run').click();await expect(page.locator('#developer-diff-status')).toContainText('0 处差异');await expect(page.locator('.developer-diff-card')).toHaveCount(0);
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
