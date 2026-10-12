param([ValidateSet('status','set')][string]$Operation='status',[string]$Config)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$key='HKCU:\Software\One\ExplorerMenu'
$archiveExtensions=@('.zip','.zipx','.7z','.rar','.r00','.tar','.tgz','.gz','.txz','.xz','.jar','.apk','.bz2','.bzip2','.tbz','.tbz2','.zst','.zstd','.tzst','.cab','.lha','.lzh','.iso','.wim','.alz','.egg')
$archiveExtensions+=@(1..99|ForEach-Object{'.z{0:D2}' -f $_})
function Status {
 $v=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
 $packages=if($v.Locksmith -or $v.Rename -or $v.ArchiveCreate -or $v.ArchiveExtract){@(Get-AppxPackage -Name 'One.ExplorerMenu.*' -ErrorAction SilentlyContinue)}else{@()}
 $locks=$packages|Where-Object Name -EQ 'One.ExplorerMenu.Locksmith'
 $rename=$packages|Where-Object Name -EQ 'One.ExplorerMenu.Rename'
 $archiveCreate=$packages|Where-Object Name -EQ 'One.ExplorerMenu.ArchiveCreate'
 $archiveExtract=$packages|Where-Object Name -EQ 'One.ExplorerMenu.ArchiveExtract'
 $locksVerb=Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\OneLocks'
 $renameVerb=Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\OneRename'
 $createVerb=Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\OneArchiveCreate'
 $extractVerb=Test-Path -LiteralPath 'HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\OneArchiveExtract'
 $any=[bool]$v.Locksmith -or [bool]$v.Rename -or [bool]$v.ArchiveCreate -or [bool]$v.ArchiveExtract
 $classic=$any -and (!$v.Locksmith -or $locksVerb) -and (!$v.Rename -or $renameVerb) -and (!$v.ArchiveCreate -or $createVerb) -and (!$v.ArchiveExtract -or $extractVerb)
 @{locksmith=([bool]$v.Locksmith);rename=([bool]$v.Rename);archiveCreate=([bool]$v.ArchiveCreate);archiveExtract=([bool]$v.ArchiveExtract);classic=$classic;modern=($classic -and (!$v.Locksmith -or [bool]$locks) -and (!$v.Rename -or [bool]$rename) -and (!$v.ArchiveCreate -or [bool]$archiveCreate) -and (!$v.ArchiveExtract -or [bool]$archiveExtract))}
}
function Refresh-Shell {
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneShellNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2); }'
 [OneShellNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
}
function Write-LaunchConfig($root,$fields) {
 $binary=Join-Path $root 'shell-config.bin';$temporary=$binary+'.next'
 [IO.File]::WriteAllBytes($temporary,[Text.Encoding]::Unicode.GetBytes(($fields -join [char]0)+[char]0))
 Move-Item -LiteralPath $temporary -Destination $binary -Force
}
function Disable-LaunchConfig($root) {
 if(Test-Path -LiteralPath (Join-Path $root 'shell-config.bin')){Write-LaunchConfig $root @('','','','','0','0','0','0')}
}
try {
 if($Operation -eq 'set'){
  $changed=$false
  $modernBlocked=$false
  $c=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
  if(!(Test-Path -LiteralPath $key)){New-Item -Path $key -Force | Out-Null}
  $previous=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  foreach($menu in $c.menus){
   $flag=switch($menu.tool){'locksmith' {'Locksmith'} 'rename' {'Rename'} 'archive-create' {'ArchiveCreate'} 'archive-extract' {'ArchiveExtract'} default {throw '未知右键菜单类型'}}
   $hashName=$flag+'ManifestHash'
   $classicVerb=if($menu.tool -eq 'archive-extract'){'HKCU:\Software\Classes\SystemFileAssociations\.zip\shell\OneArchiveExtract'}else{"HKCU:\Software\Classes\*\shell\$($menu.verb)"}
   if(!$c.force -and [bool]$previous.$flag -eq [bool]$menu.enabled -and (!$menu.enabled -or ($previous.$hashName -eq $menu.manifestHash -and (Test-Path -LiteralPath $classicVerb) -and (Test-Path -LiteralPath (Join-Path $menu.root 'shell-config.bin'))))){continue}
   $changed=$true
   $existing=Get-AppxPackage -Name $menu.packageName -ErrorAction SilentlyContinue
   $clsid="Software\Classes\CLSID\{$($menu.clsid)}"
   if($menu.enabled){
    $icon=Join-Path $menu.root 'one.ico'
    # Explorer may activate the command as soon as registration completes.
    Write-LaunchConfig $menu.root @([string]$c.executable,[string]$c.appPath,[string]$c.profile,$icon,[string][int]($menu.tool -eq 'locksmith'),[string][int]($menu.tool -eq 'rename'),[string][int]($menu.tool -eq 'archive-create'),[string][int]($menu.tool -eq 'archive-extract'))
    $manifest=Join-Path $menu.root 'AppxManifest.xml';$template=Join-Path $menu.root 'AppxManifest.template.xml'
    $registeredVersion='';if(Test-Path -LiteralPath $manifest){try{[xml]$registered=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8;$registeredVersion=[string]$registered.Package.Identity.Version}catch{}}
    if(!$modernBlocked -and [Environment]::OSVersion.Version.Build -ge 22000 -and (!$existing -or $previous.$hashName -ne $menu.manifestHash -or $existing.InstallLocation -ne $menu.root -or $registeredVersion -ne [string]$existing.Version)){
     # Keep one verb per app identity so Windows 11 exposes two first-level commands.
     [xml]$xml=Get-Content -LiteralPath $template -Raw -Encoding UTF8
     $oldVersion=''
     try{
      if($existing){$version=[version]$existing.Version;$oldVersion=[string]$version;$xml.Package.Identity.Version="$($version.Major).$($version.Minor).$($version.Build).$($version.Revision+1)";$existing | Remove-AppxPackage -ErrorAction Stop}
      $xml.Save($manifest)
      $signed=Join-Path $PSScriptRoot ($menu.packageName+'.msix')
      if(Test-Path -LiteralPath $signed){Add-AppxPackage -Path $signed -ExternalLocation $menu.root -ErrorAction Stop}
      else{Add-AppxPackage -Register $manifest -ExternalLocation $menu.root -ErrorAction Stop}
      $installed=Get-AppxPackage -Name $menu.packageName -ErrorAction Stop
      if(!$installed){throw '菜单身份注册后未找到'}
      $xml.Package.Identity.Version=[string]$installed.Version;$xml.Save($manifest)
     }catch{
      # Unsigned loose packages require Developer Mode on some computers.
      # Classic per-user ExplorerCommandHandler registration remains usable.
      if($_.Exception.Message -match '0x80073CFF|开发者许可证|旁加载|sideload|developer license'){$modernBlocked=$true}
      else{throw}
     }
    }
    # Keep the classic menu available as well; only register this enabled command.
    $dll=(Select-Xml -LiteralPath $template -XPath "//*[local-name()='Class'][1]").Node.Path
    $server=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$clsid\InprocServer32")
    try{$server.SetValue('',(Join-Path $menu.root $dll));$server.SetValue('ThreadingModel','Apartment')}finally{$server.Dispose()}
    $types=if($menu.tool -eq 'archive-extract'){@($archiveExtensions|ForEach-Object{'SystemFileAssociations\'+$_})}else{@('*','Directory')}
    if($menu.tool -eq 'archive-extract'){[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('Software\Classes\*\shell\OneArchiveExtract',$false)}
    foreach($type in $types){
     $verb=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$type\shell\$($menu.verb)")
     try{$verb.SetValue('',[string]$menu.title);$verb.SetValue('ExplorerCommandHandler',"{$($menu.clsid)}");$verb.SetValue('MultiSelectModel','Player');$verb.SetValue('Icon',$icon)}finally{$verb.Dispose()}
    }
    New-ItemProperty -LiteralPath $key -Name $hashName -Value ([string]$menu.manifestHash) -PropertyType String -Force | Out-Null
   }else{
    Disable-LaunchConfig $menu.root
    if($existing){$existing | Remove-AppxPackage -ErrorAction Stop}
    $types=if($menu.tool -eq 'archive-extract'){@('*')+@($archiveExtensions|ForEach-Object{'SystemFileAssociations\'+$_})}else{@('*','Directory')}
    foreach($type in $types){[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("Software\Classes\$type\shell\$($menu.verb)",$false)}
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($clsid,$false)
   }
   New-ItemProperty -LiteralPath $key -Name $flag -Value ([int][bool]$menu.enabled) -PropertyType DWord -Force | Out-Null
  }
  # Retire the previous combined package after the replacement commands are ready.
  Disable-LaunchConfig $c.root
  Get-AppxPackage -Name 'One.ExplorerMenu' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction Stop
  Remove-ItemProperty -LiteralPath $key -Name ManifestHash -ErrorAction SilentlyContinue
 }
 Status | ConvertTo-Json -Compress
}catch{$s=Status;$s.error=$_.Exception.Message;$s | ConvertTo-Json -Compress}
finally{if($Operation -eq 'set' -and $changed){try{Refresh-Shell}catch{}}}
