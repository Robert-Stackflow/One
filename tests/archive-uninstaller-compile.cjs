const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
async function main(){
 const cache=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1');
 let compiler;
 for(const name of await fs.readdir(cache)){const candidate=path.join(cache,name,'makensis.exe');if(await fs.stat(candidate).then(item=>item.isFile(),()=>false)){compiler=candidate;break;}}
 assert(compiler,'NSIS compiler required');
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-uninstaller-'));
 try{
  const script=path.join(root,'compile.nsi');
  for(const appId of ['local.one.desktop','local.one.verification']){
  await fs.writeFile(script,`Unicode true
!include "LogicLib.nsh"
!define APP_EXECUTABLE_FILENAME "One.exe"
!define APP_ID "${appId}"
!define isUpdated "0 = 1"
!include "${path.resolve('build/installer.nsh')}"
Name "One archive cleanup compile verification"
OutFile "${path.join(root,'compile.exe')}"
!insertmacro customHeader
Section
 !insertmacro customInstall
 WriteUninstaller "$TEMP\\unused-archive-uninstaller.exe"
SectionEnd
Section "un.Uninstall"
 !insertmacro customUnInstall
SectionEnd
`,'utf8');
  const result=spawnSync(compiler,['/V2',script],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  }
  console.log('One install/uninstall association macros compiled for production and verification identities. No installer was executed.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
