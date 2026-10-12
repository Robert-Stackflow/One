const {_electron: electron, expect} = require('@playwright/test');
const {build} = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('work/current/capture-migration');
  await fs.mkdir(root, {recursive:true});
  const profile = await fs.mkdtemp(path.join(root, 'feedback-profile-'));
  const bundle = await build({stdin:{contents:`export * from './src/renderer/feedback'; export {toast} from './src/renderer/ui';`,resolveDir:path.resolve('.')}, bundle:true, platform:'browser', format:'iife', globalName:'feedback', write:false});
  const css = await fs.readFile('src/renderer/feedback.css','utf8');
  const env = {...process.env,ONE_COMPONENT_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({args:[path.resolve('tests/renderer-components/main.cjs')],env});
    const page = await app.firstWindow(), errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setContent(`<style>[hidden]{display:none!important} body{margin:20px} .toast-layer{pointer-events:none} .toast{pointer-events:none} ${css}</style>
      <div class="toast-layer"><p id="toast" class="toast" hidden></p></div>
      <section id="host"><p id="inline" hidden></p><div id="floating" hidden></div><p id="temporary" hidden></p></section>
      <button id="outside">outside</button>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(()=>{
      const inline=document.querySelector('#inline'),floating=document.querySelector('#floating');
      feedback.setupInlineFeedback(inline);feedback.setupInlineFeedback(inline);
      feedback.setupFloatingFeedback(floating,true);
      window.notify=feedback.transientNotice(floating,120);
      window.inlineMessage=()=>feedback.showFeedback(inline,()=>inline.textContent='保存失败');
      inlineMessage();
    });
    await expect(page.locator('.notice-banner')).toHaveCount(1);
    await expect(page.locator('.notice-banner')).toHaveAttribute('data-tone','warning');
    await page.locator('.notice-dismiss').click();
    await expect(page.locator('.notice-banner')).toBeHidden();
    await page.evaluate(()=>inlineMessage());
    await expect(page.locator('.notice-banner')).toBeVisible();
    await page.locator('#inline').focus();await page.keyboard.press('Escape');
    await expect(page.locator('.notice-banner')).toBeHidden();

    await page.evaluate(()=>notify('保留结果',true));
    await page.waitForTimeout(180);
    await expect(page.locator('#floating')).toBeVisible();
    await page.locator('#floating').focus();await page.keyboard.press('Escape');
    await expect(page.locator('#floating')).toBeHidden();
    await page.locator('#outside').focus();await page.mouse.move(0,0);
    await page.evaluate(()=>notify('自动收起'));
    await expect(page.locator('#floating')).toBeHidden({timeout:1000});

    await page.evaluate(()=>notify('读取时保留'));
    await page.locator('#floating').focus();await page.waitForTimeout(180);
    await expect(page.locator('#floating')).toBeVisible();
    await page.locator('#outside').focus();
    await expect(page.locator('#floating')).toBeHidden({timeout:1000});

    await page.evaluate(()=>notify('执行中',false,{label:'重试',run:()=>new Promise((resolve,reject)=>{window.rejectAction=reject;})}));
    await page.locator('.feedback-action').focus();await page.keyboard.press('Space');
    await expect(page.locator('.feedback-action')).toBeDisabled();
    await page.locator('#outside').focus();await page.mouse.move(0,0);await page.waitForTimeout(180);
    await expect(page.locator('#floating')).toBeVisible();
    await page.evaluate(()=>rejectAction(new Error('请求失败')));
    await expect(page.locator('.feedback-text')).toHaveText('请求失败');
    await expect(page.locator('.feedback-action')).toBeEnabled();
    await page.waitForTimeout(180);await expect(page.locator('#floating')).toBeVisible();
    await page.evaluate(()=>{notify('旧消息',true,{label:'旧操作',run:()=>new Promise((_,reject)=>{window.rejectOld=reject;})});});
    await page.locator('.feedback-action').click();
    await page.evaluate(()=>{notify('新结果',true);rejectOld(Error('过期错误'));});
    await expect(page.locator('#floating')).toHaveText('新结果');

    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{const el=document.querySelector('#floating');feedback.dismissFeedback(el,()=>el.textContent='');notify('中断关闭后仍可见',true);});
    await page.waitForTimeout(250);
    await expect(page.locator('#floating')).toHaveText('中断关闭后仍可见');
    await expect(page.locator('#floating')).toBeVisible();
    await page.emulateMedia({reducedMotion:'reduce'});

    await page.evaluate(()=>feedback.toast(new Error('主窗口提示')));
    await expect(page.locator('#toast')).toHaveText('主窗口提示');
    assert.equal(await page.locator('#toast').evaluate(el=>getComputedStyle(el).pointerEvents),'auto');
    await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<div class="one-dialog-body"></div>';document.body.append(dialog);dialog.showModal();feedback.toast('弹窗提示');});
    await expect(page.locator('.dialog-error')).toHaveText('弹窗提示');
    await expect(page.locator('#toast')).toHaveText('主窗口提示');
    await page.evaluate(()=>{document.querySelector('dialog').close();document.querySelector('dialog').remove();
      window.removed=document.querySelector('#temporary');window.lateNotice=feedback.transientNotice(removed,80);lateNotice('即将移除');removed.remove();document.querySelector('#host').remove();});
    await page.waitForTimeout(150);
    await page.evaluate(()=>{lateNotice('过期写入');notify('移除后回调');});
    assert.equal(await page.evaluate(()=>removed.textContent),'即将移除');
    assert.deepEqual(errors,[]);
    console.log('Feedback: persistent/automatic dismissal, repeat messages, keyboard actions, pending/error/stale actions, interrupted animation, One toast/dialog routing and removal passed.');
  } finally {
    await app?.close();
    const resolved=await fs.realpath(profile);
    assert.ok(resolved.startsWith(root+path.sep));await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
