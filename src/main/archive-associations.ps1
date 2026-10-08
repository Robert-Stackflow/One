param([ValidateSet('status','register','remove')][string]$Operation='status',[string]$Executable,[string]$Icon,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$archiveProgId='One.Archive'
$archiveAppName='One 压缩与解压'
$archiveExtensions=@('.zip','.7z','.rar','.r00','.tar','.tgz','.gz','.txz','.xz')
$archiveCapabilities='One\Archive\Capabilities'

# Accept a RegistryKey so tests can exercise the same logic below an isolated
# test branch. The production entry point always passes HKCU\Software.
function Get-OneArchiveRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable) {
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
 foreach($extension in $archiveExtensions){
  $key=$Software.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{if(!$key -or $key.GetValueNames() -notcontains $archiveProgId){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey($archiveCapabilities+'\FileAssociations')
  try{if(!$key -or $key.GetValue($extension) -ne $archiveProgId){return $false}}finally{if($key){$key.Dispose()}}
 }
 return $true
}
function Set-OneArchiveValue([Microsoft.Win32.RegistryKey]$Software,[string]$Path,[string]$Name,[string]$Value) {
 $key=$Software.CreateSubKey($Path)
 try{$key.SetValue($Name,$Value,[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose()}
}
function Install-OneArchiveRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$AppExecutable,[string]$AppIcon) {
 if(![IO.Path]::IsPathRooted($AppExecutable) -or $AppExecutable.IndexOfAny([char[]]@('"',[char]0,[char]10,[char]13)) -ge 0){throw '程序路径无效'}
 if(![IO.Path]::IsPathRooted($AppIcon) -or $AppIcon.Contains('"')){throw '图标路径无效'}
 $prog='Classes\'+$archiveProgId
 Set-OneArchiveValue $Software $prog '' 'One 压缩包'
 Set-OneArchiveValue $Software $prog 'OneExecutable' $AppExecutable
 Set-OneArchiveValue $Software $prog 'FriendlyTypeName' 'One 压缩包'
 Set-OneArchiveValue $Software ($prog+'\DefaultIcon') '' ('"'+$AppIcon+'",0')
 Set-OneArchiveValue $Software ($prog+'\shell\open\command') '' ('"'+$AppExecutable+'" "--one-archive=%1"')
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationName' $archiveAppName
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationDescription' '浏览、压缩与安全解压常用压缩包。'
 Set-OneArchiveValue $Software $archiveCapabilities 'ApplicationIcon' ('"'+$AppIcon+'",0')
 foreach($extension in $archiveExtensions){
  # Candidate only: preserve existing extension defaults and UserChoice.
  Set-OneArchiveValue $Software ('Classes\'+$extension+'\OpenWithProgids') $archiveProgId ''
  Set-OneArchiveValue $Software ($archiveCapabilities+'\FileAssociations') $extension $archiveProgId
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
  $key=$Software.OpenSubKey('Classes\'+$extension+'\OpenWithProgids',$true)
  try{if($key){$key.DeleteValue($archiveProgId,$false)}}finally{if($key){$key.Dispose()}}
 }
 $key=$Software.OpenSubKey('RegisteredApplications',$true)
 try{if($key -and $key.GetValue($archiveAppName) -eq ('Software\'+$archiveCapabilities)){$key.DeleteValue($archiveAppName,$false)}}finally{if($key){$key.Dispose()}}
 $Software.DeleteSubKeyTree('Classes\'+$archiveProgId,$false)
 $Software.DeleteSubKeyTree($archiveCapabilities,$false)
}
if($LibraryOnly){return}
$software=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software',$true)
try {
 if($Operation -eq 'register'){Install-OneArchiveRegistration $software $Executable $Icon}
 if($Operation -eq 'remove'){Remove-OneArchiveRegistration $software $Executable}
 @{registered=(Get-OneArchiveRegistration $software $Executable)} | ConvertTo-Json -Compress
}finally {
 $software.Dispose()
 if($Operation -ne 'status'){
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneArchiveNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2); }'
  [OneArchiveNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
 }
}
