param([ValidateSet('status','register','remove')][string]$Operation='status',[string]$Executable,[string]$Icon,[string]$IconDirectory,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$archiveProgId='One.Archive'
$archiveAppName='One 压缩与解压'
$archiveExtensions=@('.zip','.7z','.rar','.r00','.tar','.tgz','.gz','.txz','.xz','.zipx','.jar','.apk','.bz2','.bzip2','.tbz','.tbz2','.zst','.zstd','.tzst','.cab','.lha','.lzh','.iso','.wim')
$archiveCapabilities='One\Archive\Capabilities'

# Accept a RegistryKey so tests can exercise the same logic below an isolated
# test branch. The production entry point always passes HKCU\Software.
function Get-OneArchiveLegacyRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable) {
 $key=$Software.OpenSubKey('Classes\'+$archiveProgId)
 if(!$key){return $false}
 try {
  if(![string]::Equals([string]$key.GetValue('OneExecutable'),$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)){return $false}
  $command=$key.OpenSubKey('shell\open\command')
  try{if(!$command -or $command.GetValue('') -ne ('"'+$ExpectedExecutable+'" "--one-archive=%1"')){return $false}}finally{if($command){$command.Dispose()}}
 }finally{$key.Dispose()}
 $registered=$Software.OpenSubKey('RegisteredApplications')
 try{if(!$registered -or $registered.GetValue($archiveAppName) -ne ('Software\'+$archiveCapabilities)){return $false}}finally{if($registered){$registered.Dispose()}}
 $key=$Software.OpenSubKey($archiveCapabilities)
 try{if(!$key -or $key.GetValue('ApplicationName') -ne $archiveAppName){return $false}}finally{if($key){$key.Dispose()}}
 return $true
}
function Get-OneArchiveRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable,[string]$ExpectedIcons) {
 if(!(Get-OneArchiveLegacyRegistration $Software $ExpectedExecutable)){return $false}
 foreach($extension in $archiveExtensions){
  $format=$extension.Substring(1)
  $formatProgId=$archiveProgId+'.'+$format.ToUpperInvariant()
  $key=$Software.OpenSubKey('Classes\'+$formatProgId)
  try{if(!$key -or ![string]::Equals([string]$key.GetValue('OneExecutable'),$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey('Classes\'+$formatProgId+'\shell\open\command')
  try{if(!$key -or $key.GetValue('') -ne ('"'+$ExpectedExecutable+'" "--one-archive=%1"')){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey('Classes\'+$formatProgId+'\DefaultIcon')
  try{if(!$key -or !$ExpectedIcons -or $key.GetValue('') -ne ('"'+[IO.Path]::Combine($ExpectedIcons,$format+'.ico')+'",0')){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{if(!$key -or $key.GetValueNames() -notcontains $formatProgId){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey($archiveCapabilities+'\FileAssociations')
  try{if(!$key -or $key.GetValue($extension) -ne $formatProgId){return $false}}finally{if($key){$key.Dispose()}}
 }
 return $true
}
function Set-OneArchiveValue([Microsoft.Win32.RegistryKey]$Software,[string]$Path,[string]$Name,[string]$Value) {
 $key=$Software.CreateSubKey($Path)
 try{$key.SetValue($Name,$Value,[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose()}
}
function Install-OneArchiveRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$AppExecutable,[string]$AppIcon,[string]$ArchiveIcons) {
 if(![IO.Path]::IsPathRooted($AppExecutable) -or $AppExecutable.IndexOfAny([char[]]@('"',[char]0,[char]10,[char]13)) -ge 0){throw '程序路径无效'}
 if(![IO.Path]::IsPathRooted($AppIcon) -or $AppIcon.Contains('"')){throw '图标路径无效'}
 if(![IO.Path]::IsPathRooted($ArchiveIcons) -or $ArchiveIcons.IndexOfAny([char[]]@('"',[char]0,[char]10,[char]13)) -ge 0){throw '压缩包图标目录无效'}
 # Validate the complete resource set before changing any registry values.
 foreach($format in @('archive')+@($archiveExtensions|ForEach-Object{$_.Substring(1)})){
  if(![IO.File]::Exists([IO.Path]::Combine($ArchiveIcons,$format+'.ico'))){throw ('缺少压缩包图标：'+$format)}
 }
 $prog='Classes\'+$archiveProgId
 Set-OneArchiveValue $Software $prog '' 'One 压缩包'
 Set-OneArchiveValue $Software $prog 'OneExecutable' $AppExecutable
 Set-OneArchiveValue $Software $prog 'FriendlyTypeName' 'One 压缩包'
 # Retain the legacy ProgID for users who already selected it in Windows.
 Set-OneArchiveValue $Software ($prog+'\DefaultIcon') '' ('"'+[IO.Path]::Combine($ArchiveIcons,'archive.ico')+'",0')
 Set-OneArchiveValue $Software ($prog+'\shell\open\command') '' ('"'+$AppExecutable+'" "--one-archive=%1"')
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationName' $archiveAppName
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationDescription' '浏览、压缩与安全解压常用压缩包。'
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationIcon' ('"'+$AppIcon+'",0')
 foreach($extension in $archiveExtensions){
  $format=$extension.Substring(1)
  $formatProgId=$archiveProgId+'.'+$format.ToUpperInvariant()
  $formatKey='Classes\'+$formatProgId
  Set-OneArchiveValue $Software $formatKey '' ('One '+$format.ToUpperInvariant()+' 压缩包')
  Set-OneArchiveValue $Software $formatKey 'FriendlyTypeName' ('One '+$format.ToUpperInvariant()+' 压缩包')
  Set-OneArchiveValue $Software $formatKey 'OneExecutable' $AppExecutable
  Set-OneArchiveValue $Software ($formatKey+'\DefaultIcon') '' ('"'+[IO.Path]::Combine($ArchiveIcons,$format+'.ico')+'",0')
  Set-OneArchiveValue $Software ($formatKey+'\shell\open\command') '' ('"'+$AppExecutable+'" "--one-archive=%1"')
  # Candidate only: preserve existing extension defaults and UserChoice.
  Set-OneArchiveValue $Software ('Classes\'+$extension+'\OpenWithProgids') $formatProgId ''
  Set-OneArchiveValue $Software ($archiveCapabilities+'\FileAssociations') $extension $formatProgId
  $key=$Software.OpenSubKey('Classes\'+$extension+'\OpenWithProgids',$true)
  try{$key.DeleteValue($archiveProgId,$false)}finally{$key.Dispose()}
 }
 Set-OneArchiveValue $Software 'RegisteredApplications' $archiveAppName ('Software\'+$archiveCapabilities)
}
function Remove-OneArchiveRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable) {
 $key=$Software.OpenSubKey('Classes\'+$archiveProgId)
 if(!$key){return}
 try{$owned=[string]::Equals([string]$key.GetValue('OneExecutable'),$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)}finally{$key.Dispose()}
 # A different installation may now own the registration. Never remove it.
 if(!$owned){return}
 foreach($extension in $archiveExtensions){
  $formatProgId=$archiveProgId+'.'+$extension.Substring(1).ToUpperInvariant()
  $key=$Software.OpenSubKey('Classes\'+$formatProgId)
  try{$formatOwned=$key -and [string]::Equals([string]$key.GetValue('OneExecutable'),$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey('Classes\'+$extension+'\OpenWithProgids',$true)
  try{if($key){$key.DeleteValue($archiveProgId,$false);if($formatOwned){$key.DeleteValue($formatProgId,$false)}}}finally{if($key){$key.Dispose()}}
  if($formatOwned){$Software.DeleteSubKeyTree('Classes\'+$formatProgId,$false)}
 }
 $key=$Software.OpenSubKey('RegisteredApplications',$true)
 try{if($key -and $key.GetValue($archiveAppName) -eq ('Software\'+$archiveCapabilities)){$key.DeleteValue($archiveAppName,$false)}}finally{if($key){$key.Dispose()}}
 $Software.DeleteSubKeyTree('Classes\'+$archiveProgId,$false)
 $Software.DeleteSubKeyTree($archiveCapabilities,$false)
}
if($LibraryOnly){return}
$software=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software',$true)
try {
 if($Operation -eq 'register'){Install-OneArchiveRegistration $software $Executable $Icon $IconDirectory}
 if($Operation -eq 'remove'){Remove-OneArchiveRegistration $software $Executable}
 $complete=Get-OneArchiveRegistration $software $Executable $IconDirectory
 @{registered=$complete;needsUpdate=(!$complete -and (Get-OneArchiveLegacyRegistration $software $Executable))} | ConvertTo-Json -Compress
}finally {
 $software.Dispose()
 if($Operation -ne 'status'){
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneArchiveNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2); }'
  [OneArchiveNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
 }
}
