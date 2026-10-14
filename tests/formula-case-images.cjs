const fs=require('node:fs/promises'),path=require('node:path'),{_electron:electron}=require('@playwright/test'),katex=require('katex');
const cases=[
  {id:'fraction',latex:String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`},
  {id:'matrix',latex:String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`},
  {id:'piecewise',latex:String.raw`f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}`},
  {id:'scripts',latex:String.raw`\sum_{i=1}^{n}i^2=\frac{n(n+1)(2n+1)}{6}`},
  {id:'multiline',latex:String.raw`\begin{aligned}a+b&=c\\a-b&=d\end{aligned}`},
];
async function main(){
  const root=path.resolve('work/current/capture-reconstruction/formula/cases');await fs.mkdir(root,{recursive:true});let app;
  const entry=path.join(root,'render.cjs');await fs.writeFile(entry,`const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1000,height:600});window.loadFile(${JSON.stringify(path.join(root,'case.html'))});});`);
  const css='file:///'+path.resolve('node_modules/katex/dist/katex.min.css').replaceAll('\\','/');
  const html=item=>`<!doctype html><link rel="stylesheet" href="${css}"><style>body{margin:0;background:white}#formula{display:inline-block;font-size:32px;color:black;padding:16px}</style><div id="formula">${katex.renderToString(item.latex,{displayMode:true,throwOnError:true,trust:false})}</div>`;
  await fs.writeFile(path.join(root,'case.html'),html(cases[0]));
  try{const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[entry],env});const page=await app.firstWindow();
    for(const item of cases){await fs.writeFile(path.join(root,'case.html'),html(item));await page.reload();await page.evaluate(()=>document.fonts.ready);await page.locator('#formula').screenshot({path:path.join(root,item.id+'.png')});}
    await fs.writeFile(path.join(root,'cases.json'),JSON.stringify(cases,null,2));console.log('Five printed formula fixtures rendered with local KaTeX fonts.');
  }finally{await app?.close();}
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
