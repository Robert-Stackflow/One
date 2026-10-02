const {execFile}=require('node:child_process'),{promisify}=require('node:util'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const execute=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/menu-launch-native'),folder=path.join(out,'files','目录 & $() 空格');await fs.mkdir(folder,{recursive:true});
 const helper=path.resolve(process.env.ONE_OPEN_WITH_EXE||'dist/native/One.OpenWith.exe');
 const launch=async(file,args,console=false,env=process.env,verbatim=false,cwd=folder)=>JSON.parse((await execute(helper,[console?'launch-console':'launch',file,cwd,verbatim?'verbatim':'quoted',...args],{windowsHide:true,env,timeout:15000})).stdout);
 const record=path.join(folder,'arguments.json'),script=path.join(folder,'record.cjs'),args=['','你好 & | $()','embedded "quote"','trailing\\','before\\"quote'];
 await fs.writeFile(script,"require('fs').writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),cwd:process.cwd()}))");
 await launch(process.execPath,[script,record,...args]);await assertEventually(()=>fs.readFile(record,'utf8'));
 assert.deepEqual(JSON.parse(await fs.readFile(record,'utf8')),{args,cwd:folder});
 const psFile=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),consoleFile=path.join(folder,'console.json');
 const command='$Host.UI.RawUI.WindowTitle="One 启动验证";@{cwd=$PWD.Path;inputRedirected=[Console]::IsInputRedirected;outputRedirected=[Console]::IsOutputRedirected;folder=$env:ONE_FOLDER;selected=$env:ONE_SELECTED;pid=$PID}|ConvertTo-Json -Compress|Set-Content -LiteralPath $env:ONE_CONSOLE_RECORD -Encoding UTF8;Start-Sleep -Seconds 3';
 const opened=await launch(psFile,['-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],true,{...process.env,ONE_FOLDER:folder,ONE_SELECTED:'中文 & file.txt',ONE_CONSOLE_RECORD:consoleFile});
 await assertEventually(()=>fs.readFile(consoleFile,'utf8'));const consoleRecord=JSON.parse((await fs.readFile(consoleFile,'utf8')).replace(/^\uFEFF/,''));
 assert.equal(consoleRecord.cwd,folder);assert.equal(consoleRecord.inputRedirected,false);assert.equal(consoleRecord.outputRedirected,false);assert.equal(consoleRecord.folder,folder);assert.equal(consoleRecord.selected,'中文 & file.txt');assert.equal(consoleRecord.pid,opened.pid);assert.doesNotThrow(()=>process.kill(opened.pid,0));
 const cmdRecord=path.join(folder,'cmd.txt');await launch(path.join(process.env.SystemRoot,'System32/cmd.exe'),['/d','/s','/c','"echo %ONE_MARKER%>%ONE_RECORD%"'],true,{...process.env,ONE_MARKER:'argument-boundary-ok',ONE_RECORD:'"'+cmdRecord+'"'},true);
 await assertEventually(()=>fs.readFile(cmdRecord,'utf8'));assert.equal((await fs.readFile(cmdRecord,'utf8')).trim(),'argument-boundary-ok');
 await assert.rejects(()=>launch(path.join(folder,'missing.exe'),[]),/0x80070002/);
 await assert.rejects(()=>launch(psFile,[],true,process.env,false,path.join(folder,'missing')),/0x8007010b/);
 const result={result:'PASS',shellActivation:true,unicodeAndQuotedArguments:true,workingDirectory:true,interactiveConsoleOwnsInputOutput:true,powershellStaysOpen:true,cmdVerbatimArguments:true,missingPathsReported:true};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await delay(3500);
}
async function assertEventually(read){for(let i=0;i<100;i++){try{return await read();}catch{await delay(60);}}throw Error('launched fixture did not produce its result');}
run().catch(e=>{console.error(e);process.exitCode=1;});
