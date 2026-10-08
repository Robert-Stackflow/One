param([string]$Source)
. $Source -LibraryOnly
function Assert($condition,$message){if(!$condition){throw $message}}
$branch='Software\One\ArchiveAssociationTests\'+[guid]::NewGuid().ToString()
$root=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($branch)
$executable='D:\Program Files\One 测试\One.exe'
$updated='D:\Program Files\One 新目录\One.exe'
try {
 Set-OneArchiveValue $root 'Classes\.zip' '' 'Other.Zip'
 Set-OneArchiveValue $root 'Classes\.zip\OpenWithProgids' 'Other.Zip' ''
 Set-OneArchiveValue $root 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice' 'ProgId' 'Other.Zip'
 Assert (!(Get-OneArchiveRegistration $root $executable)) 'Initially unregistered'
 Install-OneArchiveRegistration $root $executable $executable
 Assert (Get-OneArchiveRegistration $root $executable) 'Registration must be complete'
 $key=$root.OpenSubKey('RegisteredApplications')
 try{Assert ($key.GetValue('One 压缩与解压') -eq 'Software\One\Archive\Capabilities') 'RegisteredApplications name matches capabilities'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Classes\One.Archive\shell\open\command')
 try{Assert ($key.GetValue('') -eq ('"'+$executable+'" "--one-archive=%1"')) 'Quoted launch command'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Classes\.zip')
 try{Assert ($key.GetValue('') -eq 'Other.Zip') 'Existing default must be preserved'}finally{$key.Dispose()}
 $key=$root.OpenSubKey('Microsoft\Windows\CurrentVersion\Explorer\FileExts\.zip\UserChoice')
 try{Assert ($key.GetValue('ProgId') -eq 'Other.Zip') 'UserChoice must be preserved'}finally{$key.Dispose()}
 Remove-OneArchiveRegistration $root $updated
 Assert (Get-OneArchiveRegistration $root $executable) 'Different installation must not remove registration'
 Install-OneArchiveRegistration $root $updated $updated
 Remove-OneArchiveRegistration $root $executable
 Assert (Get-OneArchiveRegistration $root $updated) 'Old uninstaller must not remove newer owner'
 Remove-OneArchiveRegistration $root $updated
 Assert (!(Get-OneArchiveRegistration $root $updated)) 'Uninstall removes own registration'
 $key=$root.OpenSubKey('Classes\.zip\OpenWithProgids')
 try{Assert ($key.GetValueNames() -contains 'Other.Zip') 'Other candidates preserved';Assert ($key.GetValueNames() -notcontains 'One.Archive') 'Own candidate removed'}finally{$key.Dispose()}
 foreach($extension in $archiveExtensions){
  $key=$root.OpenSubKey('Classes\'+$extension+'\OpenWithProgids')
  try{Assert ($key.GetValueNames() -notcontains 'One.Archive') ('Removed candidate '+$extension)}finally{$key.Dispose()}
 }
 'Archive association registry tests passed in isolated branch.'
}finally {
 $root.Dispose()
 [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($branch,$false)
}
