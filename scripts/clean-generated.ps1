param([switch]$Apply,[string[]]$CaseName=@(),[switch]$WorkOnly,[switch]$AllWork,[switch]$VerificationCaches)
$ErrorActionPreference='Stop'
$oneRepository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$oneCurrent=Join-Path $oneRepository 'work\current'
$oneBoundary=$oneCurrent.TrimEnd('\')+'\'
$oneReportRoot=Join-Path $oneRepository 'verification\storage'
if($AllWork -or $VerificationCaches){throw '旧批量清理选项已停用。请核实任务完成及证据留存后，用 -CaseName 明确选择 work/current 内的生成用例。'}
if($Apply -and -not $CaseName.Count){throw '-Apply 必须同时提供 -CaseName；默认仅预览，不自动清理全部任务。'}
function Assert-OnePlainDirectory([string]$onePath) {
 if(-not (Test-Path -LiteralPath $onePath -PathType Container)){throw "目录不存在：$onePath"}
 $oneItem=Get-Item -LiteralPath $onePath -Force
 if($oneItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "目录为链接，已保留：$onePath"}
}
function Get-OneCase([string]$oneName) {
 if($oneName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$' -or $oneName -eq 'fixtures'){throw "不是可清理的独立用例名：$oneName"}
 $onePath=[IO.Path]::GetFullPath((Join-Path $oneCurrent $oneName))
 if(-not $onePath.StartsWith($oneBoundary,[StringComparison]::OrdinalIgnoreCase)){throw '清理路径越界'}
 Assert-OnePlainDirectory $onePath
 $oneMarker=Join-Path $onePath '.one-generated-case'
 if(-not (Test-Path -LiteralPath $oneMarker -PathType Leaf)){throw "用例没有生成标记，已保留：$oneName"}
 if((Get-Item -LiteralPath $oneMarker -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "生成标记为链接，已保留：$oneName"}
 $oneActivePath=Join-Path $onePath '.active'
 if(Test-Path -LiteralPath $oneActivePath){
  $oneActiveItem=Get-Item -LiteralPath $oneActivePath -Force
  if($oneActiveItem.PSIsContainer -or ($oneActiveItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw "活动记录异常，已保留：$oneName"}
  $onePid=0
  if(-not [int]::TryParse((Get-Content -LiteralPath $oneActivePath -Raw).Trim(),[ref]$onePid) -or $onePid -le 0){throw "活动记录无效，已保留：$oneName"}
  if(Get-Process -Id $onePid -ErrorAction SilentlyContinue){throw "任务仍在运行，已保留：$oneName"}
 }
 $oneReferences=@(Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($onePath+'\',[StringComparison]::OrdinalIgnoreCase)) -or
  ($_.CommandLine -and $_.CommandLine.IndexOf($onePath,[StringComparison]::OrdinalIgnoreCase) -ge 0)
 })
 if($oneReferences.Count){throw "进程仍引用用例目录，已保留：$oneName"}
 # Walk without following links. Refuse ambiguous cases in full.
 $oneQueue=[Collections.Generic.Queue[string]]::new();$oneQueue.Enqueue($onePath)
 $oneEntries=[Collections.Generic.List[object]]::new();$oneBytes=0L
 while($oneQueue.Count){foreach($oneItem in Get-ChildItem -LiteralPath $oneQueue.Dequeue() -Force){
  if($oneItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "用例含链接，已保留：$oneName"}
  $oneEntries.Add($oneItem)
  if($oneItem.PSIsContainer){$oneQueue.Enqueue($oneItem.FullName)}else{$oneBytes+=$oneItem.Length}
 }}
 return [pscustomobject]@{Name=$oneName;Path=$onePath;Bytes=$oneBytes;Entries=$oneEntries}
}
$oneTargets=[Collections.Generic.List[object]]::new();$oneSkipped=[Collections.Generic.List[object]]::new()
if(Test-Path -LiteralPath $oneCurrent){
 Assert-OnePlainDirectory (Join-Path $oneRepository 'work');Assert-OnePlainDirectory $oneCurrent
 $oneNames=if($CaseName.Count){$CaseName | Select-Object -Unique}else{Get-ChildItem -LiteralPath $oneCurrent -Directory -Force | Where-Object {$_.Name -ne 'fixtures'} | ForEach-Object {$_.Name}}
 foreach($oneName in $oneNames){
  try{$oneTargets.Add((Get-OneCase $oneName))}catch{if($CaseName.Count){throw};$oneSkipped.Add([pscustomobject]@{Name=$oneName;Reason=$_.Exception.Message})}
 }
}elseif($CaseName.Count){throw 'work/current 不存在'}
# Validate the whole selected batch before any deletion, then recheck each target.
$oneRemoved=0L
if($Apply){foreach($oneTarget in $oneTargets){
 Assert-OnePlainDirectory (Join-Path $oneRepository 'work');Assert-OnePlainDirectory $oneCurrent
 $oneChecked=Get-OneCase $oneTarget.Name
 foreach($oneEntry in ($oneChecked.Entries | Sort-Object {$_.FullName.Length} -Descending)){
  $oneResolved=[IO.Path]::GetFullPath($oneEntry.FullName)
  if(-not $oneResolved.StartsWith($oneChecked.Path+'\',[StringComparison]::OrdinalIgnoreCase)){throw '清理子路径越界'}
  $oneNow=Get-Item -LiteralPath $oneResolved -Force
  if($oneNow.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '清理过程中发现链接，已停止'}
  # Delete explicit entries, never recurse through a replacement link.
  Remove-Item -LiteralPath $oneResolved -Force
 }
 Remove-Item -LiteralPath $oneChecked.Path -Force
 $oneRemoved+=$oneChecked.Bytes
}}
New-Item -ItemType Directory -Path $oneReportRoot -Force | Out-Null
$oneManifest=Join-Path $oneReportRoot 'cleanup-latest.json'
@{Apply=[bool]$Apply;Targets=@($oneTargets | Select-Object Name,Path,Bytes);Skipped=@($oneSkipped);RemovedBytes=$oneRemoved} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $oneManifest -Encoding utf8
[pscustomobject]@{Applied=[bool]$Apply;Targets=$oneTargets.Count;Skipped=$oneSkipped.Count;RemovedBytes=$oneRemoved;Manifest=$oneManifest} | ConvertTo-Json -Compress
