const {_electron:electron}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),{build}=require('esbuild'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/picker-geometry-native');await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'profile-')),env={...process.env,ONE_DATA_DIR:profile,ONE_TEST_MODE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 await build({entryPoints:['src/shared/picker.ts'],outfile:path.join(out,'placement.cjs'),bundle:true,platform:'node'});const restore=require(path.join(out,'placement.cjs')).restorePickerBounds.toString();
 const app=await electron.launch({args:[path.resolve('.')],env});try{
  const result=await app.evaluate(({BrowserWindow,screen},source)=>{
   BrowserWindow.getAllWindows().forEach(w=>w.hide());const area=screen.getPrimaryDisplay().workArea,bounds={x:area.x+20,y:area.y+20,width:942,height:680};
   const w=new BrowserWindow({show:false,titleBarStyle:'hidden',frame:true,thickFrame:true,roundedCorners:true,...bounds}),capture=()=>({bounds:w.getBounds(),normal:w.getNormalBounds(),content:w.getContentBounds()});
   const sequence=[{kind:'constructor',...capture()}],restore=(0,eval)('('+source+')');
   for(let i=0;i<20;i++){restore(w,bounds);sequence.push({kind:'restore '+i,...capture()});}
   w.hide();w.destroy();return{area,requested:bounds,sequence};
  },restore);for(const sample of result.sequence.slice(1))assert.deepEqual(sample.bounds,result.requested);await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:'PASS',restorations:20,constructor:result.sequence[0].bounds,restored:result.sequence[1].bounds}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
