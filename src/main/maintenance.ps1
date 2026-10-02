param([ValidateSet('tasks','selection')][string]$Mode)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskRows = [System.Collections.Generic.List[object]]::new()
function Add-Row($Name,$Source,$Status,$Command,$Location) {
  $taskRows.Add([pscustomobject]@{name=[string]$Name;source=[string]$Source;status=[string]$Status;command=[string]$Command;location=[string]$Location})
}
if ($Mode -eq 'selection') {
  $taskShell = New-Object -ComObject Shell.Application
  $taskSelected = @()
  try { foreach ($taskWindow in $taskShell.Windows()) { try { $taskItems=$taskWindow.Document.SelectedItems(); if ($taskItems.Count -eq 1) { $taskSelected += [pscustomobject]@{hwnd=[long]$taskWindow.HWND;path=[string]$taskItems.Item(0).Path} } } catch {} } }
  finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskShell) }
  ConvertTo-Json -InputObject @($taskSelected) -Compress; exit
}
  try {
    foreach ($taskItem in Get-ScheduledTask) {
      if ($taskItem.Triggers | Where-Object { $_.CimClass.CimClassName -match 'BootTrigger|LogonTrigger' }) {
        $taskCommand=($taskItem.Actions | ForEach-Object { ([string]$_.Execute+' '+[string]$_.Arguments).Trim() }) -join '; '
        Add-Row $taskItem.TaskName '任务计划' ([string]$taskItem.State+'（开机/登录）') $taskCommand ($taskItem.TaskPath+$taskItem.TaskName)
      }
    }
  } catch { Add-Row '任务计划' '任务计划' $_.Exception.Message '' '' }
ConvertTo-Json -InputObject @($taskRows.ToArray()) -Depth 5 -Compress
