const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const bundle=buildSync({stdin:{contents:`export * from './src/shared/settings'; export * from './src/shared/capture/custom-capture';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const loaded={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(loaded,loaded.exports,require);
const {defaultSettings,validateSettings,mergeSettings,customCaptureSelection}=loaded.exports;

test('One settings preserve complete capture workflows, watermark and custom selection through edits and backup JSON',()=>{
  const original=defaultSettings(),unchanged=structuredClone(original);
  const workflow={...original.capture.workflows[0],id:'translated',name:'  识别并翻译  ',actions:['save','ocr','translate','library'],translationTarget:'ja'};
  const edited=mergeSettings(original,{capture:{workflows:[workflow],workflowId:'translated',watermark:{text:'Review',fontWeight:700},custom:{delayed:true,delay:1.5,position:true,x:20,y:30,width:500,height:500},remoteCompatible:false,uiScale:125}});
  assert.deepEqual(original,unchanged);
  assert.equal(edited.capture.workflows[0].name,'识别并翻译');
  assert.deepEqual(edited.capture.workflows[0].actions,['save','ocr','translate','library']);
  assert.equal(edited.capture.workflows[0].translationTarget,'ja');
  assert.equal(edited.capture.watermark.text,'Review');assert.equal(edited.capture.watermark.fontWeight,700);
  assert.equal(edited.capture.watermark.opacity,original.capture.watermark.opacity);
  assert.deepEqual(customCaptureSelection(edited.capture.custom,1920,1080),{x:20,y:30,width:500,height:500});
  const backup=JSON.parse(JSON.stringify({format:'one-settings-backup',schema:1,settings:edited}));
  assert.deepEqual(validateSettings(backup.settings),edited);
  const other=structuredClone(edited);delete other.capture;
  const before=structuredClone(original);delete before.capture;assert.deepEqual(other,before);
  assert.equal(Object.hasOwn(edited,'frame'),false);
});

test('One preferences with no capture fields gain fresh defaults without source-product field mapping',()=>{
  const saved=defaultSettings();delete saved.capture;
  saved.captureWorkflows=[{id:'legacy',name:'不迁入'}];
  const restored=validateSettings(saved);
  assert.deepEqual(restored.capture,defaultSettings().capture);
  assert.equal(Object.hasOwn(restored,'captureWorkflows'),false);
  const fresh=defaultSettings();restored.capture.workflows[0].actions.push('save');
  assert.deepEqual(fresh.capture.workflows[0].actions,['copy']);
  assert.throws(()=>mergeSettings(fresh,{frame:{}}),/未知设置/);
  assert.throws(()=>mergeSettings(fresh,{capture:{key:'secret'}}),/未知设置/);
});

test('Invalid capture edits reject the whole patch and keep the saved workflow and geometry intact',()=>{
  const current=defaultSettings(),before=structuredClone(current),workflow=current.capture.workflows[0];
  for(const capture of [
    {workflows:[]},{workflowId:'missing'},{workflows:[workflow,workflow]},
    {workflows:[{...workflow,actions:['save','save']}]},
    {workflows:[{...workflow,actions:['translate'],translationTarget:'unsupported'}]},
    {watermark:{opacity:2}},{custom:{delay:61}},{custom:{width:1}},
    {custom:{presets:[{width:100,height:100},{width:100,height:100}]}},
    {uiScale:115},{remoteCompatible:'yes'},
  ])assert.throws(()=>mergeSettings(current,{capture}));
  assert.deepEqual(current,before);
  assert.throws(()=>customCaptureSelection({...current.capture.custom,width:3000},1920,1080),/超出/);
  assert.equal(customCaptureSelection({...current.capture.custom,position:false,size:false},1920,1080),undefined);
});
