param([string]$Source)
. $Source -LibraryOnly
function Assert($condition,$message){if(!$condition){throw $message}}
$branch='Software\One\ArchiveAssociationTests\'+[guid]::NewGuid().ToString()
$root=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($branch)
$executable='D:\Program Files\One 测试\One.exe'
$updated='D:\Program Files\One 新目录\One.exe'
$icons=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/icons/archive'))
try {
 Add-Type -AssemblyName System.Drawing
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OneArchiveIconTest { [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr instance,string name,uint type,int cx,int cy,uint flags); [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon); }'
 foreach($format in @(Get-ChildItem -LiteralPath $icons -Filter '*.ico' | ForEach-Object{$_.BaseName})){
  foreach($size in @(16,20,24,32,40,48,64,96,128,256)){
   $handle=[OneArchiveIconTest]::LoadImage([IntPtr]::Zero,[IO.Path]::Combine($icons,$format+'.ico'),1,$size,$size,0x10)
   Assert ($handle -ne [IntPtr]::Zero) ('Windows LoadImage '+$format+' '+$size)
   $image=[Drawing.Icon]::FromHandle($handle)
   try{Assert ($image.Width -eq $size -and $image.Height -eq $size) ('Windows icon frame '+$format+' '+$size);$bitmap=$image.ToBitmap();try{Assert ($bitmap.GetPixel(0,0).A -eq 0) 'Transparent icon exterior'}finally{$bitmap.Dispose()}}finally{$image.Dispose();[void][OneArchiveIconTest]::DestroyIcon($handle)}
  }
 }
 Set-OneArchiveValue $root 'Classes\.zip' '' 'Other.Zip'
 Set-OneArchiveValue $root 'Classes\.zip\OpenWithProgids' 'Other.Zip' ''
 Set-OneArchiveValue $root 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice' 'ProgId' 'Other.Zip'
 Assert (!(Get-OneArchiveRegistration $root $executable $icons)) 'Initially unregistered'
 # Old installations use one shared ProgID. Registration upgrades candidates,
 # preserving both Windows UserChoice and the legacy ProgID's launch command.
 Set-OneArchiveValue $root 'Classes\One.Archive' 'OneExecutable' $executable
 Set-OneArchiveValue $root 'Classes\.zip\OpenWithProgids' 'One.Archive' ''
 $failed=$false
 try{Install-OneArchiveRegistration $root $executable $executable (Join-Path $icons 'missing')}catch{$failed=$true}
 Assert $failed 'Missing resources reject registration before mutation'
 $key=$root.OpenSubKey('RegisteredApplications')
 try{Assert (!$key) 'Missing resources do not partially register application'}finally{if($key){$key.Dispose()}}
 Install-OneArchiveRegistration $root $executable $executable $icons
 Assert (Get-OneArchiveRegistration $root $executable $icons) 'Registration must be complete'
 $key=$root.OpenSubKey('RegisteredApplications')
 try{Assert ($key.GetValue('One 压缩与解压') -eq 'Software\One\Archive\Capabilities') 'RegisteredApplications name matches capabilities'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Classes\One.Archive\shell\open\command')
 try{Assert ($key.GetValue('') -eq ('"'+$executable+'" "--one-archive=%1"')) 'Quoted launch command'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Classes\.zip')
 try{Assert ($key.GetValue('') -eq 'Other.Zip') 'Existing default must be preserved'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice')
 try{Assert ($key.GetValue('ProgId') -eq 'Other.Zip') 'UserChoice must be preserved'}finally{$key.Dispose()}
 foreach($extension in $archiveExtensions){
  $format=$extension.Substring(1)
  $progId='One.Archive.'+$format.ToUpperInvariant()
  $key=$root.OpenSubKey('Classes\'+$progId+'\DefaultIcon')
  try{Assert ($key.GetValue('') -eq ('"'+[IO.Path]::Combine($icons,$format+'.ico')+'",0')) ('Dedicated icon '+$extension)}finally{$key.Dispose()}
  $key=$root.OpenSubKey('One\Archive\Capabilities\FileAssociations')
  try{Assert ($key.GetValue($extension) -eq $progId) ('Dedicated candidate '+$extension)}finally{$key.Dispose()}
  $key=$root.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{Assert ($key.GetValueNames() -contains $progId) ('Open With candidate '+$extension);Assert ($key.GetValueNames() -notcontains 'One.Archive') 'Legacy candidate migrated'}finally{$key.Dispose()}
 }
 $key=$root.OpenSubKey('Classes\.001')
 try{Assert (!$key) 'Do not claim arbitrary numbered files'}finally{if($key){$key.Dispose()}}
 Set-OneArchiveValue $root 'Classes\One.Archive.ZIP\DefaultIcon' '' 'wrong.ico'
 Assert (Get-OneArchiveLegacyRegistration $root $executable) 'Old registration remains recognizable for update'
 Assert (!(Get-OneArchiveRegistration $root $executable $icons)) 'Stale icon registration detected'
 Set-OneArchiveValue $root 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice' 'ProgId' 'One.Archive'
 Install-OneArchiveRegistration $root $executable $executable $icons
 $key=$root.OpenSubKey('Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice')
 try{Assert ($key.GetValue('ProgId') -eq 'One.Archive') 'Existing legacy UserChoice must not be overwritten'}finally{$key.Dispose()}
 Remove-OneArchiveRegistration $root $updated
 Assert (Get-OneArchiveRegistration $root $executable $icons) 'Different installation must not remove registration'
 Install-OneArchiveRegistration $root $updated $updated $icons
 Remove-OneArchiveRegistration $root $executable
 Assert (Get-OneArchiveRegistration $root $updated $icons) 'Old uninstaller must not remove newer owner'
 Remove-OneArchiveRegistration $root $updated
 Assert (!(Get-OneArchiveRegistration $root $updated $icons)) 'Uninstall removes own registration'
 Assert (!(Get-OneArchiveLegacyRegistration $root $updated)) 'Uninstall removes legacy registration'
 $key=$root.OpenSubKey('Classes\.zip\OpenWithProgids')
 try{Assert ($key.GetValueNames() -contains 'Other.Zip') 'Other candidates preserved';Assert ($key.GetValueNames() -notcontains 'One.Archive') 'Own candidate removed'}finally{$key.Dispose()}
 foreach($extension in $archiveExtensions){
  $key=$root.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{Assert ($key.GetValueNames() -notcontains 'One.Archive') ('Removed candidate '+$extension)}finally{$key.Dispose()}
  $progId='One.Archive.'+$extension.Substring(1).ToUpperInvariant()
  $key=$root.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{Assert ($key.GetValueNames() -notcontains $progId) ('Removed format candidate '+$extension)}finally{$key.Dispose()}
  $key=$root.OpenSubKey('Classes\'+$progId)
  try{Assert (!$key) ('Removed format ProgID '+$extension)}finally{if($key){$key.Dispose()}}
 }
 'Archive association registry tests passed in isolated branch.'
}finally {
 $root.Dispose()
 [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($branch,$false)
}
