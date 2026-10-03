import {spawn,execFile} from 'node:child_process';
import {watch} from 'node:fs';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {context} from 'esbuild';
import electron from 'electron';
import {mainOptions,preloadOptions} from './bundle-options.mjs';
import {workspace} from './workspace.mjs';
const root=resolve('.'),work=await workspace(),temp=work.temp;
const env={...process.env,TEMP:temp,TMP:temp,ONE_DEVELOPMENT:'1',ONE_DATA_DIR:process.env.ONE_DATA_DIR||join(work.root,'dev-profile')};delete env.ELECTRON_RUN_AS_NODE;
// A verified current build can be reused when restarting development watchers.
// This avoids replacing native helpers still used by another development app.
if(process.argv.includes('--reuse-build')){
 for(const file of ['dist/main/index.cjs','dist/preload/index.cjs','dist/renderer/index.html',...['One.Native','One.Search','One.Index','One.Windows','One.OpenWith','One.Monitor','One.Levels','One.Dialog32'].map(name=>'dist/native/'+name+'.exe'),'dist/native/One.Dialog.dll','dist/native/One.Dialog32.dll'])await stat(file);
}else await promisify(execFile)('cmd.exe',['/d','/c',resolve('scripts/build-windows.cmd')],{cwd:root,env,windowsHide:true,maxBuffer:4*1024*1024}).then(result=>{process.stdout.write(result.stdout);process.stderr.write(result.stderr);});
let child,stopping=false,restarting=false,timer,rendererTimer,rendererBuild,rendererBuildDone=Promise.resolve(),rendererDirty=false;const contexts=[],rendererWatchers=[];
function launch(){const args=['.'];if(process.env.ONE_DEV_DEBUG_PORT)args.unshift('--remote-debugging-address=127.0.0.1','--remote-debugging-port='+process.env.ONE_DEV_DEBUG_PORT);child=spawn(electron,args,{cwd:root,env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:false});child.on('error',error=>{console.error(error);void finish(1);});child.once('exit',code=>{child=undefined;if(restarting&&!stopping){restarting=false;launch();}else void finish(code??0);});}
function changed(restart){clearTimeout(timer);restarting ||= restart;timer=setTimeout(()=>{if(stopping||!child?.connected)return;if(restarting){console.log('主进程已更新，等待应用正常退出后重启…');child.send({type:'one:dev-quit'});}else{console.log('界面已更新');child.send({type:'one:dev-reload'});}},180);}
function plugin(){let initial=true;return{name:'one-development',setup(builder){builder.onEnd(result=>{if(initial){initial=false;return;}if(!result.errors.length)changed(true);});}};}
async function finish(code=0){if(stopping)return;stopping=true;clearTimeout(timer);clearTimeout(rendererTimer);for(const watcher of rendererWatchers)watcher.close();if(child?.connected)child.send({type:'one:dev-quit'});await Promise.all(contexts.map(c=>c.dispose()));await rendererBuildDone;process.exitCode=code;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void finish());
launch();
for(const options of [mainOptions,preloadOptions]){const current=await context({...options,plugins:[plugin()]});contexts.push(current);await current.watch();}
// Run renderer builds in short-lived processes. Vite retains the entire module
// graph in build-watch mode, even when One is idle.
function buildRenderer(){
 rendererTimer=undefined;if(stopping||rendererBuild||!rendererDirty)return;
 rendererDirty=false;
 const build=spawn(process.execPath,['scripts/build-renderer.mjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
 rendererBuild=build;
 rendererBuildDone=new Promise(resolve=>build.once('close',resolve));
 build.on('error',error=>console.error('界面构建失败',error));
 build.once('close',code=>{
  rendererBuild=undefined;
  if(stopping)return;
  if(rendererDirty){buildRenderer();return;}
  if(code===0)changed(false);else console.error('界面构建失败；修改源码后重试');
 });
}
function rendererChanged(){
 if(stopping)return;
 rendererDirty=true;
 clearTimeout(rendererTimer);
 rendererTimer=setTimeout(buildRenderer,120);
}
for(const directory of ['src/renderer','src/shared']){
 const watcher=watch(directory,{recursive:true},rendererChanged);
 watcher.on('error',error=>console.error('界面文件监听失败',error));
 rendererWatchers.push(watcher);
}
console.log('Electron 开发模式已启动；界面自动刷新，主进程自动重启。');
