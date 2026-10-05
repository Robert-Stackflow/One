import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {PortSnapshot} from '../shared/ports';

const execute=promisify(execFile);
const powershell=process.env.SystemRoot?process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\powershell.exe':'powershell.exe';
const script=`$ErrorActionPreference='SilentlyContinue'
$names=@{}; Get-Process | ForEach-Object {$names[$_.Id]=$_.ProcessName}
$ports=@(Get-NetTCPConnection | ForEach-Object {[pscustomobject]@{protocol='TCP';localAddress=$_.LocalAddress;localPort=[int]$_.LocalPort;remoteAddress=$_.RemoteAddress;remotePort=[int]$_.RemotePort;state=$_.State.ToString();pid=[int]$_.OwningProcess;process=$names[$_.OwningProcess]}})
$ports+=@(Get-NetUDPEndpoint | ForEach-Object {[pscustomobject]@{protocol='UDP';localAddress=$_.LocalAddress;localPort=[int]$_.LocalPort;remoteAddress='';remotePort=0;state='Listening';pid=[int]$_.OwningProcess;process=$names[$_.OwningProcess]}})
$services=@(Get-CimInstance Win32_Service | ForEach-Object {[pscustomobject]@{name=$_.Name;displayName=$_.DisplayName;state=$_.State;startMode=$_.StartMode;pid=[int]$_.ProcessId;path=$_.PathName}})
[pscustomobject]@{ports=$ports;services=$services}|ConvertTo-Json -Depth 4 -Compress`;

export class PortService {
 private cached?:PortSnapshot; private pending?:Promise<PortSnapshot>;
 async snapshot(refresh=false){
  if(!refresh&&this.cached&&Date.now()-this.cached.captured<10_000)return this.cached;
  if(this.pending)return this.pending;
  this.pending=execute(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:20_000,maxBuffer:16*1024*1024,encoding:'utf8'})
   .then(({stdout})=>{const value=JSON.parse(stdout||'{}');const list=<T>(items:unknown):T[]=>Array.isArray(items)?items:items?[items as T]:[];return this.cached={captured:Date.now(),ports:list(value.ports),services:list(value.services)};})
   .finally(()=>this.pending=undefined);
  return this.pending;
 }
}
