import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir,rm,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {context} from 'esbuild';
import {build} from 'vite';
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
let child,stopping=false,restarting=false,timer;const contexts=[];let renderer;
function launch(){const args=['.'];if(process.env.ONE_DEV_DEBUG_PORT)args.unshift('--remote-debugging-address=127.0.0.1','--remote-debugging-port='+process.env.ONE_DEV_DEBUG_PORT);child=spawn(electron,args,{cwd:root,env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:true});child.on('error',error=>{console.error(error);void finish(1);});child.once('exit',code=>{child=undefined;if(restarting&&!stopping){restarting=false;launch();}else void finish(code??0);});}
function changed(restart){clearTimeout(timer);restarting ||= restart;timer=setTimeout(()=>{if(stopping||!child?.connected)return;if(restarting){console.log('主进程已更新，等待应用正常退出后重启…');child.send({type:'one:dev-quit'});}else{console.log('界面已更新');child.send({type:'one:dev-reload'});}},180);}
function plugin(){let initial=true;return{name:'one-development',setup(builder){builder.onEnd(result=>{if(initial){initial=false;return;}if(!result.errors.length)changed(true);});}};}
async function finish(code=0){if(stopping)return;stopping=true;clearTimeout(timer);if(child?.connected)child.send({type:'one:dev-quit'});await Promise.all(contexts.map(c=>c.dispose()));await renderer?.close();process.exitCode=code;}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void finish());
launch();
for(const options of [mainOptions,preloadOptions]){const current=await context({...options,plugins:[plugin()]});contexts.push(current);await current.watch();}
renderer=await build({root:'src/renderer',base:'./',plugins:[{name:'one-prune-current-build',async writeBundle(_options,bundle){const keep=new Set(Object.keys(bundle));for(const item of await readdir('dist/renderer/assets',{withFileTypes:true}).catch(()=>[]))if(item.isFile()&&!keep.has('assets/'+item.name))await rm(join('dist/renderer/assets',item.name));}}],build:{outDir:'../../dist/renderer',emptyOutDir:false,watch:{}},logLevel:'warn'});
let initial=true;renderer.on('event',event=>{if(event.code==='ERROR')console.error(event.error);if(event.code!=='END')return;if(initial){initial=false;return;}changed(false);});
console.log('Electron 开发模式已启动；界面自动刷新，主进程自动重启。');
