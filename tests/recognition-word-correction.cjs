const {expect}=require('@playwright/test'),assert=require('node:assert/strict');
const tokens=doc=>doc.blocks.flatMap(block=>block.lines.flatMap(line=>line.tokens)).sort((a,b)=>a.order-b.order);
module.exports=async function wordCorrection({app,page,baseline,inline=false,id}){
  const channel=inline?'one:inline-ocr-correct':'one:recognition-correct';
  await app.evaluate(({ipcMain},channel)=>{
    global.wordCorrections=[];const old=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);
    ipcMain.handle(channel,async(event,...args)=>{try{const result=await old(event,...args);global.wordCorrections.push({owner:event.sender.id,selection:args[1],result});return result;}catch(error){console.error('Word correction rejected:',String(error).slice(0,200));throw error;}});
  },channel);
  const original=page.locator(inline?'.inline-ocr-original':'#result'),button=page.getByRole('button',{name:'校正选中词',exact:true});
  await expect(button).toBeDisabled();await page.locator('[data-text-action=fit]').click();
  await page.locator('.text-selection-unit').filter({hasText:/^O$/}).first().click();await expect(button).toBeEnabled();
  const view=await page.locator('.text-image-stage').evaluate(node=>({width:node.style.width,height:node.style.height}));
  const workers=await app.evaluate(()=>global.regionWorkers?.length??global.inlineWorkers?.length??0);
  await button.click();const input=page.getByRole('textbox',{name:'校正文字',exact:true});await expect(input).toHaveValue('ONE');
  await input.fill('discarded draft');await input.press('Escape');await expect(input).toBeHidden();await expect(original).toHaveValue(baseline.text);
  await button.click();await input.fill('人工校正🌍');await input.press('Enter');await expect(input).toBeHidden();
  const record=await app.evaluate(()=>global.wordCorrections[0]);assert(record);const next=record.result,old=tokens(baseline.document),updated=tokens(next.document);
  const selected=old[record.selection.anchor],chosen=old.filter(token=>token.wordId===selected.wordId&&token.lineId===selected.lineId),head=updated.find(token=>token.id===chosen[0].id);
  assert.equal(head.text,'人工校正🌍');assert.equal(head.geometry,'word');assert.deepEqual(head.sourceQuads,chosen.map(token=>token.quad));
  assert.deepEqual(head.sourceGeometry,chosen.map(token=>token.geometry));
  const visual=page.locator('.text-selection-unit.selected');await expect(visual.locator('clipPath path')).toHaveCount(1);
  const pixels=await require('sharp')(await visual.screenshot({path:require('node:path').resolve('work/current/capture-reconstruction/word-correction-'+(inline?'inline':'standalone')+'.png')})).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let blue=0;for(let at=0;at<pixels.data.length;at+=pixels.info.channels){const r=pixels.data[at],g=pixels.data[at+1],b=pixels.data[at+2];if(b>150&&b-r>25&&g-r>15)blue++;}assert.ok(blue>20,'Corrected source polygons must still show the blue selection');
  if(chosen.some(token=>token.geometry==='ctc'))await expect(page.locator('.text-selection-unit.selected')).toHaveAttribute('aria-label',/位置近似/);
  for(const token of old.filter(token=>!chosen.includes(token))){const match=updated.find(value=>value.id===token.id);assert(match);assert.deepEqual(match.quad,token.quad);assert.equal(match.text,token.text);}
  assert.deepEqual(next.document.source,baseline.document.source);assert.deepEqual(next.document.blocks.map(block=>block.quad),baseline.document.blocks.map(block=>block.quad));
  assert.equal(next.document.revision,baseline.document.revision+1);assert.equal(next.document.corrections.at(-1).after,'人工校正🌍');
  assert.deepEqual(await page.locator('.text-image-stage').evaluate(node=>({width:node.style.width,height:node.style.height})),view);
  assert.equal(await app.evaluate(()=>global.regionWorkers?.length??global.inlineWorkers?.length??0),workers,'Correction must not start an OCR worker');
  await expect(original).toHaveValue(next.text);await page.locator('[data-text-action=copy]').click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'人工校正🌍');
  assert.equal(await original.evaluate(node=>node.value.slice(node.selectionStart,node.selectionEnd)),'人工校正🌍');
  await assert.rejects(page.evaluate(({id,selection,inline})=>inline?window.one.inlineOCR.correct(id,selection,'stale'):window.one.recognition.correct(id,selection,'stale'),{id,selection:record.selection,inline}),/已改变/);
  await button.click();await input.fill('bad\nline');
  // HTML text inputs normalize newlines; use the API to verify malformed edits and the UI for an empty draft.
  await assert.rejects(page.evaluate(({id,selection,inline})=>inline?window.one.inlineOCR.correct(id,selection,'bad\nline'):window.one.recognition.correct(id,selection,'bad\nline'),{id,selection:{revision:next.document.revision,anchor:updated.indexOf(head),focus:updated.indexOf(head)},inline}),/换行/);
  await input.fill('');await input.press('Enter');await expect(input).toBeVisible();await expect(input).toBeEnabled();await expect(original).toHaveValue(next.text);
  await input.fill('ONE');await input.press('Enter');await expect(input).toBeHidden();await expect(original).toHaveValue(baseline.text);
  const final=await app.evaluate(()=>global.wordCorrections.at(-1).result);assert.equal(final.document.revision,next.document.revision+1);
  await button.click();await input.fill('pending');await page.locator('.text-selection-unit').filter({hasText:/^C$/}).first().click();await expect(input).toBeHidden();
  console.log((inline?'Inline':'Standalone')+' word correction: source coverage/untouched geometry, offsets, copy, rotated view, cancel, stale/malformed rejection, failed draft/retry and no inference passed');
};
