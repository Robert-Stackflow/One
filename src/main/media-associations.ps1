param([ValidateSet('status','register','remove')][string]$Operation='status',[string]$Executable,[string]$Icon,[switch]$LibraryOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$mediaAppName='One 图片与录制工程'
$mediaCapabilities='One\Media\Capabilities'
$mediaFormats=@(
 @{Extension='.oneimage';ProgId='One.ImageProject';Name='One 图片工程'},
 @{Extension='.onerec';ProgId='One.RecordingProject';Name='One 录制工程'}
)
function Set-OneMediaValue([Microsoft.Win32.RegistryKey]$Software,[string]$Path,[string]$Name,[string]$Value){
 $key=$Software.CreateSubKey($Path)
 try{$key.SetValue($Name,$Value,[Microsoft.Win32.RegistryValueKind]::String)}finally{$key.Dispose()}
}
function Test-OneMediaOwner([Microsoft.Win32.RegistryKey]$Software,[string]$Path,[string]$ExpectedExecutable){
 if([string]::IsNullOrWhiteSpace($ExpectedExecutable)){return $false}
 $key=$Software.OpenSubKey($Path)
 try{return $key -and [string]::Equals([string]$key.GetValue('OneExecutable'),$ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)}finally{if($key){$key.Dispose()}}
}
function Get-OneMediaRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable,[string]$ExpectedIcon){
 if(!(Test-OneMediaOwner $Software $mediaCapabilities $ExpectedExecutable)){return $false}
 $key=$Software.OpenSubKey('RegisteredApplications')
 try{if(!$key -or $key.GetValue($mediaAppName) -ne ('Software\'+$mediaCapabilities)){return $false}}finally{if($key){$key.Dispose()}}
 foreach($format in $mediaFormats){
  $prog='Classes\'+$format.ProgId
  if(!(Test-OneMediaOwner $Software $prog $ExpectedExecutable)){return $false}
  $key=$Software.OpenSubKey($prog+'\shell\open\command')
  try{if(!$key -or $key.GetValue('') -ne ('"'+$ExpectedExecutable+'" "--one-project=%1"')){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey($prog+'\DefaultIcon')
  try{if(!$key -or $key.GetValue('') -ne ('"'+$ExpectedIcon+'",0')){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey('Classes\'+$format.Extension+'\OpenWithProgids')
  try{if(!$key -or $key.GetValueNames() -notcontains $format.ProgId){return $false}}finally{if($key){$key.Dispose()}}
  $key=$Software.OpenSubKey($mediaCapabilities+'\FileAssociations')
  try{if(!$key -or $key.GetValue($format.Extension) -ne $format.ProgId){return $false}}finally{if($key){$key.Dispose()}}
 }
 return $true
}
function Install-OneMediaRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$AppExecutable,[string]$AppIcon){
 foreach($value in @($AppExecutable,$AppIcon)){
  if(![IO.Path]::IsPathRooted($value) -or $value.IndexOfAny([char[]]@('"',[char]0,[char]10,[char]13)) -ge 0){throw 'One 工程关联路径无效'}
 }
 foreach($format in $mediaFormats){
  $prog='Classes\'+$format.ProgId
  Set-OneMediaValue $Software $prog '' $format.Name
  Set-OneMediaValue $Software $prog 'FriendlyTypeName' $format.Name
  Set-OneMediaValue $Software $prog 'OneExecutable' $AppExecutable
  Set-OneMediaValue $Software ($prog+'\DefaultIcon') '' ('"'+$AppIcon+'",0')
  Set-OneMediaValue $Software ($prog+'\shell\open\command') '' ('"'+$AppExecutable+'" "--one-project=%1"')
  $extension='Classes\'+$format.Extension
  Set-OneMediaValue $Software ($extension+'\OpenWithProgids') $format.ProgId ''
  $key=$Software.OpenSubKey($extension,$true)
  try{if(![string]$key.GetValue('')){$key.SetValue('',$format.ProgId,[Microsoft.Win32.RegistryValueKind]::String)}}finally{$key.Dispose()}
  Set-OneMediaValue $Software ($mediaCapabilities+'\FileAssociations') $format.Extension $format.ProgId
 }
 Set-OneMediaValue $Software $mediaCapabilities 'OneExecutable' $AppExecutable
 Set-OneMediaValue $Software $mediaCapabilities 'ApplicationName' $mediaAppName
 Set-OneMediaValue $Software $mediaCapabilities 'ApplicationDescription' '打开与编辑 One 图片、录屏和录音工程。'
 Set-OneMediaValue $Software $mediaCapabilities 'ApplicationIcon' ('"'+$AppIcon+'",0')
 Set-OneMediaValue $Software 'RegisteredApplications' $mediaAppName ('Software\'+$mediaCapabilities)
}
function Remove-OneMediaRegistration([Microsoft.Win32.RegistryKey]$Software,[string]$ExpectedExecutable){
 foreach($format in $mediaFormats){
  $prog='Classes\'+$format.ProgId
  if(!(Test-OneMediaOwner $Software $prog $ExpectedExecutable)){continue}
  $key=$Software.OpenSubKey('Classes\'+$format.Extension,$true)
  try{if($key){
   if($key.GetValue('') -eq $format.ProgId){$key.DeleteValue('',$false)}
   $candidates=$key.OpenSubKey('OpenWithProgids',$true)
   try{if($candidates){$candidates.DeleteValue($format.ProgId,$false)}}finally{if($candidates){$candidates.Dispose()}}
  }}finally{if($key){$key.Dispose()}}
  $Software.DeleteSubKeyTree($prog,$false)
 }
 if(Test-OneMediaOwner $Software $mediaCapabilities $ExpectedExecutable){
  $key=$Software.OpenSubKey('RegisteredApplications',$true)
  try{if($key -and $key.GetValue($mediaAppName) -eq ('Software\'+$mediaCapabilities)){$key.DeleteValue($mediaAppName,$false)}}finally{if($key){$key.Dispose()}}
  $Software.DeleteSubKeyTree($mediaCapabilities,$false)
 }
}
if($LibraryOnly){return}
$software=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software',$true)
try{
 if($Operation -eq 'register'){Install-OneMediaRegistration $software $Executable $Icon}
 if($Operation -eq 'remove'){Remove-OneMediaRegistration $software $Executable}
 @{registered=(Get-OneMediaRegistration $software $Executable $Icon)}|ConvertTo-Json -Compress
}finally{
 $software.Dispose()
 if($Operation -ne 'status'){
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneMediaNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId,uint flags,IntPtr item1,IntPtr item2); }'
  [OneMediaNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
 }
}
