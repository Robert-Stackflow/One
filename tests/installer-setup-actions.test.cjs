const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {runningProcessIds,directoryArgument,elevationCommand}=require('../installer/setup-actions.cjs');

test('only the intended One executable is treated as running',()=>{
  const output='"One.exe","42","Console","1","12,000 K"\r\n"OneSetup.exe","8","Console","1","8,000 K"\r\n';
  assert.deepEqual(runningProcessIds(output,'One'),[42]);
  assert.deepEqual(runningProcessIds('INFO: No tasks are running which match the specified criteria.','One'),[]);
  assert.deepEqual(runningProcessIds('"OneVerification-123.exe","91","Console","1","5,000 K"','OneVerification-123'),[91]);
});

test('elevation preserves a Unicode install path as one argument',()=>{
  const directory='D:\\安装位置 with spaces\\One';
  const argument=directoryArgument(directory);
  assert.equal(Buffer.from(argument.split('=')[1],'base64url').toString('utf8'),directory);
  const command=elevationCommand('C:\\安装程序 with spaces\\One Setup.exe',directory);
  const mock=`function Start-Process { param([string]$FilePath,[string[]]$ArgumentList,[string]$Verb); [Console]::OutputEncoding=[Text.Encoding]::UTF8; [pscustomobject]@{file=$FilePath;argument=$ArgumentList[0];verb=$Verb}|ConvertTo-Json -Compress };${command}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(mock,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{file:'C:\\安装程序 with spaces\\One Setup.exe',argument,verb:'RunAs'});
});
