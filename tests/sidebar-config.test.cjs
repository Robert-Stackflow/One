const assert=require('node:assert/strict'),{buildSync}=require('esbuild');
const bundle=entry=>{const code=buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,external:['electron'],logLevel:'silent'}).outputFiles[0].text,m={exports:{}};new Function('require','module','exports',code)(id=>id==='electron'?{screen:{},BrowserWindow:class{}}:require(id),m,m.exports);return m.exports;};
const {defaultSidebar,validateSidebar}=bundle('src/shared/sidebar.ts'),defaults=defaultSidebar();
assert.equal(defaults.order.tools[0],'ai');assert.equal(defaults.pinned.length,12);
const partial=validateSidebar({collapsed:{files:true},order:{system:['hardware','system']},pinned:[]});assert.equal(partial.collapsed.files,true);assert.equal(partial.collapsed.tools,false);assert.deepEqual(partial.order.system,['hardware','system','ports']);assert.deepEqual(partial.pinned,[]);
for(const invalid of [{order:{files:['ai']}},{order:{files:['search','search']}},{pinned:['unknown']},{pinned:['tools','tools']},{collapsed:{files:'yes'}},{collapsed:{unknown:true}},{unknown:[]},null])assert.throws(()=>validateSidebar(invalid));
const settings=bundle('src/shared/settings.ts'),legacy=settings.defaultSettings();delete legacy.sidebar;assert.deepEqual(settings.validateSettings(legacy).sidebar,defaults);
const current=settings.defaultSettings();current.sidebar=partial;assert.deepEqual(settings.validateSettings(current).sidebar,partial);
const {trayMenuBounds,trayMoreBounds}=bundle('src/main/tray-menu-panel.ts');let placements=0;
for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1280,y:150,width:1280,height:720},{x:0,y:0,width:280,height:360}])for(const point of [[area.x,area.y],[area.x+area.width-10,area.y+area.height-10]]){
 const root=trayMenuBounds({x:point[0],y:point[1],width:10,height:10},area,10),more=trayMoreBounds(root,280,area,11,3);
 for(const b of [root,more]){assert.ok(b.x>=area.x&&b.y>=area.y&&b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);placements++;}
}
const {trayMenuEntries,trayMenuMoreEntries,trayMenuHeaderAction}=bundle('src/main/tray-menu.ts'),state={paused:false,launchAtLogin:false},root=trayMenuEntries(state),more=trayMenuMoreEntries(state),header=trayMenuHeaderAction(state);
assert.equal(root.length,10);assert.equal(more.length,11);assert.deepEqual(root.slice(-4).map(v=>v.label),['设置','开机自启动','重启 One','退出 One']);const ids=[...root,...more,header].map(v=>v.id);assert.equal(new Set(ids).size,22);
const tooltip=bundle('src/shared/native-tooltip.ts'),data={bounds:{x:0,y:0,width:80,height:30},text:'提示',side:'top',arrow:40,font:'11px sans-serif',theme:'dark'};assert.equal(tooltip.nativeTooltipData(data).theme,'dark');assert.throws(()=>tooltip.nativeTooltipData({...data,theme:'unknown'}));

const {capturePinBounds}=bundle('src/shared/capture/pin-placement.ts'),{initialPinView,pinBounds}=bundle('src/shared/pins.ts');
const source={x:-2560,y:0,width:2560,height:1440},selection={x:300,y:200,width:800,height:600};
assert.deepEqual(capturePinBounds(source,{width:2560,height:1440},selection,{width:896,height:696,x:48,y:48}),{x:-2308,y:152,width:896,height:696});
assert.equal(capturePinBounds(undefined,{width:800,height:600},selection,{width:800,height:600,x:0,y:0}),undefined);
const content={kind:'image',hash:'fixture',width:1920,height:1080},captured={x:-1000,y:100,width:1280,height:720},pinView=initialPinView(content,{x:50,y:50},{x:0,y:0,width:1920,height:1080},captured);assert.deepEqual(pinBounds(content,pinView),captured);assert.ok(initialPinView(content,{x:50,y:50},{x:0,y:0,width:1920,height:1080}).scale<pinView.scale);

console.log(JSON.stringify({result:'PASS',legacySettings:true,partialMigration:true,invalidSettings:8,placements,trayActions:ids.length,nativeTooltipTheme:true}));
