param([string]$InstanceBase64, [int]$Delta = 0, [int]$ReadOnly = 1)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $targetInstance = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($InstanceBase64))
  $panels = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Where-Object { $_.Active -and ($_.InstanceName -replace '_\d+$','') -ieq $targetInstance })
  if ($panels.Count -ne 1) { throw '此屏幕不支持亮度调节；外接显示器可检查是否开启 DDC/CI' }
  $panel = $panels[0]
  $next = [Math]::Max(0, [Math]::Min(100, [int]$panel.CurrentBrightness + $Delta))
  if ($ReadOnly -eq 0 -and $next -ne $panel.CurrentBrightness) {
    $methods = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Where-Object { $_.InstanceName -eq $panel.InstanceName })
    if ($methods.Count -ne 1) { throw '未找到此屏幕的亮度控制接口' }
    $result = Invoke-CimMethod -InputObject $methods[0] -MethodName WmiSetBrightness -Arguments @{Timeout=[uint32]0; Brightness=[byte]$next}
    if ($result.ReturnValue -ne 0) { throw '屏幕未接受亮度设置' }
    $verified = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Where-Object { $_.InstanceName -eq $panel.InstanceName })
    if ($verified.Count -eq 1) { $next = [int]$verified[0].CurrentBrightness }
  }
  @{brightness=$next} | ConvertTo-Json -Compress
} catch { @{error='此屏幕的亮度接口不可用。请检查显示器的 DDC/CI 设置或驱动。'} | ConvertTo-Json -Compress }
