$ErrorActionPreference='Continue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$names=@('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy')
$environment=@()
foreach($scope in @('Process','User','Machine')){
 $values=[Environment]::GetEnvironmentVariables($scope)
 foreach($name in $names){if($values.Contains($name)){$environment+=@{scope=$scope;name=$name;value=[string]$values[$name]}}}
}
$settings=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$connection=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections' -ErrorAction SilentlyContinue
$autoDetect=if($settings.PSObject.Properties['AutoDetect']){[bool]$settings.AutoDetect}elseif($connection.DefaultConnectionSettings.Length -gt 8){([int]$connection.DefaultConnectionSettings[8] -band 8) -ne 0}else{$false}
$winHttp=(& netsh winhttp show proxy 2>$null | Out-String).Trim()
$pattern='(?i)clash|mihomo|v2ray|sing.box|singbox|nekoray|shadowsocks|hiddify|proxifier|wireguard|openvpn|tailscale|zerotier|outline|lantern|psiphon|surge|quantumult|trojan|proxycap|warp|privoxy'
$processes=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {$_.Name -match $pattern} | Select-Object -First 80 | ForEach-Object {@{name=[string]$_.Name;pid=[int]$_.ProcessId;path=[string]$_.ExecutablePath}})
$adapters=@()
$network=@(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue)
foreach($adapter in $network){
 $description=[string]$adapter.InterfaceDescription
 $virtual=[bool]$adapter.Virtual -or -not [bool]$adapter.HardwareInterface -or "$($adapter.Name) $description" -match '(?i)virtual|vEthernet|hyper-v|wintun|tap-|tun|vpn|wireguard|tailscale|zerotier|clash|loopback|vmware|virtualbox|npcap|wan miniport'
 if(-not $virtual -or ($adapter.Name -match '^WAN Miniport' -and $adapter.Status -ne 'Up')){continue}
 $index=[int]$adapter.ifIndex
 $addresses=@(Get-NetIPAddress -InterfaceIndex $index -ErrorAction SilentlyContinue | Where-Object {$_.AddressState -eq 'Preferred'} | ForEach-Object {"$($_.IPAddress)/$($_.PrefixLength)"})
 $gateways=@(Get-NetRoute -InterfaceIndex $index -ErrorAction SilentlyContinue | Where-Object {$_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -eq '::/0'} | ForEach-Object {[string]$_.NextHop})
 $dns=@(Get-DnsClientServerAddress -InterfaceIndex $index -ErrorAction SilentlyContinue | ForEach-Object {$_.ServerAddresses} | Where-Object {$_})
 $adapters+=@{name=[string]$adapter.Name;description=$description;status=[string]$adapter.Status;mac=[string]$adapter.MacAddress;index=$index;addresses=$addresses;gateways=$gateways;dns=$dns;virtual=$true}
}
@{environment=$environment;windows=@{enabled=[bool]$settings.ProxyEnable;server=[string]$settings.ProxyServer;pac=[string]$settings.AutoConfigURL;autoDetect=$autoDetect;bypass=[string]$settings.ProxyOverride;winHttp=$winHttp};processes=$processes;adapters=$adapters} | ConvertTo-Json -Compress -Depth 8
