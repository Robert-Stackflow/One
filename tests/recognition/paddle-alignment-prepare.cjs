const {_electron:electron}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
(async()=>{
 const root=path.resolve(process.env.ONE_CTC_TEST_ROOT);await fs.mkdir(root,{recursive:true});
 const main=path.join(root,'main.cjs');await fs.writeFile(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});app.whenReady().then(()=>new BrowserWindow({show:false,width:1000,height:250}).loadURL('data:text/html,<meta charset=utf-8>'));`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({args:[main],env}),page=await app.firstWindow(),cases=[];
 try{
  for(const item of [
   {id:'variable',text:'WWW iii 2026, Abc 中文识别',font:'Arial, "Microsoft YaHei", sans-serif',size:40,width:1000,height:105,dark:false},
   {id:'mixed',text:'中文截图识别测试 sample@example.com',font:'"Microsoft YaHei", sans-serif',size:36,width:1000,height:105,dark:false},
   {id:'dark',text:'Paddle + OCR: 中文 / 2026',font:'"Microsoft YaHei", sans-serif',size:38,width:1000,height:105,dark:true},
   {id:'perspective',text:'WIDE iii 中英文 2026',font:'Arial, "Microsoft YaHei", sans-serif',size:40,width:1000,height:220,dark:false,transform:'perspective(700px) rotateY(15deg) rotateZ(7deg)'}
  ]){
   await page.setViewportSize({width:item.width,height:item.height});
   await page.setContent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#line{position:absolute;left:24px;top:24px;line-height:1;white-space:pre;transform-origin:0 0}</style><div id="line"></div>');
   const gt=await page.evaluate(async item=>{
    const el=document.querySelector('#line');el.textContent=item.text;Object.assign(el.style,{fontFamily:item.font,fontSize:item.size+'px',color:item.dark?'#eee':'#111'});document.body.style.background=item.dark?'#181818':'white';await document.fonts.ready;
    const node=el.firstChild,origin=el.getBoundingClientRect(),chars=[];let offset=0;
    for(const text of item.text){const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+text.length);const b=range.getBoundingClientRect();if(text.trim())chars.push({text,quad:[{x:b.left,y:b.top},{x:b.right,y:b.top},{x:b.right,y:b.bottom},{x:b.left,y:b.bottom}]});offset+=text.length;}
    el.style.transform=item.transform||'none';const matrix=new DOMMatrix(getComputedStyle(el).transform);
    for(const char of chars)char.quad=char.quad.map(point=>{const value=new DOMPoint(point.x-origin.left,point.y-origin.top).matrixTransform(matrix);return {x:origin.left+value.x/value.w,y:origin.top+value.y/value.w};});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {...item,chars};
   },item);
   const png=await page.screenshot({scale:'css'}),metadata=await sharp(png).metadata();if(metadata.width!==item.width||metadata.height!==item.height)throw Error('Unexpected screenshot pixel scale');
   await fs.writeFile(path.join(root,item.id+'.png'),png);cases.push(gt);
  }
  const base=cases[0],png=await fs.readFile(path.join(root,'variable.png'));
  for(const rotation of [90,180]){
   const image=await sharp(png).rotate(rotation).png().toBuffer(),metadata=await sharp(image).metadata();
   const transform=rotation===90?point=>({x:base.height-point.y,y:point.x}):point=>({x:base.width-point.x,y:base.height-point.y});
   cases.push({...base,id:'rotate-'+rotation,width:metadata.width,height:metadata.height,rotation,chars:base.chars.map(char=>({...char,quad:char.quad.map(transform)}))});
   await fs.writeFile(path.join(root,'rotate-'+rotation+'.png'),image);
  }
  const {createHash}=require('node:crypto');
  for(const item of cases)item.sha256=createHash('sha256').update(await fs.readFile(path.join(root,item.id+'.png'))).digest('hex');
  await fs.writeFile(path.join(root,'cases.json'),JSON.stringify({gate:{matchedCenterHit:.9,matchedCoverage:.9},cases},null,2));console.log('CTC corpus: 6 browser-rasterized cases with DOM glyph cells, perspective and rotations');
 }finally{await app.close();}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
