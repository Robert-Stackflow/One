import {spawn,execFile, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';

const execute=promisify(execFile);
let activeBroker:ChildProcessWithoutNullStreams|null=null;
export type HotkeyOwnerResult=
  |{status:'found';pid:number;tid:number;path:string;partial:boolean}
  |{status:'not-found';partial:boolean}
  |{status:'cancelled'}
  |{status:'error';message:string};

const keys:Record<string,number>={
  Backspace:8,Tab:9,Enter:13,Escape:27,Space:32,PageUp:33,PageDown:34,End:35,Home:36,
  ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Delete:46,
};

export function parseHotkeyProbe(shortcut:string){
  if(typeof shortcut!=='string'||shortcut.length>80)throw new Error('快捷键无效');
  const parts=shortcut.split('+').map(part=>part.trim());
  if(parts.some(part=>!part)||parts.length>5)throw new Error('快捷键无效');
  const keyName=parts.pop()!;
  let modifiers=0;
  for(const part of parts){
    const bit=part==='Alt'?1:part==='Ctrl'?2:part==='Shift'?4:part==='Win'?8:0;
    if(!bit||modifiers&bit)throw new Error('快捷键无效');
    modifiers|=bit;
  }
  const key=/^[A-Z0-9]$/.test(keyName)?keyName.charCodeAt(0):
    /^F(?:[1-9]|1\d|2[0-4])$/.test(keyName)?111+Number(keyName.slice(1)):keys[keyName];
  if(!key||!modifiers)throw new Error('请先录入组合键');
  const unsafe=Boolean((modifiers&8)&&key===76 || (modifiers&1)&&key===115 ||
    (modifiers&3)===3&&key===46);
  return {key,modifiers,unsafe};
}

function nativeFile(name:string){return join(__dirname,'../native/'+name).replace('app.asar\\','app.asar.unpacked\\');}
type BrokerLine={ready?:boolean;status?:'found'|'not-found'|'error';pid?:number;tid?:number;path?:string;partial?:boolean;code?:number};

export async function locateHotkeyOwner(shortcut:string,mode:'auto'|'manual'='auto',elevated=false):Promise<HotkeyOwnerResult>{
  if(process.platform!=='win32')return {status:'error',message:'仅支持 Windows'};
  if(activeBroker)return {status:'error',message:'热键诊断正在运行'};
  const {key,modifiers,unsafe}=parseHotkeyProbe(shortcut);
  if(mode==='auto'&&unsafe)return {status:'error',message:'此组合键可能触发系统操作，请改用手动测试'};
  const broker=spawn(nativeFile('One.HotkeyProbe.exe'),['--broker'],{windowsHide:true,stdio:'pipe'});
  activeBroker=broker;
  let text='',readyResolve:()=>void=()=>{},readyReject:(error:Error)=>void=()=>{};
  let resultResolve:(value:BrokerLine)=>void=()=>{},resultReject:(error:Error)=>void=()=>{};
  let readyDone=false,resultDone=false;
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const result=new Promise<BrokerLine>((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
  // The second promise may reject before the launcher has finished waiting for UAC.
  void result.catch(()=>{});
  const fail=(error:Error)=>{if(!readyDone){readyDone=true;readyReject(error);}if(!resultDone){resultDone=true;resultReject(error);}};
  broker.stdout.setEncoding('utf8');
  broker.stdout.on('data',(part:string)=>{
    text+=part;
    if(text.length>8192){fail(new Error('热键诊断返回内容过长'));return;}
    let index;
    while((index=text.indexOf('\n'))>=0){
      const line=text.slice(0,index);text=text.slice(index+1);
      try{const value=JSON.parse(line) as BrokerLine;
        if(value.ready&&!readyDone){readyDone=true;readyResolve();}
        else if(value.status&&!resultDone){resultDone=true;resultResolve(value);}
      }catch{fail(new Error('热键诊断返回内容无效'));}
    }
  });
  broker.stderr.resume();
  broker.on('error',fail);
  broker.on('close',code=>{if(!resultDone)fail(new Error(`热键诊断已退出（${code}）`));});
  const timer=setTimeout(()=>fail(new Error('热键诊断超时')),60000);
  try{
    await ready;
    try{
      const args=['--scan',String(key),String(modifiers),mode];
      if(elevated)await execute(nativeFile('One.OpenWith.exe'),['launch-elevated',nativeFile('One.HotkeyProbe.exe'),'','quoted',...args],
        {windowsHide:true,timeout:45000,maxBuffer:4096,encoding:'utf8'});
      else await execute(nativeFile('One.HotkeyProbe.exe'),args,{windowsHide:true,timeout:20000,maxBuffer:4096,encoding:'utf8'});
    }catch(error){
      const detail=String((error as {stderr?:string}).stderr||error);
      if(/0x800704c7/i.test(detail))return {status:'cancelled'};
      throw new Error(`热键诊断辅助进程未能完成：${detail.slice(0,220)}`);
    }
    const value=await result;
    if(value.status==='found'&&typeof value.pid==='number'&&Number.isInteger(value.pid)&&value.pid>0)
      return {status:'found',pid:value.pid,tid:value.tid||0,path:value.path||'',partial:!!value.partial};
    if(value.status==='not-found')return {status:'not-found',partial:!!value.partial};
    return {status:'error',message:`热键诊断失败（Windows ${value.code||0}）`};
  }catch(error){return {status:'error',message:(error as Error).message||'热键诊断失败'};}
  finally{clearTimeout(timer);if(activeBroker===broker)activeBroker=null;if(broker.exitCode===null)broker.kill();}
}

export function cancelHotkeyOwner(){activeBroker?.kill();activeBroker=null;}
