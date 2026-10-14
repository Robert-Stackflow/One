const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../installer/main.cjs'),'utf8');
const prepareSource=source.slice(source.indexOf('async function prepare(directory)'),source.indexOf('async function backupPrevious'));
function fixture(overrides={}){
  const events=[];
  const context=vm.createContext({installing:false,preparing:false,validDirectory:()=>true,send:value=>events.push(value),runningOne:async()=>[],install:async()=>{},console:{error(){}},...overrides});
  vm.runInContext(prepareSource,context);return {context,events};
}
test('installer preflight proceeds without depending on PowerShell token detection',async()=>{
  let installed=0;const {context,events}=fixture({install:async()=>{installed++;}});
  await context.prepare('D:\\One');assert.equal(installed,1);assert.equal(context.preparing,false);assert.deepEqual(events,[]);
});
test('concurrent installation requests share one preparation and installation',async()=>{
  let release,checks=0,installs=0;const wait=new Promise(resolve=>{release=resolve;});
  const {context}=fixture({runningOne:async()=>{checks++;await wait;return [];},install:async()=>{installs++;}});
  const first=context.prepare('D:\\One');await context.prepare('D:\\One');assert.equal(checks,1);
  release();await first;assert.equal(installs,1);assert.equal(context.preparing,false);
});
test('a failed process check is a preparation failure and remains retryable',async()=>{
  const {context,events}=fixture({runningOne:async()=>{throw Error('fixture process enumeration failure');}});
  await context.prepare('D:\\One');assert.equal(events.at(-1).reason,'preparation');assert.equal(context.preparing,false);
  let installed=false;context.runningOne=async()=>[];context.install=async()=>{installed=true;};await context.prepare('D:\\One');assert.equal(installed,true);
});
