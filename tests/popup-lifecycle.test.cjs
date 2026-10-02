const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{buildSync}=require('esbuild'),path=require('node:path'),fs=require('node:fs');
const file=path.resolve('work/tests/popup-lifecycle.cjs');fs.mkdirSync(path.dirname(file),{recursive:true});
buildSync({entryPoints:['src/main/popup-lifecycle.ts'],outfile:file,bundle:true,platform:'node'});
const {PopupLifecycle,PopupReadiness,deferPopupBlur}=require(file);
class Window extends EventEmitter{
 constructor(){super();this.visible=false;this.destroyed=false;this.calls=0;}
 isVisible(){return this.visible;}isDestroyed(){return this.destroyed;}
 show(){this.visible=true;this.emit('show');}hide(){this.visible=false;this.emit('hide');}
 destroy(){this.calls++;this.destroyed=true;this.emit('closed');}
}
test('a cold popup waits for its first paint',()=>{const w=new Window(),ready=new PopupReadiness(w);ready.run(()=>w.show());assert.equal(w.visible,false);w.emit('ready-to-show');assert.equal(w.visible,true);});
test('a prepainted popup does not wait for another ready event while loading',()=>{const w=new Window();w.webContents={isLoading:()=>true};const ready=new PopupReadiness(w);w.emit('ready-to-show');ready.run(()=>w.show());assert.equal(w.visible,true);});
test('a popup destroyed before its first paint never shows',()=>{const w=new Window(),ready=new PopupReadiness(w);let shows=0;ready.run(()=>shows++);w.destroy();w.emit('ready-to-show');ready.run(()=>shows++);assert.equal(shows,0);});
test('hidden popup reclamation preserves visible/reopened windows and stops on shutdown',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const pool=new PopupLifecycle(45),cold=new Window(),visible=new Window();visible.show();pool.track(cold);pool.track(cold);pool.track(visible);
 t.mock.timers.tick(45);assert.equal(cold.calls,1);assert.equal(visible.calls,0);
 visible.hide();t.mock.timers.tick(20);visible.show();t.mock.timers.tick(100);assert.equal(visible.calls,0);
 visible.hide();t.mock.timers.tick(44);visible.hide();assert.equal(visible.calls,0);t.mock.timers.tick(1);assert.equal(visible.calls,1,'Repeated hide events must not extend the original idle deadline');
 const stopped=new Window();pool.track(stopped);pool.stop();stopped.show();stopped.hide();t.mock.timers.tick(100);assert.equal(stopped.calls,0);
 const afterStop=new Window();pool.track(afterStop);t.mock.timers.tick(100);assert.equal(afterStop.calls,0);
});

test('blur timers from hidden or destroyed menus cannot dismiss another menu',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const hidden=new Window(),destroyed=new Window();hidden.show();destroyed.show();let checks=0,dismissed=0;
 const current=()=>{checks++;return true;},dismiss=()=>{dismissed++;};
 deferPopupBlur(hidden,current,dismiss,100);deferPopupBlur(destroyed,current,dismiss,100);
 hidden.hide();destroyed.destroy();t.mock.timers.tick(100);
 assert.equal(checks,0);assert.equal(dismissed,0);
});

test('a replaced popup session invalidates an older blur timer even when reshown',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const window=new Window();window.show();let session=1,dismissed=0;const previous=session;
 deferPopupBlur(window,()=>session===previous,()=>{dismissed++;},100);
 window.hide();session++;window.show();t.mock.timers.tick(100);
 assert.equal(dismissed,0);
});

test('current visible popup closes after an outside blur but retains cascade focus',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const window=new Window();window.show();let cascadeFocused=true,dismissed=0;
 deferPopupBlur(window,()=>!cascadeFocused,()=>{dismissed++;},100);t.mock.timers.tick(100);
 assert.equal(dismissed,0);
 cascadeFocused=false;deferPopupBlur(window,()=>!cascadeFocused,()=>{dismissed++;window.hide();},100);
 t.mock.timers.tick(99);assert.equal(dismissed,0);t.mock.timers.tick(1);assert.equal(dismissed,1);t.mock.timers.tick(100);assert.equal(dismissed,1);
});
