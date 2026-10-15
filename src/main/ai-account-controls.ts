import {clipboard,dialog,shell,type BrowserWindow} from 'electron';
import type {OneAIService} from './ai-service';
/** Native account actions shared by caller-validated editor IPC handlers. */
export async function chooseCodexExecutable(ai:OneAIService,owner:BrowserWindow){
 const result=await dialog.showOpenDialog(owner,{title:'选择本机 Codex 程序',properties:['openFile'],filters:[{name:'Codex 入口',extensions:['exe','cmd','bat','ps1','js']},{name:'所有文件',extensions:['*']}]});
 return result.canceled?null:ai.codexExecutable(result.filePaths[0]);
}
export async function openCodexLogin(ai:OneAIService){
 const value=(await ai.codexStatus()).verificationUrl;if(!value)throw Error('当前没有待完成的 Codex 授权');const url=new URL(value);
 if(url.protocol!=='https:'||url.hostname!=='auth.openai.com')throw Error('Codex 授权地址无效');await shell.openExternal(url.href);
}
export async function copyCodexCode(ai:OneAIService){
 const code=(await ai.codexStatus()).userCode;if(!code||!/^[A-Z0-9-]{4,32}$/.test(code))throw Error('当前没有 Codex 验证码');clipboard.writeText(code);
}
