// Builds an installer with the production configuration and a unique test
// identity, then installs/reinstalls/uninstalls without starting the application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
function run(file,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:'ignore',...options});const timer=setTimeout(()=>{child.kill();reject(Error('Installer operation timed out'));},180000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',code=>{clearTimeout(timer);resolve(code)});});}
const sleep=delay=>new Promise(resolve=>setTimeout(resolve,delay));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{
 const delivery=path.resolve('.');
 const reuse=process.env.ONE_INSTALLER_TEST_SESSION;
 if(reuse)assert(/^[0-9a-f-]{36}$/.test(reuse),'Invalid verification session');
 const id=reuse||crypto.randomUUID(),name='OneVerification-'+id;
 const folder=path.resolve('work/installer-lifecycle',id),installed=path.join(folder,'安装目录 with spaces');fs.mkdirSync(folder,{recursive:true});
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
 const config={...pkg.build,appId:'local.one.verification.'+id,productName:name,extraMetadata:{name:name.toLowerCase()},directories:{output:path.join(folder,'build')},win:{...pkg.build.win,executableName:name,target:'nsis'},nsis:{...pkg.build.nsis,guid:id,include:path.resolve('build/installer.nsh'),shortcutName:name,artifactName:'verification-setup.exe'},npmRebuild:false,buildDependenciesFromSource:false};
 const configuration=path.join(folder,'config.json');fs.writeFileSync(configuration,JSON.stringify(config,null,2));
 if(!reuse){
  const log=fs.openSync(path.join(folder,'build.log'),'w');
  try{assert.equal(await run(process.execPath,[path.join(delivery,'node_modules/electron-builder/out/cli/cli.js'),'--projectDir',delivery,'--config',configuration,'--win','nsis','--x64','--publish','never'],{cwd:delivery,stdio:['ignore',log,log]}),0,'Verification installer build must pass');}finally{fs.closeSync(log);}
 }
 const installer=path.join(folder,'build/verification-setup.exe');assert(fs.existsSync(installer));
 const profile=path.resolve(process.env.APPDATA,name.toLowerCase()),productProfile=path.resolve(process.env.APPDATA,name);
 // On Windows these two names refer to the same directory.
 assert.equal(profile.toLowerCase(),productProfile.toLowerCase());
 assert(!fs.existsSync(profile),'Test identity must not already have a profile');
 fs.mkdirSync(profile);const saved=path.join(profile,'settings-preservation.txt');fs.writeFileSync(saved,'中文 settings + language + appearance');const before=sha(saved);
 const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+id;
 const track='HKCU\\Software\\'+id;
 const shortcut=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs',name+'.lnk');
 const temporary=path.resolve(process.env.ONE_INSTALLER_TEMP||process.env.TEMP);
 const installerEnv={...process.env,TEMP:temporary,TMP:temporary};
 assert(fs.existsSync(temporary),'Installer temporary directory must exist');
 let isInstalled=false;
 try{
  for(const stage of ['first install','reinstall']){
   assert.equal(await run(installer,['/S','/currentuser','/D='+installed],{env:installerEnv}),0,stage);
   isInstalled=true;
   assert(fs.existsSync(path.join(installed,name+'.exe')),stage+' executable');
   assert(fs.existsSync(path.join(installed,'resources/app.asar')),stage+' payload');
   assert.equal(sha(saved),before,stage+' must preserve profile');
   const registry=spawnSync('reg.exe',['query',key,'/v','DisplayName'],{windowsHide:true,encoding:'utf8'});
   assert.equal(registry.status,0,stage+' must register uninstall entry');
   assert(registry.stdout.includes(name));
   assert(fs.existsSync(shortcut),stage+' must create the Start menu entry');
   console.log(stage+': program files, uninstall entry, Start menu and retained profile passed.');
  }
  const uninstallers=fs.readdirSync(installed).filter(file=>/^Uninstall.*\.exe$/i.test(file));assert.equal(uninstallers.length,1);
  assert.equal(await run(path.join(installed,uninstallers[0]),['/S'],{env:installerEnv}),0,'Uninstallation must succeed');
  // NSIS may return from its original executable before its temporary copy
  // finishes. Wait for file, shortcut and registry cleanup together.
  for(let count=0;count<100;count++){
   const registered=spawnSync('reg.exe',['query',key],{windowsHide:true,stdio:'ignore'}).status===0;
   if(!registered&&!fs.existsSync(path.join(installed,name+'.exe'))&&!fs.existsSync(shortcut))break;
   await sleep(100);
  }
  assert(!fs.existsSync(path.join(installed,name+'.exe')),'Uninstallation must remove executable');
  assert(!fs.existsSync(shortcut),'Uninstallation must remove its Start menu entry');
  for(const registryKey of [key,track])assert.notEqual(spawnSync('reg.exe',['query',registryKey],{windowsHide:true,stdio:'ignore'}).status,0,'Uninstallation must remove its own registry keys');
  assert.equal(sha(saved),before,'Uninstallation must preserve the profile');isInstalled=false;
  const result={passed:true,installerIdentityIsolated:true,productionConfiguration:true,firstInstall:true,reinstall:true,uninstall:true,unicodeAndSpacesPath:true,profilePreserved:true,registryAndShortcutCleaned:true,applicationNeverLaunched:true,inputHooksAccess:false,installVolume:path.parse(installed).root,temporaryVolume:path.parse(temporary).root,crossVolume:path.parse(installed).root.toLowerCase()!==path.parse(temporary).root.toLowerCase()};
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));fs.writeFileSync('work/installer-lifecycle-results.json',JSON.stringify({...result,folder},null,2));console.log(JSON.stringify(result,null,2));
 }finally{
  if(isInstalled){const file=fs.existsSync(installed)&&fs.readdirSync(installed).find(value=>/^Uninstall.*\.exe$/i.test(value));if(file)await run(path.join(installed,file),['/S'],{env:installerEnv});}
  // Only the exact unique directory created above is removed. Do not touch One.
  assert.equal(path.dirname(profile).toLowerCase(),path.resolve(process.env.APPDATA).toLowerCase());assert.equal(path.basename(profile),name.toLowerCase());
  assert.equal(fs.lstatSync(profile).isSymbolicLink(),false,'Test profile must not be a link');
  fs.rmSync(profile,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
