import {join} from 'node:path';
import type {SearchMenuItem} from '../shared/search';
/** Shell execution is explicit. Folder/selection context is supplied as environment data. */
export function shellCommand(item:SearchMenuItem,folder='',selected:string[]=[],environment:NodeJS.ProcessEnv=process.env){
 const shell=item.shell??'powershell',script=item.target,env={...environment,ONE_FOLDER:folder,ONE_SELECTED:selected[0]??'',ONE_SELECTION:JSON.stringify(selected)};
 if(shell==='powershell'||shell==='pwsh')return{file:shell==='pwsh'?'pwsh.exe':join(environment.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args:['-NoProfile','-NoExit','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],env,windowsVerbatimArguments:false};
 if(shell==='cmd')return{file:join(environment.SystemRoot||'C:\\Windows','System32/cmd.exe'),args:['/d','/s','/k',`"${script.replace(/\r?\n/g,' & ')}"`],env,windowsVerbatimArguments:true};
 return{file:item.shellPath!,args:(item.args.length?item.args:['-c','{command}']).map(arg=>arg==='{command}'?script:arg),env,windowsVerbatimArguments:false};
}
