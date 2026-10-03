param([ValidateSet('status','set')][string]$Operation='status',[string]$Config)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$key='HKCU:\Software\One\ExplorerMenu'
$packageName='One.ExplorerMenu'
function Status {
 $v=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
 $package=Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue
 @{locksmith=([bool]$v.Locksmith);rename=([bool]$v.Rename);modern=([bool]$package)}
}
try {
 if($Operation -eq 'set'){
  $c=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  if($c.locksmith -or $c.rename){
   $existing=Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue
   $manifest=Join-Path $c.root 'AppxManifest.xml'
   $previous=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
   if([Environment]::OSVersion.Version.Build -ge 22000 -and (!$existing -or $previous.ManifestHash -ne $c.manifestHash -or $existing.InstallLocation -ne $c.root)){
    # A distributor may supply a signed sparse package; local development uses manifest registration.
    $signed=Join-Path $PSScriptRoot 'One.Shell.msix'
    if(Test-Path -LiteralPath $signed){Add-AppxPackage -Path $signed -ExternalLocation $c.root -ErrorAction Stop}
    else {
     if($existing){[xml]$xml=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8;$version=[version]$existing.Version;$xml.Package.Identity.Version="$($version.Major).$($version.Minor).$($version.Build).$($version.Revision+1)";$xml.Save($manifest)}
     Add-AppxPackage -Register $manifest -ExternalLocation $c.root -ErrorAction Stop
    }
   }
   New-Item -Path $key -Force | Out-Null
   foreach($pair in @(@('Executable',$c.executable),@('AppPath',$c.appPath),@('Profile',$c.profile),@('Icon',$c.icon),@('ManifestHash',$c.manifestHash))){New-ItemProperty -LiteralPath $key -Name $pair[0] -Value ([string]$pair[1]) -PropertyType String -Force | Out-Null}
   foreach($pair in @(@('Locksmith',$c.locksmith),@('Rename',$c.rename))){New-ItemProperty -LiteralPath $key -Name $pair[0] -Value ([int][bool]$pair[1]) -PropertyType DWord -Force | Out-Null}
   # Packaged COM runs with its own registry view. Keep the shell's small launch configuration beside its DLL.
   $fields=@([string]$c.executable,[string]$c.appPath,[string]$c.profile,[string]$c.icon,[string][int][bool]$c.locksmith,[string][int][bool]$c.rename)
   $binary=Join-Path $c.root 'shell-config.bin';$temporary=$binary+'.next';[IO.File]::WriteAllBytes($temporary,[Text.Encoding]::Unicode.GetBytes(($fields -join [char]0)+[char]0));Move-Item -LiteralPath $temporary -Destination $binary -Force
   if([Environment]::OSVersion.Version.Build -lt 22000){
    $dll=(Select-Xml -LiteralPath $manifest -XPath "//*[local-name()='Class'][1]").Node.Path
    foreach($pair in @(@('OneLocks','49A8359C-85B9-4E7A-905E-6A724911750A','文件占用 · One',$c.locksmith),@('OneRename','57ABA3E6-8D9A-4A16-A717-6541B2241A36','批量重命名 · One',$c.rename))){
     $clsid="HKCU:\Software\Classes\CLSID\{$($pair[1])}\InprocServer32";New-Item -Path $clsid -Force | Out-Null;Set-Item -LiteralPath $clsid -Value (Join-Path $c.root $dll);New-ItemProperty -LiteralPath $clsid -Name ThreadingModel -Value Apartment -Force | Out-Null
     foreach($type in @('*','Directory')){$verb="HKCU:\Software\Classes\$type\shell\$($pair[0])";if($pair[3]){New-Item -Path $verb -Force | Out-Null;Set-Item -LiteralPath $verb -Value $pair[2];New-ItemProperty -LiteralPath $verb -Name ExplorerCommandHandler -Value "{$($pair[1])}" -Force | Out-Null;New-ItemProperty -LiteralPath $verb -Name MultiSelectModel -Value Player -Force | Out-Null;New-ItemProperty -LiteralPath $verb -Name Icon -Value $c.icon -Force | Out-Null}else{Remove-Item -LiteralPath $verb -Recurse -Force -ErrorAction SilentlyContinue}}
    }
   }
  }else{
   Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction Stop
   foreach($type in @('*','Directory')){foreach($verb in @('OneLocks','OneRename')){Remove-Item -LiteralPath "HKCU:\Software\Classes\$type\shell\$verb" -Recurse -Force -ErrorAction SilentlyContinue}}
   foreach($clsid in @('49A8359C-85B9-4E7A-905E-6A724911750A','57ABA3E6-8D9A-4A16-A717-6541B2241A36')){Remove-Item -LiteralPath "HKCU:\Software\Classes\CLSID\{$clsid}" -Recurse -Force -ErrorAction SilentlyContinue}
   Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue
   $binary=Join-Path $c.root 'shell-config.bin';if(Test-Path -LiteralPath $binary){[IO.File]::WriteAllBytes($binary,[Text.Encoding]::Unicode.GetBytes(([string]::Empty+[char]0)*6))}
  }
 }
 Status | ConvertTo-Json -Compress
}catch{$s=Status;$s.error=$_.Exception.Message;$s | ConvertTo-Json -Compress}
