const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildSync}=require('esbuild');

const output=path.resolve('work/elevation-command-test.cjs');
fs.mkdirSync(path.dirname(output),{recursive:true});
buildSync({entryPoints:['src/main/elevation-command.ts'],outfile:output,bundle:true,platform:'node',target:'node22'});
const {elevationCommand}=require(output);
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');

function launchArguments(args){
 const mock="function Start-Process { param([string]$FilePath,[string[]]$ArgumentList,[string]$Verb) [pscustomobject]@{file=$FilePath;hasArguments=$PSBoundParameters.ContainsKey('ArgumentList');arguments=@($ArgumentList);verb=$Verb}|ConvertTo-Json -Compress };";
 const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',mock+elevationCommand('C:\\Program Files\\One\\One.exe',args)],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 return JSON.parse(result.stdout.trim());
}

test('installed One restarts without an empty ArgumentList',()=>{
 const result=launchArguments([]);
 assert.equal(result.file,'C:\\Program Files\\One\\One.exe');
 assert.equal(result.hasArguments,false);
 assert.equal(result.verb,'RunAs');
});

test('development arguments are retained when present',()=>{
 const result=launchArguments(['.','--test-switch']);
 assert.equal(result.hasArguments,true);
 assert.deepEqual(result.arguments,['.','--test-switch']);
});
