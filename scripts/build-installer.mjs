import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,stat,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {workspace} from './workspace.mjs';
import {validateRelease} from './release.mjs';

const execute=promisify(execFile);
const source=resolve('.');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const custom=process.argv.includes('--custom');
const reuseBuild=process.argv.includes('--reuse-build');
const output=resolve(process.env.ONE_INSTALLER_OUTPUT||join('work','installer-output',version));
const {root:work,temp}=await workspace();
const env={...process.env,TEMP:temp,TMP:temp,ELECTRON_BUILDER_CACHE:join(work,'builder-cache')};
await mkdir(output,{recursive:true});

async function run(file,args){
 const result=await execute(file,args,{cwd:source,env,windowsHide:true,maxBuffer:8*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
}

if(reuseBuild){
 for(const file of ['dist/main/index.cjs','dist/renderer/index.html','dist/native/One.Levels.exe','dist/native/One.LaunchNormal.exe','dist/icons/one.ico','dist/icons/one-16.png','dist/icons/one-taskbar-30.png','dist/icons/one-256.png'])await stat(resolve(file));
 for(const name of ['one.ico','one-16.png','one-taskbar-30.png','one-256.png']){
  const sourceHash=createHash('sha256').update(await readFile(resolve('assets/icons',name))).digest('hex');
  const builtHash=createHash('sha256').update(await readFile(resolve('dist/icons',name))).digest('hex');
  if(sourceHash!==builtHash)throw new Error(`Build icon is stale: ${name}`);
 }
}else await run('cmd.exe',['/d','/c',resolve('scripts/build-windows.cmd')]);
await run(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--win','nsis','--x64','--publish','never','--config.directories.output='+output]);
const verified=await validateRelease(output,source,version);
const engine=join(output,`One-${version}-Setup-Engine-x64.exe`);
await stat(engine);
let installer=engine;
if(custom){
 installer=join(output,`One-${version}-Setup-x64.exe`);
 const asar=join(output,'win-unpacked','resources','app.asar');
 const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
 const packageInfo=JSON.parse(await readFile('package.json','utf8'));
 const namespace=Buffer.from('50e065bc313411e69bab38c9862bdaf3','hex');
 const bytes=createHash('sha1').update(Buffer.concat([namespace,Buffer.from(packageInfo.build.appId)])).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');
 const guid=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 const info={version,product:'One',guid,engineHash:await digest(engine),engineBytes:(await stat(engine)).size,asarHash:await digest(asar)};
 const staging=join(output,'electron-installer-build');
 await mkdir(staging,{recursive:true});
 const infoFile=join(staging,'build-info.json');
 await writeFile(infoFile,JSON.stringify(info,null,2));
 await copyFile(resolve('assets/icons/one-256.png'),resolve('installer/icon.png'));
 const config={compression:'maximum',electronLanguages:['zh-CN','en-US'],appId:'local.one.desktop.setup',productName:'One Setup',electronVersion:packageInfo.devDependencies.electron,electronDist:resolve('node_modules/electron/dist'),npmRebuild:false,buildDependenciesFromSource:false,asar:true,directories:{output:staging},files:['package.json','main.cjs','setup-actions.cjs','preload.cjs','index.html','style.css','renderer.js','icon.png'],extraResources:[{from:engine,to:'engine/One-Setup-Engine.exe'},{from:infoFile,to:'build-info.json'},{from:resolve('dist/native/One.LaunchNormal.exe'),to:'launch-normal.exe'}],win:{target:'portable',icon:resolve('assets/icons/one.ico'),executableName:'OneSetup',signAndEditExecutable:true,signExecutable:false},portable:{artifactName:`One-${version}-Setup-x64.exe`}};
 const configFile=join(staging,'electron-builder.json');
 await writeFile(configFile,JSON.stringify(config,null,2));
 await run(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--projectDir',resolve('installer'),'--config',configFile,'--win','portable','--x64','--publish','never']);
 await copyFile(join(staging,`One-${version}-Setup-x64.exe`),installer);
 await stat(installer);
}
console.log(JSON.stringify({installer,engine,verified}));
