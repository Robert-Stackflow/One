const assert=require('node:assert/strict'),path=require('node:path');
const {expect}=require('@playwright/test');

module.exports=async function interactions(page,files){
 await page.evaluate(()=>{
  window.xlsxPaints=[];window.xlsxCopies=[];
  const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
   if(/^CELL_/.test(String(text))){
    const r=this.canvas.getBoundingClientRect(),m=this.getTransform(),point=m.transformPoint({x,y});
    window.xlsxPaints.push({text:String(text),x:r.x+point.x*r.width/this.canvas.width,y:r.y+point.y*r.height/this.canvas.height});
    if(window.xlsxPaints.length>20000)window.xlsxPaints.splice(0,10000);
   }
   return fill.call(this,text,x,y,...rest);
  };
  // Capture the actual copy handler without modifying the user's OS clipboard.
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.xlsxCopies.push(text)}});
 });
 await page.evaluate(file=>window.one.selectPreview(file),path.join(files,'zzz-interactions.xlsx'));
 await expect(page.locator('.xlsx-preview')).toHaveAttribute('data-state','ready');
 await page.waitForFunction(()=>window.xlsxPaints.some(p=>p.text==='CELL_4_2'));
 const grid=page.getByRole('region',{name:/Spreadsheet viewport/});
 const state=()=>page.evaluate(()=>({left:document.querySelector('[aria-label^="Spreadsheet viewport"]').scrollLeft,top:document.querySelector('[aria-label^="Spreadsheet viewport"]').scrollTop,paints:window.xlsxPaints.slice(-1000)}));
 const before=await state();
 assert.ok(before.paints.some(p=>p.text==='CELL_1_1'));
 assert.ok(!before.paints.some(p=>/^CELL_3_|^CELL_\d+_3$/.test(p.text)),'hidden row/column never painted');
 const target=before.paints.findLast(p=>p.text==='CELL_4_2');
 await page.mouse.click(target.x+20,target.y-4);
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'region');
 const copy=async()=>{const count=await page.evaluate(()=>window.xlsxCopies.length);await page.keyboard.press('Control+c');await page.waitForFunction(n=>window.xlsxCopies.length>n,count);return page.evaluate(()=>window.xlsxCopies.at(-1));};
 assert.equal(await copy(),'CELL_4_2');
 await page.keyboard.press('ArrowDown');assert.equal(await copy(),'CELL_5_2');
 await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowLeft');assert.equal(await copy(),'CELL_4_1');await page.keyboard.press('ArrowRight');assert.equal(await copy(),'CELL_4_2');
 await page.keyboard.type('123');await page.keyboard.press('Delete');
 await grid.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','REPLACEMENT');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 assert.equal(await copy(),'CELL_4_2','typing, deletion and paste preserve workbook contents');
 const center=await grid.boundingBox();await page.mouse.move(center.x+center.width/2,center.y+center.height/2);
 await page.evaluate(()=>{window.xlsxPaints=[];});await page.mouse.wheel(450,300);
 await expect.poll(async()=>{const s=await state();return s.left>0&&s.top>0;}).toBe(true);
 await page.waitForFunction(()=>window.xlsxPaints.some(p=>p.text==='CELL_1_1'));
 const after=await state(),frozen=points=>points.findLast(p=>p.text==='CELL_1_1');
 assert.ok(Math.abs(frozen(before.paints).x-frozen(after.paints).x)<1&&Math.abs(frozen(before.paints).y-frozen(after.paints).y)<1,'frozen corner stays in place after both-axis wheel scrolling');
 assert.ok(after.paints.some(p=>/^CELL_(?:[1-9]\d)_/.test(p.text)),'vertical wheel reveals later rows');
 assert.ok(after.paints.some(p=>/^CELL_1_(?:[5-9]|[1-9]\d)$/.test(p.text)),'horizontal wheel reveals later columns in frozen row');
 assert.ok(!after.paints.some(p=>/^CELL_3_|^CELL_\d+_3$/.test(p.text)));
 await page.evaluate(file=>window.one.selectPreview(file),path.join(files,'daily.xlsx'));
 await expect(page.locator('.xlsx-preview')).toHaveAttribute('data-state','ready');
 return {keyboardCopy:['CELL_4_2','CELL_5_2','CELL_4_2'],hiddenRow:3,hiddenColumn:'C',wheel:{left:after.left,top:after.top},frozenCorner:frozen(after.paints)};
};
