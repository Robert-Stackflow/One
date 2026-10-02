import {join} from 'node:path';
import {builtinById} from '../shared/menu-builtins';
/** Fixed launch plans: caller data never becomes a system command. */
export function builtinPlan(id:string,env:NodeJS.ProcessEnv=process.env) {
 const system=join(env.SystemRoot||'C:\\Windows','System32'),file=(name:string)=>join(system,name);
 const mmc:Record<string,string>={'group-policy':'gpedit.msc',services:'services.msc','computer-management':'compmgmt.msc','device-manager':'devmgmt.msc','disk-management':'diskmgmt.msc','event-viewer':'eventvwr.msc'};
 if(mmc[id])return{file:file('mmc.exe'),args:[file(mmc[id])]};
 const programs:Record<string,string>={registry:'regedit.exe','task-manager':'Taskmgr.exe','character-map':'charmap.exe','steps-recorder':'psr.exe','control-panel':'control.exe'};
 if(programs[id])return{file:id==='registry'?join(env.SystemRoot||'C:\\Windows','regedit.exe'):file(programs[id]),args:[]};
 if(id==='hosts')return{file:file('notepad.exe'),args:[file('drivers/etc/hosts')],elevated:true};
 // Rundll32 parses DLL and entry point itself: only the DLL path is quoted.
 if(id==='environment')return{file:file('rundll32.exe'),args:['"'+file('sysdm.cpl')+'",EditEnvironmentVariables'],windowsVerbatimArguments:true};
 if(id==='network-connections')return{file:file('control.exe'),args:['ncpa.cpl']};
 if(id==='ip-info')return{file:file('WindowsPowerShell/v1.0/powershell.exe'),args:['-NoProfile','-NoExit','-EncodedCommand',Buffer.from('ipconfig /all','utf16le').toString('base64')],console:true};
 const power:Record<string,string[]>={shutdown:['/s','/t','0'],restart:['/r','/t','0'],'sign-out':['/l'],hibernate:['/h']};
 if(power[id]&&builtinById(id)?.confirm)return{file:file('shutdown.exe'),args:power[id]};
 return;
}
export function builtinImagePath(id:string,env:NodeJS.ProcessEnv=process.env){
 if(!builtinById(id)?.systemIcon)return;
 if(id==='terminal')return join(env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 if(id==='apps'||id==='windows-settings')return join(env.SystemRoot||'C:\\Windows','ImmersiveControlPanel/SystemSettings.exe');
 if(id==='environment')return join(env.SystemRoot||'C:\\Windows','System32/SystemPropertiesAdvanced.exe');
 if(id==='network-connections')return join(env.SystemRoot||'C:\\Windows','System32/ncpa.cpl');
 const plan=builtinPlan(id,env);return plan?.file.endsWith('mmc.exe')?plan.args[0]:plan?.file;
}
