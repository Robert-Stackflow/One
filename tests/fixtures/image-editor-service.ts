import {app,BrowserWindow,dialog,ipcMain,nativeImage,protocol,session} from 'electron';
import {join,resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ImageEditorService} from '../../src/main/capture/image-editor';
import {MaterialLibrary} from '../../src/main/materials/library';
import {readImageProject} from '../../src/main/capture/image-project';
import {ImageHistory} from '../../src/shared/capture/image-document';
import {defaultWatermarkPreset} from '../../src/shared/capture/watermark';
const directory=process.env.ONE_EDITOR_TEST_DIR!;
app.setPath('userData',join(directory,'profile'));
app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'one',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'one-file',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const tasks=new Set<Promise<unknown>>();
const track=<T>(task:Promise<T>)=>{tasks.add(task);void task.then(()=>tasks.delete(task),()=>tasks.delete(task));return task;};
void app.whenReady().then(async()=>{
  const png=nativeImage.createFromBitmap(Buffer.alloc(8*6*4,255),{width:8,height:6}).toPNG();
  const library=new MaterialLibrary(join(directory,'materials'),()=>png);await library.init();
  const material=await library.images.add(png,'Original.png','file');
  const history=new ImageHistory(8,6,true);const edited=history.value;
  edited.annotations.push({id:'rectangle-1',tool:'rectangle',start:{x:1,y:1},end:{x:5,y:4},points:[],color:'#ff0000',width:1,text:'',strength:10,number:1});history.commit(edited);
  let blocked=false,discard=false,confirms=0,copied='',saved='',watermark=defaultWatermarkPreset(),recognized='';
  let releaseRecognition:undefined|(()=>void),holdRecognition=false;
  let failCreate=false;
  let dialogAnswer:Electron.SaveDialogReturnValue={canceled:true,filePath:''};
  let openAnswer:Electron.OpenDialogReturnValue={canceled:true,filePaths:[]};
  let dialogOptions:unknown;
  dialog.showSaveDialog=(async(_parent:unknown,options:unknown)=>{dialogOptions=options;return dialogAnswer;}) as typeof dialog.showSaveDialog;
  dialog.showOpenDialog=(async()=>openAnswer) as typeof dialog.showOpenDialog;
  const commit=async(title:string,payload:{png:string},mode:'asset'|'copy',valid:()=>boolean,project:any,original?:Buffer)=>{
    if(!valid())throw Error('编辑已取消');
    if(mode==='copy'){copied=payload.png;return '已复制图片';}
    saved=(await library.images.add(Buffer.from(payload.png,'base64'),title,'edit',project?.document,original,project?.history)).id;return saved;
  };
  const editor=new ImageEditorService({
    createWindow:()=>{if(failCreate){failCreate=false;throw Error('Window fixture failure');}return new BrowserWindow({show:false,width:800,height:640,webPreferences:{preload:resolve('dist/preload/image-editor.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});},
    register:(name,handler)=>ipcMain.handle('one:'+name,handler),confirmClose:async()=>{confirms++;return discard;},
    fonts:async()=>[{family:'Test font',label:'Test font',aliases:[]}],
    blocked:()=>blocked,dark:()=>false,background:track,
    get:id=>library.images.detail(id),current:(id,hash)=>{try{return library.images.get(id).hash===hash;}catch{return false;}},
    protect:path=>library.protect(path),watermark:()=>watermark,saveWatermark:async value=>{watermark=value;},
    commit:async(id,_hash,payload,mode,valid,project,original)=>commit(library.images.get(id).title,payload,mode,valid,project,original),
    commitTransient:commit,
    recognize:async data=>{if(holdRecognition)await new Promise<void>(resolve=>{releaseRecognition=resolve;});recognized=data.toString('base64');},
  });
  protocol.handle('one',()=>new Response('<!doctype html><meta charset="utf-8"><p>Editor service fixture</p>',{headers:{'Content-Type':'text/html'}}));
  protocol.handle('one-file',request=>editor.resource(request));
  session.defaultSession.webRequest.onBeforeRequest({urls:['one-file://image-editor/*']},(details,callback)=>{
    const owner=details.webContents;callback({cancel:!owner||details.frame!==owner.mainFrame||!editor.authorize(details.url,owner.id)});
  });
  (globalThis as any).editorTest={
    editor,library,material,history,png,
    request:()=>({token:'',document:history.value,history:history.snapshot,png:png.toString('base64'),mode:'asset'}),
    dialog(file:string|null){dialogAnswer={canceled:file===null,filePath:file||''};},
    choose(file:string|null){openAnswer={canceled:file===null,filePaths:file?[file]:[]};},
    setDiscard(value:boolean){discard=value;},setBlocked(value:boolean){blocked=value;},
    hold(){holdRecognition=true;},release(){releaseRecognition?.();holdRecognition=false;},
    failNextWindow(){failCreate=true;},
    status:()=>({confirms,copied,saved,watermark,recognized,dialogOptions,tasks:tasks.size}),
    async project(file:string){const result=await readImageProject(file);return {project:result.project,hash:createHash('sha256').update(result.png).digest('hex')};},
    async originalIntact(){return (await library.images.read(material.id)).equals(png);},
    async exportIntact(file:string){return (await readFile(file)).equals(png);},
    async seedWatermark(){const file=join(directory,'watermark.png');await writeFile(file,png);return file;},
    async other(){const window=new BrowserWindow({show:false,webPreferences:{preload:resolve('dist/preload/image-editor.cjs'),sandbox:true}});await window.loadURL('one://app/index.html?view=image-editor');return window.webContents.id;},
  };
  await editor.open(material.id);
});
