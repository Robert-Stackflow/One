param([string]$Source)
$ErrorActionPreference='Stop'
. ([scriptblock]::Create([IO.File]::ReadAllText($Source,[Text.Encoding]::UTF8))) -LibraryOnly
$script:checks=0
function Assert($condition,$message){if(!$condition){throw $message};$script:checks++}
function Value([string]$Path,[string]$Name=''){
 $key=$root.OpenSubKey($Path)
 try{if($key){return $key.GetValue($Name)}}finally{if($key){$key.Dispose()}}
}
$branch='Software\One\MediaAssociationTests\'+[guid]::NewGuid().ToString()
$root=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($branch)
$executable='D:\Program Files\One 测试\One.exe'
$updated='D:\新位置 with spaces\One.exe'
try{
 Assert (!(Get-OneMediaRegistration $root $executable $executable)) 'Initially unregistered'
 foreach($invalid in @('relative.exe',"D:\invalid`"name.exe","D:\invalid`nname.exe")){
  $failed=$false;try{Install-OneMediaRegistration $root $invalid $executable}catch{$failed=$true}
  Assert $failed 'Reject invalid executable before registration'
  Assert ($root.GetSubKeyNames().Count -eq 0) 'Invalid paths cause no registry writes'
 }
 Set-OneMediaValue $root 'Classes\.onerec' '' 'Other.Recording'
 Set-OneMediaValue $root 'Classes\.onerec\OpenWithProgids' 'Other.Recording' ''
 Set-OneMediaValue $root 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.onerec\UserChoice' 'ProgId' 'Other.Recording'
 Install-OneMediaRegistration $root $executable $executable
 Assert (Get-OneMediaRegistration $root $executable $executable) 'Complete registration'
 Assert ((Value 'Classes\.oneimage') -eq 'One.ImageProject') 'A new extension opens One by default'
 Assert ((Value 'Classes\.onerec') -eq 'Other.Recording') 'Preserve existing extension default'
 Assert ((Value 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.onerec\UserChoice' 'ProgId') -eq 'Other.Recording') 'Preserve Windows user choice'
 Assert ((Value 'Classes\One.ImageProject\shell\open\command') -eq ('"'+$executable+'" "--one-project=%1"')) 'Quoted executable and One project argument'
 Assert ((Value 'Classes\One.RecordingProject\DefaultIcon') -eq ('"'+$executable+'",0')) 'One executable supplies the icon'
 $classes=$root.OpenSubKey('Classes');try{Assert (($classes.GetSubKeyNames()|Sort-Object)-join ',' -eq '.oneimage,.onerec,One.ImageProject,One.RecordingProject') 'Only two One formats, no old URI or product keys'}finally{$classes.Dispose()}
 Install-OneMediaRegistration $root $executable $executable
 Assert (Get-OneMediaRegistration $root $executable $executable) 'Repeated registration is idempotent'
 Set-OneMediaValue $root 'Classes\One.RecordingProject\shell\open\command' '' 'broken'
 Assert (!(Get-OneMediaRegistration $root $executable $executable)) 'Detect incomplete registration'
 Install-OneMediaRegistration $root $executable $executable
 Assert (Get-OneMediaRegistration $root $executable $executable) 'Repair incomplete registration'
 # Upgrade/move ownership, then try the old uninstaller.
 Install-OneMediaRegistration $root $updated $updated
 Remove-OneMediaRegistration $root $executable
 Assert (Get-OneMediaRegistration $root $updated $updated) 'Old installation cannot remove a new owner'
 Assert (!(Get-OneMediaRegistration $root $executable $executable)) 'Old path no longer owns the registration'
 # Exercise rollback of the new owner and restoration of the previous one.
 Remove-OneMediaRegistration $root $updated
 Install-OneMediaRegistration $root $executable $executable
 Assert (Get-OneMediaRegistration $root $executable $executable) 'Failed upgrade can restore old executable and icon'
 # Partial ownership: do not remove another installation/application capabilities.
 Set-OneMediaValue $root 'Classes\One.RecordingProject' 'OneExecutable' $updated
 Set-OneMediaValue $root $mediaCapabilities 'OneExecutable' $updated
 Remove-OneMediaRegistration $root $executable
 Assert ($null -eq (Value 'Classes\One.ImageProject' 'OneExecutable')) 'Remove owned image ProgID'
 Assert ((Value 'Classes\One.RecordingProject' 'OneExecutable') -eq $updated) 'Keep a different format owner'
 Assert ((Value 'RegisteredApplications' $mediaAppName) -eq ('Software\'+$mediaCapabilities)) 'Keep a different capabilities owner'
 Assert ($null -eq (Value 'Classes\.oneimage')) 'Remove own extension default'
 Assert ((Value 'Classes\.onerec') -eq 'Other.Recording') 'Keep another extension default during uninstall'
 Assert ((Value 'Classes\.onerec\OpenWithProgids' 'Other.Recording') -eq '') 'Keep another open-with candidate'
 Remove-OneMediaRegistration $root $updated
 Remove-OneMediaRegistration $root $updated
 Assert ($null -eq (Value 'RegisteredApplications' $mediaAppName)) 'Remove owned application registration; repeat removal is safe'
 Assert ((Value 'Microsoft\Windows\CurrentVersion\Explorer\FileExts\.onerec\UserChoice' 'ProgId') -eq 'Other.Recording') 'Uninstall never writes UserChoice'
 Set-OneMediaValue $root 'Classes\One.RecordingProject' '' 'Unmarked registration'
 Remove-OneMediaRegistration $root ''
 Assert ((Value 'Classes\One.RecordingProject') -eq 'Unmarked registration') 'An omitted executable cannot claim an unmarked key'
 Remove-OneMediaRegistration $root $executable
 Assert ((Value 'Classes\One.RecordingProject') -eq 'Unmarked registration') 'Never remove an unmarked registration'
 @{result='PASS';checks=$script:checks;isolatedRegistry=$true;productRegistryUnchanged=$true}|ConvertTo-Json -Compress
}finally{$root.Dispose();[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($branch,$false)}
