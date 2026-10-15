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
      const directions=[];
      for(const dark of [false,true])for(const [text,target] of [['One 123','en'],['你好 One','zh-Hans'],['مرحبا One','ar'],['First\nSecond','en']]){
        const pixels=new Uint8ClampedArray(256*256*4);for(let index=0;index<pixels.length;index+=4){pixels[index]=pixels[index+1]=pixels[index+2]=dark?30:255;pixels[index+3]=255;}
        const input=new ImageData(pixels,256,256),base={...block,text,fontSize:24,rect:{x:30,y:35,width:180,height:56},glyphs:[[{x:32,y:37},{x:202,y:37},{x:202,y:77},{x:32,y:77}]]};
        const doc={schema:1,id:'directions',sourceId:'source',recognitionRevision:0,translationId:'job',width:256,height:256,target,serviceRevision:'service',version:0,blocks:[base]};
        const reference=await renderImageTranslation(doc,input,()=>true);
        for(const rotation of [0,90,180,270]){
          const point=({x,y})=>rotation===90?{x:256-y,y:x}:rotation===180?{x:256-x,y:256-y}:rotation===270?{x:y,y:256-x}:{x,y};
          const {x,y,width,height}=base.rect,corners=[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}].map(point);
          const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),rotated={...base,rect:{x:left,y:top,width:rotation%180?height:width,height:rotation%180?width:height},glyphs:base.glyphs.map(quad=>quad.map(point))};
          const rendered=await renderImageTranslation({...doc,blocks:[rotated]},input,()=>true),expected=document.createElement('canvas');expected.width=expected.height=256;
          const ctx=expected.getContext('2d');ctx.translate(rotation===90||rotation===180?256:0,rotation===180||rotation===270?256:0);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(reference.canvas,0,0);
          const actual=rendered.canvas.getContext('2d').getImageData(0,0,256,256).data,wanted=ctx.getImageData(0,0,256,256).data;
          let difference=0,ink=0,outside=0;for(let index=0;index<actual.length;index+=4){const px=index/4%256,py=Math.floor(index/4/256),inside=px>=left&&px<left+rotated.rect.width&&py>=top&&py<top+rotated.rect.height;for(let channel=0;channel<4;channel++){difference+=Math.abs(actual[index+channel]-wanted[index+channel]);if(!inside&&actual[index+channel]!==pixels[index+channel])outside++;}if(inside&&Math.abs(actual[index]-pixels[index])>30)ink++;}
          directions.push({rotation,target,dark,meanError:difference/actual.length,ink,outside,overflow:rendered.overflow.size});rendered.canvas.width=rendered.canvas.height=expected.width=expected.height=0;
        }
        reference.canvas.width=reference.canvas.height=0;
      }
      const source=new ImageData(new Uint8ClampedArray(512*240*4).fill(255),512,240),value={schema:1,id:'layout',sourceId:'source',recognitionRevision:0,translationId:'job',width:512,height:240,target:'en',serviceRevision:'service',version:0,blocks:[{...block,text:'word '.repeat(12000),fontSize:80,rect:{x:8,y:8,width:320,height:100}}]};
      const original=CanvasRenderingContext2D.prototype.measureText;let current=true,calls=0,timer,cancelled=false,cancelAt=0,started=0,lastCanvas;
      CanvasRenderingContext2D.prototype.measureText=function(text){calls++;lastCanvas=this.canvas;if(calls===1){started=performance.now();timer=setTimeout(()=>{current=false;cancelAt=performance.now();},0);}return original.call(this,text);};
      try{const rendered=await renderImageTranslation(value,source,()=>current);rendered.canvas.width=rendered.canvas.height=0;}catch(error){cancelled=/已取消/.test(String(error));}finally{CanvasRenderingContext2D.prototype.measureText=original;clearTimeout(timer);probe.width=probe.height=0;}
      return {available,widths,overflow:layout.overflow,text:layout.lines.join(''),directions,cancelled,calls,cancelLatencyMs:cancelAt-started,discardedCanvas:!!lastCanvas&&lastCanvas.width===0&&lastCanvas.height===0};
    });
    assert.equal(result.overflow,false);assert.ok(result.widths.every(width=>width<=result.available));assert.equal(result.text,'ii界');assert.equal(result.cancelled,true);assert.ok(result.calls>0&&result.calls<5000);assert.ok(result.cancelLatencyMs>=0&&result.cancelLatencyMs<1000);assert.equal(result.discardedCanvas,true);
    assert.equal(result.directions.length,32);for(const item of result.directions){assert.ok(item.meanError<4,JSON.stringify(item));assert.ok(item.ink>20,JSON.stringify(item));assert.equal(item.outside,0,JSON.stringify(item));assert.equal(item.overflow,0,JSON.stringify(item));}
    await fs.writeFile(path.join(output,'translation-layout-window-report.json'),JSON.stringify(result,null,2));console.log('Actual One canvas: system-font mixed-width wrap fits; 60,000-character composition yields to cancellation after '+result.calls+' measurements ('+result.cancelLatencyMs.toFixed(1)+'ms), discarded canvas released.');
  }finally{if(app)await app.close();const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('layout-window-'));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
