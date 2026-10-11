const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readFile,writeFile,rm}=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');

test('Base64 handles Unicode text, binary files and invalid input',async()=>{
 const root=await mkdtemp(path.resolve('work/current/base64-ui-')),profile=path.join(root,'profile'),output=path.join(root,'output'),source=path.join(root,'source.bin');
 await mkdir(output);await writeFile(source,Buffer.from([0,1,2,255]));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,ONE_SEARCH_BACKEND:'memory'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:['.'],cwd:process.cwd(),env,timeout:30000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-page="developer"]').click();await page.locator('#tool-tab-base64').click();
  await page.locator('#base64-input').fill('中文 🌄');
  await expect(page.locator('#base64-status')).toHaveText('已生成全部编码');
  const encoded=await page.locator('#base64-output').inputValue();assert.equal(encoded,Buffer.from('中文 🌄').toString('base64'));
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文本解码"]').click();await page.locator('#base64-input').fill(encoded);
  await expect(page.locator('#base64-output')).toHaveValue('中文 🌄');
  await page.locator('#base64-input').fill('%%not-base64');await expect(page.locator('#base64-status')).toContainText('无效');
  const chooseCodec=async label=>{await page.locator('#base64-codecs [role="tab"]').getByText(label,{exact:true}).click();};
  await chooseCodec('Base64URL');await page.locator('#base64-input').fill(Buffer.from('中文 🌄').toString('base64url'));await expect(page.locator('#base64-output')).toHaveValue('中文 🌄');
  await chooseCodec('十六进制');await page.locator('#base64-input').fill(Buffer.from('中文 🌄').toString('hex'));await expect(page.locator('#base64-output')).toHaveValue('中文 🌄');
  await chooseCodec('Base32');await page.locator('#base64-input').fill('MZXW6YTBOI======');await expect(page.locator('#base64-output')).toHaveValue('foobar');
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文本编码"]').click();await page.locator('#base64-input').fill('foobar');await expect(page.locator('#base64-output')).toHaveValue('MZXW6YTBOI======');
  await chooseCodec('Quoted-Printable');await page.locator('#base64-input').fill('A=B 中文\n');await expect(page.locator('#base64-output')).toHaveValue('A=3DB =E4=B8=AD=E6=96=87=0A');
  const viewport=page.viewportSize();await page.setViewportSize({width:700,height:720});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=0,`Quoted-Printable layout overflow: ${overflow}`);if(viewport)await page.setViewportSize(viewport);
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文本解码"]').click();await page.locator('#base64-input').fill('A=3DB =E4=B8=AD=E6=96=87=0A');await expect(page.locator('#base64-output')).toHaveValue('A=B 中文\n');
  await page.locator('#base64-input').fill('A=G0');await expect(page.locator('#base64-status')).toContainText('第 2 个字符');
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文本编码"]').click();
  await chooseCodec('HTML 实体');await page.locator('#base64-input').fill('A&B <中文> 😀');await expect(page.locator('#base64-output')).toHaveValue(/&amp;B/);const html=await page.locator('#base64-output').inputValue();
  await expect(page.locator('#base64-file-codec')).toBeHidden();
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文本解码"]').click();await page.locator('#base64-input').fill(html);await expect(page.locator('#base64-output')).toHaveValue('A&B <中文> 😀');
  await chooseCodec('Unicode 转义');await page.locator('#base64-input').fill('A\\n\\u{1F600}');await expect(page.locator('#base64-output')).toHaveValue('A\n😀');await page.locator('#base64-input').fill('\\u{110000}');await expect(page.locator('#base64-status')).toContainText('无效');
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="文件编码"]').click();await page.locator('#base64-file').setInputFiles(source);
  await expect(page.locator('#base64-codecs')).toBeHidden();
  await expect(page.locator('#base64-output')).toHaveValue('AAEC/w==');
  await page.locator('#base64-mode').click();await page.locator('#base64-mode-options [role="option"][aria-label="解码并保存文件"]').click();
  await expect(page.locator('#base64-file-codec')).toBeVisible();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('view=main')).setSize(700,720));assert.equal(await page.evaluate(()=>{const content=document.querySelector('.content'),button=document.querySelector('#base64-run'),rect=button.getBoundingClientRect();return content.scrollWidth<=content.clientWidth+1&&rect.right<=innerWidth&&rect.top<innerHeight;}),true);
  for(const [label,encoded,expected,fileName] of [['Base64','AAEC/w==',Buffer.from([0,1,2,255]),'base64.bin'],['Base64URL','AAEC_w',Buffer.from([0,1,2,255]),'base64url.bin'],['十六进制','000102ff',Buffer.from([0,1,2,255]),'hex.bin'],['Base32','MZXW6YTBOI======',Buffer.from('foobar'),'base32.bin']]){
   await page.locator('#base64-file-codec').click();await page.locator(`#base64-file-codec-options [role="option"][aria-label="${label}"]`).click();await page.locator('#base64-input').fill(encoded);
   const newWindow=app.waitForEvent('window');await page.locator('#base64-run').click();const picker=await newWindow;
   await picker.locator('#picker-path').fill(output);await picker.locator('#picker-go').click();await picker.locator('#picker-name').fill(fileName);await picker.locator('#picker-confirm').click();
   await expect(page.locator('#base64-status')).toHaveText('已保存文件');assert.deepEqual(await readFile(path.join(output,fileName)),expected);
  }
  assert.deepEqual(errors,[]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
