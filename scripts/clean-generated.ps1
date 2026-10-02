param([switch]$Apply,[switch]$WorkOnly,[switch]$AllWork,[switch]$VerificationCaches)
$ErrorActionPreference='Stop'
$oneRepository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$oneWorkRoots=@((Join-Path $oneRepository 'work'),'C:\Users\ruida\Documents\Codex\2026-09-13\dioa\work')
$oneReleaseRoots=@((Join-Path $oneRepository 'release'),'C:\Users\ruida\Documents\Codex\2026-09-13\dioa\release','E:\One-Releases')
$oneReportRoot=Join-Path $oneRepository 'verification\storage'
New-Item -ItemType Directory -Path $oneReportRoot -Force | Out-Null
$oneActive=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(One|electron)\.exe$' } | ForEach-Object { $_.ExecutablePath })
$oneTargets=[Collections.Generic.List[object]]::new()
function Add-OneTarget([string]$onePath,[string]$oneRoot,[string]$oneReason) {
 $oneAbsolute=[IO.Path]::GetFullPath($onePath);$oneBoundary=[IO.Path]::GetFullPath($oneRoot).TrimEnd('\')+'\'
 if(-not $oneAbsolute.StartsWith($oneBoundary,[StringComparison]::OrdinalIgnoreCase)){throw "清理路径越界：$oneAbsolute"}
 if(-not (Test-Path -LiteralPath $oneAbsolute)){return}
 if($oneActive | Where-Object { $_ -and $_.StartsWith($oneAbsolute.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) }){return}
 $oneItem=Get-Item -LiteralPath $oneAbsolute -Force
 $oneBytes=if($oneItem.Attributes -band [IO.FileAttributes]::ReparsePoint){0}elseif($oneItem.PSIsContainer){(Get-ChildItem -LiteralPath $oneAbsolute -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum}else{$oneItem.Length}
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
  foreach($oneChild in Get-ChildItem -LiteralPath $oneRoot -Force){if($oneChild.Name -notin @('rust-search','current','dev-profile','temp','.one-generated-workspace')){Add-OneTarget $oneChild.FullName $oneRoot '用户授权：清理历史 work 缓存与冗余副本'}}
  continue
 }
 foreach($oneDirectory in Get-ChildItem -LiteralPath $oneRoot -Directory -Force){
  $oneName=$oneDirectory.Name
  if($oneName -in @('rust-search','current','dev-profile','temp','builder-cache','unit','npm-cache','build-temp','research-0.5','research-powertoys','preview-deps','one-docs','textpro-help','archive-dotnet-20260930')){continue}
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
if(Test-Path -LiteralPath (Join-Path $oneRepository 'work\rust-search\release\one-index.exe')){Add-OneTarget (Join-Path $oneRepository 'native\search-engine\target') $oneRepository '使用单一 Rust 缓存，清理旧重复缓存'}
if($VerificationCaches){
 $oneVerification=Join-Path $oneRepository 'verification'
 foreach($oneVersion in Get-ChildItem -LiteralPath $oneVerification -Directory | Where-Object {$_.Name -match '^\d+\.\d+\.\d+$'}){
  foreach($oneCase in Get-ChildItem -LiteralPath $oneVersion.FullName -Directory){
   if($oneCase.Name -match '^(structure-files|csv-files|directory-files|temp|unit|disk-full-test-artifacts)$'){Add-OneTarget $oneCase.FullName $oneVerification '历史验证的可重建样本与编译副本';continue}
   foreach($oneChild in Get-ChildItem -LiteralPath $oneCase.FullName -Directory){Add-OneTarget $oneChild.FullName $oneVerification '历史验证的隔离配置与样本，保留日志和截图'}
  }
 }
}
$oneRetained=@()
if(-not $WorkOnly){
 $onePackages=@(foreach($oneRoot in $oneReleaseRoots){if(Test-Path -LiteralPath $oneRoot){foreach($oneDirectory in Get-ChildItem -LiteralPath $oneRoot -Directory){if($oneDirectory.Name -match '^\d+\.\d+\.\d+$'){[pscustomobject]@{Path=$oneDirectory.FullName;Root=$oneRoot;Version=[version]$oneDirectory.Name;Usable=((Test-Path -LiteralPath (Join-Path $oneDirectory.FullName 'win-unpacked\One.exe')) -and (Test-Path -LiteralPath (Join-Path $oneDirectory.FullName 'win-unpacked\resources\app.asar')))}}}}})
 $oneRetained=@($onePackages | Where-Object Usable | ForEach-Object { $_.Version } | Sort-Object -Descending -Unique | Select-Object -First 2)
 foreach($onePackage in $onePackages){if($onePackage.Version -notin $oneRetained){Add-OneTarget $onePackage.Path $onePackage.Root '用户授权：只保留两个最新可运行版本'}}
 foreach($oneRoot in $oneReleaseRoots){$oneLegacy=Join-Path $oneRoot 'win-unpacked';if(Test-Path -LiteralPath (Join-Path $oneLegacy 'One.exe')){Add-OneTarget $oneLegacy $oneRoot '用户授权：旧的未编号发布副本'}}
}
$oneManifest=Join-Path $oneReportRoot ('cleanup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
@{Apply=[bool]$Apply;RetainedVersions=@($oneRetained | ForEach-Object { $_.ToString() });ActiveExecutables=$oneActive;Targets=$oneTargets;PlannedBytes=($oneTargets | Measure-Object Bytes -Sum).Sum} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $oneManifest -Encoding utf8
$oneRemoved=0L
function Remove-OneTree([string]$onePath,[string]$oneBoundary){
 $oneItem=Get-Item -LiteralPath $onePath -Force
 $oneAbsolute=[IO.Path]::GetFullPath($oneItem.FullName)
 if(-not $oneAbsolute.StartsWith($oneBoundary,[StringComparison]::OrdinalIgnoreCase)){throw '清理子路径越界'}
 # Delete a link itself, never enumerate or delete its destination.
 if($oneItem.PSIsContainer -and -not ($oneItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){foreach($oneChild in Get-ChildItem -LiteralPath $oneAbsolute -Force){Remove-OneTree $oneChild.FullName $oneBoundary}}
 Remove-Item -LiteralPath $oneAbsolute -Force
}
if($Apply){foreach($oneTarget in $oneTargets){
 # Recheck the absolute target immediately before each recursive delete.
 $oneResolved=[IO.Path]::GetFullPath((Get-Item -LiteralPath $oneTarget.Path -Force).FullName)
 if(-not $oneResolved.StartsWith($oneTarget.Root,[StringComparison]::OrdinalIgnoreCase)){throw '清理路径变化，已停止'}
 Remove-OneTree $oneResolved $oneTarget.Root
 $oneRemoved+=$oneTarget.Bytes
}}
[pscustomobject]@{Applied=[bool]$Apply;Targets=$oneTargets.Count;PlannedGiB=[math]::Round((($oneTargets | Measure-Object Bytes -Sum).Sum)/1GB,3);RemovedGiB=[math]::Round($oneRemoved/1GB,3);Manifest=$oneManifest;RetainedVersions=($oneRetained -join ',')} | ConvertTo-Json -Compress
