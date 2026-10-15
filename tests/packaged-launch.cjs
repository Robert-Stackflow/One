const path=require('node:path'),assert=require('node:assert/strict');
function electronLaunch(env){
  const clean={...env};delete clean.ELECTRON_RUN_AS_NODE;
  if(!process.env.ONE_PACKAGED_EXE)return {args:[path.resolve('.')],env:clean};
  delete clean.NODE_PATH;delete clean.NODE_OPTIONS;
  const executablePath=path.resolve(process.env.ONE_PACKAGED_EXE);return {executablePath,cwd:path.dirname(executablePath),env:clean};
}
async function verifyPackagedRuntime(app){
  if(!process.env.ONE_PACKAGED_EXE)return;
  const state=await app.evaluate(({app})=>{
    const path=process.getBuiltinModule('path'),load=process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
    return {packaged:app.isPackaged,version:app.getVersion(),electron:process.versions.electron,appPath:app.getAppPath(),executable:process.execPath,modules:Object.fromEntries(['sharp','onnxruntime-node','tesseract.js'].map(name=>[name,load.resolve(name)]))};
  });
  const executable=path.resolve(process.env.ONE_PACKAGED_EXE),resources=path.join(path.dirname(executable),'resources'),normalize=value=>path.resolve(value).toLowerCase();
  assert.equal(state.packaged,true,'The test must execute a packaged app');assert.equal(normalize(state.executable),normalize(executable));assert.equal(normalize(state.appPath),normalize(path.join(resources,'app.asar')));
  for(const [name,file] of Object.entries(state.modules))assert.ok(normalize(file).startsWith(normalize(resources)+path.sep),name+' must resolve inside the candidate, not the repository');
  if(process.env.ONE_PACKAGED_PROOF)await require('node:fs/promises').writeFile(path.resolve(process.env.ONE_PACKAGED_PROOF),JSON.stringify(state,null,2));
}
module.exports={electronLaunch,verifyPackagedRuntime};
