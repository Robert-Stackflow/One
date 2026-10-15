const {_electron:electron}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('work/current/capture-reconstruction'),root=await fs.mkdtemp(path.join(output,'layout-window-'));let app;
  try{
    const bundle=await build({stdin:{contents:"export {imageTextLayout} from './src/shared/recognition/image-translation';export {renderImageTranslation} from './src/renderer/recognition/image-translation-render';",resolveDir:path.resolve('.'),sourcefile:'translation-layout-fixture.ts',loader:'ts'},bundle:true,platform:'browser',format:'iife',globalName:'TranslationLayoutFixture',write:false,logLevel:'warning'});
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);await page.evaluate(bundle.outputFiles[0].text);
    const result=await page.evaluate(async()=>{
      const {imageTextLayout,renderImageTranslation}=TranslationLayoutFixture,probe=document.createElement('canvas'),context=probe.getContext('2d');context.font='24px system-ui';
      const available=Math.ceil(context.measureText('界').width),measure=(text,size)=>{context.font=size+'px system-ui';return context.measureText(text).width;};
      const block={id:'p1',source:'original',text:'i i界',fontSize:24,status:'ready',rect:{x:8,y:8,width:available+4,height:180},glyphs:[[{x:8,y:8},{x:90,y:8},{x:90,y:48},{x:8,y:48}]]};
      const layout=imageTextLayout(block,measure),widths=layout.lines.map(line=>measure(line,layout.fontSize));
      const source=new ImageData(new Uint8ClampedArray(512*240*4).fill(255),512,240),value={schema:1,id:'layout',sourceId:'source',recognitionRevision:0,translationId:'job',width:512,height:240,target:'en',serviceRevision:'service',version:0,blocks:[{...block,text:'word '.repeat(12000),fontSize:80,rect:{x:8,y:8,width:320,height:100}}]};
      const original=CanvasRenderingContext2D.prototype.measureText;let current=true,calls=0,timer,cancelled=false,cancelAt=0,started=0,lastCanvas;
      CanvasRenderingContext2D.prototype.measureText=function(text){calls++;lastCanvas=this.canvas;if(calls===1){started=performance.now();timer=setTimeout(()=>{current=false;cancelAt=performance.now();},0);}return original.call(this,text);};
      try{const rendered=await renderImageTranslation(value,source,()=>current);rendered.canvas.width=rendered.canvas.height=0;}catch(error){cancelled=/已取消/.test(String(error));}finally{CanvasRenderingContext2D.prototype.measureText=original;clearTimeout(timer);probe.width=probe.height=0;}
      return {available,widths,overflow:layout.overflow,text:layout.lines.join(''),cancelled,calls,cancelLatencyMs:cancelAt-started,discardedCanvas:!!lastCanvas&&lastCanvas.width===0&&lastCanvas.height===0};
    });
    assert.equal(result.overflow,false);assert.ok(result.widths.every(width=>width<=result.available));assert.equal(result.text,'ii界');assert.equal(result.cancelled,true);assert.ok(result.calls>0&&result.calls<5000);assert.ok(result.cancelLatencyMs>=0&&result.cancelLatencyMs<1000);assert.equal(result.discardedCanvas,true);
    await fs.writeFile(path.join(output,'translation-layout-window-report.json'),JSON.stringify(result,null,2));console.log('Actual One canvas: system-font mixed-width wrap fits; 60,000-character composition yields to cancellation after '+result.calls+' measurements ('+result.cancelLatencyMs.toFixed(1)+'ms), discarded canvas released.');
  }finally{if(app)await app.close();const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('layout-window-'));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
