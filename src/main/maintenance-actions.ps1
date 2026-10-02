$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
function Registry-Base($v){
 if($v.hive -notin @('CurrentUser','LocalMachine') -or $v.view -notin @(32,64)){throw '注册表范围无效'}
 if($v.key -notmatch '^Software\\(Microsoft\\Windows\\CurrentVersion\\(Run|RunOnce|App Paths\\[^\\]+|Uninstall\\[^\\]+)|Classes\\CLSID\\\{[\w-]+\}\\(InprocServer32|LocalServer32))$'){throw '此注册表路径不允许修改'}
 $h=if($v.hive -eq 'CurrentUser'){[Microsoft.Win32.RegistryHive]::CurrentUser}else{[Microsoft.Win32.RegistryHive]::LocalMachine}
 $view=if($v.view -eq 32){[Microsoft.Win32.RegistryView]::Registry32}else{[Microsoft.Win32.RegistryView]::Registry64}
 return [Microsoft.Win32.RegistryKey]::OpenBaseKey($h,$view)
}
function Read-Snapshot($v){
 $base=Registry-Base $v
 try{$key=$base.OpenSubKey($v.key);if(!$key){throw '注册表项目已不存在'}
  $values=[Collections.Generic.List[object]]::new()
  function Read-Values($key,$path){
   foreach($name in ($key.GetValueNames()|Sort-Object)){if($null -ne $v.value -and $name -ne $v.value){continue}
    $kind=$key.GetValueKind($name).ToString();$data=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if($kind -eq 'Binary' -or $kind -eq 'None'){$data=[Convert]::ToBase64String($data)}
    $values.Add([pscustomobject]@{path=$path;name=$name;kind=$kind;data=$data})
   }
   if($null -eq $v.value){foreach($sub in ($key.GetSubKeyNames()|Sort-Object)){$child=$key.OpenSubKey($sub);try{Read-Values $child ($path+'\'+$sub)}finally{$child.Dispose()}}}
  }
  try{Read-Values $key ''}finally{$key.Dispose()}
  return [pscustomobject]@{hive=$v.hive;view=$v.view;key=$v.key;value=$v.value;values=@($values.ToArray())}
 }finally{$base.Dispose()}
}
function Task-Object($path){$name=Split-Path $path -Leaf;$folder=$path.Substring(0,$path.Length-$name.Length);Get-ScheduledTask -TaskName $name -TaskPath $folder}
try{
 $result=$null
 switch($r.mode){
  'startup-info' {
   $tasks=@(Get-ScheduledTask|Where-Object {$_.Triggers|Where-Object {$_.CimClass.CimClassName -match 'BootTrigger|LogonTrigger'}}|ForEach-Object {[pscustomobject]@{name=$_.TaskName;path=$_.TaskPath+$_.TaskName;command=(($_.Actions|ForEach-Object {$_.Execute+' '+$_.Arguments}) -join '; ');enabled=($_.State -ne 'Disabled');description=$_.Description}})
   $shortcuts=@();$wsh=New-Object -ComObject WScript.Shell
   try{foreach($folder in @([Environment]::GetFolderPath('Startup'),[Environment]::GetFolderPath('CommonStartup'))){foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -ErrorAction SilentlyContinue){$link=$wsh.CreateShortcut($file.FullName);$shortcuts += [pscustomobject]@{path=$file.FullName;target=$link.TargetPath;status=$(if(Test-Path -LiteralPath $link.TargetPath){'目标存在'}else{'目标未找到'})}}}}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($wsh)}
   $result=@{tasks=$tasks;shortcuts=$shortcuts}
  }
  'registry-backup' {$result=Read-Snapshot $r;$current=($result.values|Where-Object {$_.path -eq '' -and $_.name -eq $(if($r.expectedName){$r.expectedName}elseif($null -eq $r.value){''}else{$r.value})}|Select-Object -First 1).data;if([string]$current -cne [string]$r.expected){throw '扫描后此项目已变化，请重新扫描'}}
  'registry-remove' {
   $snapshot=Read-Snapshot $r;if(($snapshot|ConvertTo-Json -Depth 100 -Compress) -cne ($r.backup|ConvertTo-Json -Depth 100 -Compress)){throw '备份后此项目已变化，未清理'}
   $base=Registry-Base $r;try{if($null -eq $r.value){$base.DeleteSubKeyTree($r.key,$true)}else{$key=$base.OpenSubKey($r.key,$true);try{$key.DeleteValue($r.value,$true)}finally{$key.Dispose()}}}finally{$base.Dispose()}
   $result=$true
  }
  'registry-restore' {
   $v=$r.backup;$base=Registry-Base $v
   try{$existing=$base.OpenSubKey($v.key);try{if($existing -and ($null -eq $v.value -or $existing.GetValueNames() -contains $v.value)){throw '原位置已有注册表数据，未覆盖'}}finally{if($existing){$existing.Dispose()}}
    foreach($item in $v.values){$key=$base.CreateSubKey($v.key+$item.path);try{$kind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],$item.kind);$data=$item.data;if($item.kind -in @('Binary','None')){$data=[Convert]::FromBase64String($data)}elseif($item.kind -eq 'DWord'){$data=[int]$data}elseif($item.kind -eq 'QWord'){$data=[long]$data}elseif($item.kind -eq 'MultiString'){$data=[string[]]$data};$key.SetValue($item.name,$data,$kind)}finally{$key.Dispose()}}
   }finally{$base.Dispose()};$result=$true
  }
  'task-backup' {$task=Task-Object $r.path;$result=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath}
  'task-disable' {$task=Task-Object $r.path;$xml=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath;if($xml -cne $r.expected){throw '任务内容已变化，未禁用'};Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath|Out-Null;$result=$true}
  'task-restore' {$task=Task-Object $r.path;$xml=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath;if(($xml -replace '<Enabled>(true|false)</Enabled>','<Enabled/>') -cne ($r.expected -replace '<Enabled>(true|false)</Enabled>','<Enabled/>')){throw '任务内容已变化，未覆盖'};Enable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath|Out-Null;$result=$true}
  {$_ -in @('disk-info','recycle-empty')} {
   Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneRecycle { [StructLayout(LayoutKind.Sequential,Pack=8)] public struct Info { public int cbSize; public long size; public long count; } [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern int SHQueryRecycleBin(string root,ref Info info); [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern int SHEmptyRecycleBin(IntPtr owner,string root,uint flags); }'
   if($r.mode -eq 'recycle-empty'){$code=[OneRecycle]::SHEmptyRecycleBin([IntPtr]::Zero,$null,7);if($code -ne 0){throw "回收站清理失败 ($code)"};$result=$true}else{
    $info=New-Object OneRecycle+Info;$info.cbSize=[Runtime.InteropServices.Marshal]::SizeOf($info);$code=[OneRecycle]::SHQueryRecycleBin($null,[ref]$info)
    $system=@();foreach($drive in Get-PSDrive -PSProvider FileSystem){foreach($name in @('pagefile.sys','swapfile.sys','hiberfil.sys')){$path=Join-Path $drive.Root $name;try{$file=Get-Item -LiteralPath $path -Force;$system += @{name=$name;path=$path;bytes=$file.Length}}catch{}}}
    $result=@{recycleBytes=$info.size;recycleCount=$info.count;system=$system}
   }
  }
  {$_ -in @('hibernate-off','hibernate-on')} {
   $option=if($r.mode -eq 'hibernate-off'){'off'}else{'on'}
   $p=Start-Process -FilePath "$env:SystemRoot\System32\powercfg.exe" -ArgumentList @('/hibernate',$option) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
   if($p.ExitCode -ne 0){throw "休眠设置失败 ($($p.ExitCode))"};$result=$true
  }
  default {throw '系统操作无效'}
 }
 ConvertTo-Json -InputObject $result -Compress -Depth 100
}catch{ConvertTo-Json -InputObject @{error=$_.Exception.Message} -Compress}
