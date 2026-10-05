const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {buildSync}=require('esbuild');

async function main(){
 const output=path.resolve('work/rename-throughput');await fs.mkdir(output,{recursive:true});
 const root=await fs.mkdtemp(path.join(output,'files-')),profile=await fs.mkdtemp(path.join(output,'profile-'));
 const total=Number(process.env.ONE_RENAME_COUNT||200);if(!Number.isInteger(total)||total<1||total>5000)throw Error('Invalid benchmark size');
 const bundle=path.join(output,'service.cjs');buildSync({stdin:{contents:"export {FileToolsService} from './src/main/file-tools-service';export {defaultRename} from './src/shared/file-tools';",resolveDir:path.resolve('.')},outfile:bundle,bundle:true,platform:'node',target:'node22',external:['koffi','pdfjs-dist/legacy/build/pdf.mjs']});
 await fs.copyFile('dist/main/file-tools-worker.cjs',path.join(output,'file-tools-worker.cjs'));
 const {FileToolsService,defaultRename}=require(bundle),service=new FileToolsService(profile,()=>{});
 try{
  await Promise.all(Array.from({length:total},(_,i)=>fs.writeFile(path.join(root,`old-${String(i).padStart(5,'0')}.txt`),'fixture')));
  const task={kind:'rename-preview',paths:[root],recursive:false,files:true,folders:false,options:{...defaultRename(),search:'old',replace:'new'}};
  let start=performance.now();const preview=await service.run(1,task),previewMs=performance.now()-start;
  if(preview.stats.changes!==total)throw Error('Unexpected preview count');
  start=performance.now();const applied=await service.run(1,{kind:'rename-apply',report:preview.id}),applyMs=performance.now()-start;
  start=performance.now();await service.run(1,{kind:'rename-undo',receipt:applied.id});const undoMs=performance.now()-start;
  if((await fs.readdir(root)).filter(name=>name.startsWith('old-')).length!==total)throw Error('Undo did not restore all files');
  const result={total,previewMs:Math.round(previewMs),applyMs:Math.round(applyMs),undoMs:Math.round(undoMs),perFileApplyMs:Math.round(applyMs/total*100)/100};
  await fs.writeFile(path.join(output,'current.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await service.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
