export interface DiskRule { drive:string;enabled:boolean;unit:'percent'|'gb';threshold:number }
export interface DiskMonitorSettings { enabled:boolean;notify:boolean;intervalSeconds:number;rules:DiskRule[] }
export interface VolumeStatus { drive:string;label:string;filesystem:string;total:number;free:number;type:number;error?:number }
export type WriteKind = 'file'|'network'|'device'|'unknown';
export interface WriteMetrics {bytesPerSecond:number;totalBytes:number;activeSeconds:number}
export interface ProcessWriting {breakdown?:Partial<Record<WriteKind,WriteMetrics>>; pid:number;started:string;name:string;path:string;bytesPerSecond:number;operationsPerSecond:number;activeSeconds:number;totalBytes:number;files:{path:string;bytes:number}[] }
export interface DiskMonitorState { created:number;volumes:VolumeStatus[];writers:ProcessWriting[];writersReady?:boolean;trace:'off'|'active'|'permission'|'error';traceError?:string;error?:string;alerts:string[];cpuPercent:number;memoryTotal:number;memoryFree:number;uptimeSeconds:number }
export const defaultDiskMonitor = ():DiskMonitorSettings=>({enabled:false,notify:true,intervalSeconds:2,rules:[]});
export function validateDiskMonitor(value:unknown):DiskMonitorSettings {
 if(value===undefined)return defaultDiskMonitor();const v=value as DiskMonitorSettings;
 if(!v||typeof v.enabled!=='boolean'||typeof v.notify!=='boolean'||!Number.isInteger(v.intervalSeconds)||v.intervalSeconds<1||v.intervalSeconds>60||!Array.isArray(v.rules)||v.rules.length>26)throw new Error('磁盘告警设置无效');
 const drives=new Set<string>();const rules=v.rules.map(r=>{if(!r||typeof r.drive!=='string'||! /^[A-Z]:\\$/i.test(r.drive)||drives.has(r.drive.toUpperCase())||typeof r.enabled!=='boolean'||!['percent','gb'].includes(r.unit)||!Number.isFinite(r.threshold)||r.threshold<=0||r.threshold>(r.unit==='percent'?99:100000))throw new Error('磁盘告警阈值无效');drives.add(r.drive.toUpperCase());return {...r,drive:r.drive.toUpperCase()};});
 return {...v,rules};
}
/** One alert per low-space episode. A recovery margin prevents threshold jitter. */
export class DiskAlertPolicy {
 private low=new Set<string>();private signatures=new Map<string,string>();
 evaluate(volumes:VolumeStatus[],settings:DiskMonitorSettings){const entered:string[]=[],active:string[]=[];
  const present=new Set(volumes.map(v=>v.drive));for(const drive of this.low)if(!present.has(drive))this.low.delete(drive);
  for(const v of volumes){const rule=settings.rules.find(r=>r.drive===v.drive);const signature=JSON.stringify(rule);if(this.signatures.get(v.drive)!==signature){this.low.delete(v.drive);this.signatures.set(v.drive,signature);}
   if(!settings.enabled||!rule?.enabled||v.error||!v.total){this.low.delete(v.drive);continue;}
   const remaining=rule.unit==='percent'?v.free/v.total*100:v.free/1024**3;
   if(remaining<=rule.threshold){if(!this.low.has(v.drive)){this.low.add(v.drive);entered.push(v.drive);}active.push(v.drive);}
   else if(this.low.has(v.drive)&&remaining>rule.threshold+Math.max(rule.unit==='percent'?1:.25,rule.threshold*.05))this.low.delete(v.drive);
   else if(this.low.has(v.drive))active.push(v.drive);
  }return {entered,active};
 }
}
