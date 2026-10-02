const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{build}=require('esbuild');
async function load(){const bundle=await build({entryPoints:['src/main/menu-confirmation.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']}),m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,id=>id==='electron'?{screen:{getCursorScreenPoint:()=>({x:10,y:10}),getDisplayNearestPoint:()=>({workArea:{x:-100,y:0,width:1000,height:800}})}}:require(id));return m.exports.MenuConfirmation;}
class Window extends EventEmitter{constructor(id){super();this.webContents=new EventEmitter();this.webContents.id=id;this.closed=false;}isDestroyed(){return this.closed;}close(){this.closed=true;this.emit('closed');}getBounds(){return{width:420,height:280,x:0,y:0};}setBounds(bounds){this.bounds=bounds;}show(){this.shown=true;}moveTop(){}focus(){this.focused=true;}}
const command={id:'shutdown',label:'关机',confirm:'请先保存文件',icon:'power'};
test('确认窗口拒绝其他来源，关闭/替换/退出均取消，只有显式确认返回 true',async()=>{
 const Confirm=await load(),windows=[],service=new Confirm(()=>{const window=new Window(windows.length+1);windows.push(window);return window;});
 const first=service.request(command);assert.throws(()=>service.answer(999,true));assert.equal(service.data(1).label,'关机');windows[0].emit('ready-to-show');assert.equal(windows[0].shown,true);assert.equal(windows[0].bounds.x,190);windows[0].close();assert.equal(await first,false);
 const second=service.request(command),third=service.request(command);assert.equal(await second,false);service.answer(3,true);assert.equal(await third,true);assert.throws(()=>service.answer(3,true));
 const fourth=service.request(command);service.stop();assert.equal(await fourth,false);assert.equal(await service.request(command),false);assert.equal(windows.length,4);
});
