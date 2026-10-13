const {_electron:electron,expect}=require('@playwright/test');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-migration/annotation-renderer');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'fixture-'));let app;
  const assetName='annotation-test-'+path.basename(profile)+'.js',asset=path.resolve('dist/renderer/assets',assetName);
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const bundle=await build({stdin:{contents:`export {paintAnnotations} from './src/renderer/editor/capture-paint';export {ImageHistory} from './src/shared/capture/image-document';export {textOutline} from './src/shared/capture/text-outline';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'annotationTest',write:false,loader:{'.css':'empty'},logLevel:'silent'});
  try{
    await fs.writeFile(asset,bundle.outputFiles[0].text,{flag:'wx'});
    app=await electron.launch({args:[path.resolve('.')],env});let page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);
    await page.addScriptTag({url:'one://app/assets/'+assetName});
    const report=await page.evaluate(()=>{
      const {paintAnnotations,ImageHistory,textOutline}=annotationTest;
      const sample=document.createElement('canvas');sample.width=400;sample.height=160;const background=sample.getContext('2d');
      background.fillStyle='#f8f8f8';background.fillRect(0,0,200,160);background.fillStyle='#181818';background.fillRect(200,0,200,160);
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=160;const context=canvas.getContext('2d');
      const mark={id:'text',tool:'text',color:'#ffffff',width:3,strength:12,fontSize:32,fontFamily:'Arial',fontWeight:400,textOutline:true,text:'One',start:{x:30,y:40},end:{x:100,y:80},points:[]};
      const scene={...new ImageHistory(400,160,true).value,annotations:[mark]};
      const edges=[],original=context.strokeText.bind(context);context.strokeText=(...args)=>{edges.push({color:context.strokeStyle,width:context.lineWidth});original(...args);};
      const draw=()=>{context.clearRect(0,0,400,160);paintAnnotations(context,scene,sample);};
      draw();const light={...edges.at(-1)};
      const outlined=context.getImageData(0,0,400,160).data;
      mark.textOutline=false;draw();const plain=context.getImageData(0,0,400,160).data;
      let addedInk=0;for(let i=3;i<plain.length;i+=4)if(outlined[i]>plain[i]+5)addedInk++;
      mark.textOutline=true;mark.transform=[1,0,0,1,210,0];draw();const dark={...edges.at(-1)};
      // Playback receives a frame in document coordinates instead of the screenshot source.
      context.clearRect(0,0,400,160);paintAnnotations(context,scene,undefined,sample);const recording={...edges.at(-1)};
      context.scale(1.5,1.5);draw();const zoomed={...edges.at(-1)};context.resetTransform();
      const low=textOutline('#ffffff',32,Array(48).fill([248,248,248]));
      const high=textOutline('#ffffff',32,Array(48).fill([24,24,24]));
      return {light,dark,recording,zoomed,addedInk,low,high};
    });
    assert(report.addedInk>50,'Outline must add visible pixels outside the glyph');
    assert(report.light.width>report.dark.width,'Low contrast background should strengthen the outline');
    assert.notEqual(report.light.color,report.dark.color,'Moving the text must resample its background');
    assert.deepEqual(report.recording,report.dark,'Screenshot and recording must use the same local background');
    assert.deepEqual(report.zoomed,report.dark,'Zoom must not change background sampling');
    assert(report.low.width>report.high.width);
    const preferred={color:'#eddd66',fontSize:32,fontWeight:700,italic:true,textOutline:true};
    await page.evaluate(style=>window.one.patchSettings({capture:{annotationStyles:{text:style,brush:{width:8}}}}),preferred);
    await app.evaluate(({app})=>app.exit(0));await app.close();app=undefined;
    app=await electron.launch({args:[path.resolve('.')],env});page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);
    const saved=await page.evaluate(async()=>(await window.one.settings()).capture.annotationStyles);
    for(const [name,value] of Object.entries(preferred))assert.equal(saved.text[name],value);
    assert.equal(saved.brush.width,8);assert.equal(saved.rectangle.width,3);
    await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report,null,2));
    console.log('Annotation renderer: background-aware ink, moved/zoomed text, recording parity and preferences after app restart PASS');
  }finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    await fs.rm(asset,{force:true});
    const actual=await fs.realpath(profile);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
