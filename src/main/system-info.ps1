$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
foreach($source in $request.sources){
 $group=@{id=$source.id;title=$source.title;rows=@()}
 try {
  $parameters=@{ClassName=$source.class;Namespace='root/cimv2';OperationTimeoutSec=15;ErrorAction='Stop'}
  if($source.namespace){$parameters.Namespace=$source.namespace};if($source.filter){$parameters.Filter=$source.filter}
  $properties=@($source.fields.Split(';') | ForEach-Object {($_ -split '\|')[0]})
  # Query the class without a projection: optional properties vary by Windows and driver.
  $limit=1000;if($source.limit){$limit=[int]$source.limit}
  if($source.id -eq 'reliability'){$rows=@(Get-PhysicalDisk -ErrorAction Stop | Get-StorageReliabilityCounter -ErrorAction Stop | Select-Object -First $limit)}else{$rows=@(Get-CimInstance @parameters | Select-Object -First $limit)}
  foreach($row in $rows){$values=@{};foreach($field in $properties){$value=$row.$field;if($value -is [DateTime]){$value=$value.ToString('o')};$values[$field]=$value};$group.rows+=,$values}
 }catch{$group.error=$_.Exception.Message}
 $group | ConvertTo-Json -Compress -Depth 8 | ForEach-Object {[Console]::Out.WriteLine($_)}
}
