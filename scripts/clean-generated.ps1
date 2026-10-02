param([switch]$Apply,[switch]$WorkOnly,[switch]$AllWork)
$ErrorActionPreference='Stop'
$oneRepository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$oneWorkRoots=@((Join-Path $oneRepository 'work'),'C:\Users\ruida\Documents\Codex\2026-09-13\dioa\work')
$oneReleaseRoots=@((Join-Path $oneRepository 'release'),'C:\Users\ruida\Documents\Codex\2026-09-13\dioa\release','E:\One-Releases')
$oneReportRoot='E:\One-Verification\storage'
New-Item -ItemType Directory -Path $oneReportRoot -Force | Out-Null
$oneActive=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(One|electron)\.exe$' } | ForEach-Object { $_.ExecutablePath })
$oneTargets=[Collections.Generic.List[object]]::new()
function Add-OneTarget([string]$onePath,[string]$oneRoot,[string]$oneReason) {
 $oneAbsolute=[IO.Path]::GetFullPath($onePath);$oneBoundary=[IO.Path]::GetFullPath($oneRoot).TrimEnd('\')+'\'
 if(-not $oneAbsolute.StartsWith($oneBoundary,[StringComparison]::OrdinalIgnoreCase)){throw "清理路径越界：$oneAbsolute"}
 if(-not (Test-Path -LiteralPath $oneAbsolute)){return}
 if($oneActive | Where-Object { $_ -and $_.StartsWith($oneAbsolute.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) }){return}
 $oneItem=Get-Item -LiteralPath $oneAbsolute -Force
 if($oneItem.Attributes -band [IO.FileAttributes]::ReparsePoint){return}
 if($oneItem.PSIsContainer -and (Get-ChildItem -LiteralPath $oneAbsolute -Recurse -Force -Attributes ReparsePoint | Select-Object -First 1)){return}
 $oneBytes=if($oneItem.PSIsContainer){(Get-ChildItem -LiteralPath $oneAbsolute -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum}else{$oneItem.Length}
 $oneTargets.Add([pscustomobject]@{Path=$oneAbsolute;Root=$oneBoundary;Reason=$oneReason;Bytes=[long]$oneBytes})
}
$oneTestText=(Get-ChildItem -LiteralPath (Join-Path $oneRepository 'tests') -File -Filter '*.cjs' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
foreach($oneRoot in $oneWorkRoots){
 if(-not (Test-Path -LiteralPath $oneRoot)){continue}
 if($AllWork){
  $oneHistory=Join-Path $oneReportRoot ('history-'+([IO.Path]::GetPathRoot($oneRoot).Substring(0,1)))
  New-Item -ItemType Directory -Path $oneHistory -Force | Out-Null
  # Preserve compact top-level reports, not fixture contents or browser profiles.
  foreach($oneScope in @($oneRoot)+@(Get-ChildItem -LiteralPath $oneRoot -Directory | Where-Object { $_.Name -notin @('rust-search','npm-cache','archive-dotnet-20260930','research-0.5','research-powertoys') } | ForEach-Object { $_.FullName })){
   $oneDestination=if($oneScope -eq $oneRoot){$oneHistory}else{Join-Path $oneHistory ([IO.Path]::GetFileName($oneScope))}
   foreach($oneEvidence in Get-ChildItem -LiteralPath $oneScope -File -Force | Where-Object { $_.Extension -in @('.json','.log','.png','.md') -and $_.Length -lt 4MB }){New-Item -ItemType Directory -Path $oneDestination -Force | Out-Null;Copy-Item -LiteralPath $oneEvidence.FullName -Destination (Join-Path $oneDestination $oneEvidence.Name) -Force}
  }
  foreach($oneChild in Get-ChildItem -LiteralPath $oneRoot -Force){if($oneChild.Name -ne 'rust-search'){Add-OneTarget $oneChild.FullName $oneRoot '用户授权：清理历史 work 缓存与冗余副本'}}
  continue
 }
 foreach($oneDirectory in Get-ChildItem -LiteralPath $oneRoot -Directory -Force){
  $oneName=$oneDirectory.Name
  if($oneName -in @('rust-search','npm-cache','build-temp','research-0.5','research-powertoys','preview-deps','one-docs','textpro-help','archive-dotnet-20260930')){continue}
  $oneRecognized=$oneTestText.Contains('work/'+$oneName) -or $oneTestText.Contains('work\'+$oneName) -or $oneName -match '^(menu-action-|quit-|color-probe-|pin-profile-|debug-preview-|regression-|verification-|file-tools-0\.|fonts-0\.|ui-polish-0\.|build-0\.6\.1-before-scan-fix$)'
  if(-not $oneRecognized){continue}
  # Keep small evidence and scripts; discard only generated child trees.
  foreach($oneChild in Get-ChildItem -LiteralPath $oneDirectory.FullName -Directory -Force){Add-OneTarget $oneChild.FullName $oneRoot '过期测试样本、隔离配置或构建副本'}
 }
 $oneLegacy=Join-Path $oneRoot 'archive-dotnet-20260930'
 foreach($oneName in @('.tools','.tools-remaining','artifacts','artifacts-remaining')){Add-OneTarget (Join-Path $oneLegacy $oneName) $oneRoot '旧框架工具链与可重建产物，保留源码'}
 foreach($oneName in @('levels.obj','disk-monitor.obj','window-tools.obj','open-with.obj','system-tools.obj','search-bridge.obj','electron-v44.5.1-win32-x64.zip','vscode-icons.zip')){Add-OneTarget (Join-Path $oneRoot $oneName) $oneRoot '可重新生成的编译/下载副本'}
}
if($AllWork){Add-OneTarget (Join-Path $oneRepository 'dist') $oneRepository '用户授权：构建目录可从 Git 源码重建'}
$oneRetained=@()
if(-not $WorkOnly){
 $onePackages=@(foreach($oneRoot in $oneReleaseRoots){if(Test-Path -LiteralPath $oneRoot){foreach($oneDirectory in Get-ChildItem -LiteralPath $oneRoot -Directory){if($oneDirectory.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $oneDirectory.FullName 'win-unpacked\One.exe')) -and (Test-Path -LiteralPath (Join-Path $oneDirectory.FullName 'win-unpacked\resources\app.asar'))){[pscustomobject]@{Path=$oneDirectory.FullName;Root=$oneRoot;Version=[version]$oneDirectory.Name}}}}})
 $oneRetained=@($onePackages.Version | Sort-Object -Descending -Unique | Select-Object -First 2)
 foreach($onePackage in $onePackages){if($onePackage.Version -notin $oneRetained -and $onePackage.Version -ne [version]'0.15.2'){Add-OneTarget $onePackage.Path $onePackage.Root '用户授权：旧发布包只保留最新两版及使用中的版本'}}
}
$oneManifest=Join-Path $oneReportRoot ('cleanup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
@{Apply=[bool]$Apply;RetainedVersions=@($oneRetained | ForEach-Object { $_.ToString() });ProtectedVersion='0.15.2';ActiveExecutables=$oneActive;Targets=$oneTargets;PlannedBytes=($oneTargets | Measure-Object Bytes -Sum).Sum} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $oneManifest -Encoding utf8
$oneRemoved=0L
if($Apply){foreach($oneTarget in $oneTargets){
 # Recheck the absolute target immediately before each recursive delete.
 $oneResolved=[IO.Path]::GetFullPath((Get-Item -LiteralPath $oneTarget.Path -Force).FullName)
 if(-not $oneResolved.StartsWith($oneTarget.Root,[StringComparison]::OrdinalIgnoreCase)){throw '清理路径变化，已停止'}
 Remove-Item -LiteralPath $oneResolved -Recurse -Force
 $oneRemoved+=$oneTarget.Bytes
}}
[pscustomobject]@{Applied=[bool]$Apply;Targets=$oneTargets.Count;PlannedGiB=[math]::Round((($oneTargets | Measure-Object Bytes -Sum).Sum)/1GB,3);RemovedGiB=[math]::Round($oneRemoved/1GB,3);Manifest=$oneManifest;RetainedVersions=($oneRetained -join ',')} | ConvertTo-Json -Compress
