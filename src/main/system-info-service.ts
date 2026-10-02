import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {informationSources,type InformationSource} from './system-info-schema';
import {validInformationKind,type InformationKind,type InformationGroup,type InformationReport,type InformationProgress} from '../shared/system-info';
const powershell=join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const units:Record<string,string>={mhz:'MHz',mts:'MT/s',bits:'位',px:'px',hz:'Hz',cm:'cm',rpm:'rpm',percent:'%',hours:'小时',minutes:'分钟',ms:'ms',mwh:'mWh',mw:'mW'};
const enums:Record<string,Record<number,string>>={architecture:{0:'x86',1:'MIPS',2:'Alpha',3:'PowerPC',5:'ARM',6:'Itanium',9:'x64',12:'ARM64'},memory:{0:'未报告',20:'DDR',21:'DDR2',24:'DDR3',26:'DDR4',27:'LPDDR',28:'LPDDR2',29:'LPDDR3',30:'LPDDR4',34:'DDR5',35:'LPDDR5'},form:{8:'DIMM',12:'SO-DIMM'},ecc:{0:'未报告',3:'无纠错',4:'奇偶校验',5:'单位 ECC',6:'多位 ECC'},bus:{1:'SCSI',2:'ATAPI',3:'ATA',4:'IEEE 1394',7:'USB',8:'RAID',10:'SAS',11:'SATA',14:'虚拟磁盘',17:'NVMe',18:'SCM',19:'UFS'},media:{0:'未报告',3:'HDD',4:'SSD',5:'SCM'},health:{0:'健康',1:'警告',2:'异常',5:'未知'},'device-error':{0:'正常',10:'设备无法启动',22:'已禁用',28:'未安装驱动',31:'驱动无法加载',43:'设备报告问题',45:'未连接'}};
export function formatInformationValue(value:unknown,unit=''):string {
 if(value===null||value===undefined||value==='')return '未报告';if(unit==='edid'&&Array.isArray(value))return value.filter(v=>Number(v)>0).map(v=>String.fromCharCode(Number(v))).join('')||'未报告';
 if(Array.isArray(value))return value.map(v=>formatInformationValue(v,unit)).join(' · ')||'未报告';if(typeof value==='boolean')return value?'是':'否';
 if(unit==='date'){const date=new Date(String(value));return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN');}
 if(enums[unit])return enums[unit][Number(value)]??`${value}（编码）`;
 if(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(String(value))){const n=Number(value);if(['bytes','kb','mb'].includes(unit)){const b=n*(unit==='kb'?1024:unit==='mb'?1024**2:1);const p=b?Math.min(4,Math.floor(Math.log(b)/Math.log(1024))):0;return `${(b/1024**p).toLocaleString('zh-CN',{maximumFractionDigits:p>1?2:0})} ${['B','KB','MB','GB','TB'][p]}`;}
  if(unit==='bps')return n>=1e9?`${(n/1e9).toFixed(2)} Gbps`:`${(n/1e6).toFixed(0)} Mbps`;if(unit==='mv')return `${(n/1000).toFixed(2)} V`;if(unit==='celsius')return `${n} °C`;if(units[unit])return `${n.toLocaleString()} ${units[unit]}`;}
 return String(value).trim();
}
export class SystemInformationService {
 private controller=new AbortController();
 private cache=new Map<InformationKind,InformationReport>();private pending=new Map<InformationKind,Promise<InformationReport>>();private children=new Set<ReturnType<typeof spawn>>();private active=0;private queue:(()=>void)[]=[];private stopped=false;
 constructor(private progress:(value:InformationProgress)=>void,private groupReady:(value:{kind:InformationKind;group:InformationGroup})=>void){}
 async read(kind:InformationKind,refresh=false):Promise<InformationReport>{if(!validInformationKind(kind))throw new Error('系统信息类别无效');if(this.stopped)throw new Error('系统信息服务已关闭');if(this.pending.has(kind))return this.pending.get(kind)!;const cached=this.cache.get(kind);if(!refresh&&cached&&Date.now()-cached.created<300000)return cached;
  const work=this.load(kind);this.pending.set(kind,work);try{const report=await work;this.cache.set(kind,report);return report;}finally{this.pending.delete(kind);}
 }
 private async load(kind:InformationKind):Promise<InformationReport>{if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));if(this.stopped)throw new Error('系统信息服务已关闭');this.active++;const start=performance.now(),sources=informationSources(kind),groups:InformationGroup[]=[];this.progress({kind,group:'',completed:0,total:sources.length});
  try{
   if(['overview','display','board','os','network','bluetooth','battery'].includes(kind)){try{const result=await promisify(execFile)(join(__dirname,'../native/One.Monitor.exe').replace('app.asar\\','app.asar.unpacked\\'),['hardware',kind],{windowsHide:true,signal:this.controller.signal,timeout:20000,maxBuffer:2*1024*1024});for(const group of JSON.parse(result.stdout) as InformationGroup[]){groups.push(group);this.groupReady({kind,group});}}catch{const group:InformationGroup={id:'native',title:'原生设备接口',records:[],error:'设备接口暂不可用'};groups.push(group);this.groupReady({kind,group});}}
   return await new Promise((resolve,reject)=>{const child=spawn(powershell,['-NoProfile','-NonInteractive','-File',join(__dirname,'system-info.ps1').replace('app.asar\\','app.asar.unpacked\\')],{windowsHide:true,stdio:'pipe'});this.children.add(child);let buffer='',error='',settled=false;const finish=(err?:Error)=>{if(settled)return;settled=true;clearTimeout(timeout);this.children.delete(child);if(err)reject(err);else if(groups.length===0)reject(new Error('系统信息未返回任何数据'));else resolve({kind,created:Date.now(),elapsed:Math.round(performance.now()-start),groups});};const timeout=setTimeout(()=>{child.kill();finish(new Error('系统信息查询超时；已读取的信息仍可查看'));},90000);
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>16*1024*1024){child.kill();finish(new Error('系统信息响应超过限制'));return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const raw=JSON.parse(line),source=sources.find(s=>s.id===raw.id);if(!source)continue;const group=this.convert(raw,source);groups.push(group);this.groupReady({kind,group});this.progress({kind,group:source.title,completed:groups.filter(g=>sources.some(s=>s.id===g.id)).length,total:sources.length});}catch(e){child.kill();finish(new Error('系统信息返回了无效数据'));return;}}});child.stderr.on('data',chunk=>error=(error+chunk).slice(-4000));child.on('error',finish);child.on('exit',code=>finish(code?new Error(error||'系统信息查询失败'):undefined));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({sources}));});
  }finally{this.active--;this.queue.shift()?.();}
 }
 private convert(raw:any,source:InformationSource):InformationGroup{const specs=source.fields.split(';').map(f=>f.split('|'));return {id:source.id,title:source.title,error:raw.error?String(raw.error):undefined,records:(Array.isArray(raw.rows)?raw.rows:[]).map((row:any,index:number)=>({title:formatInformationValue(row[source.name||'Name'],source.name==='UserFriendlyName'?'edid':'')==='未报告'?`${source.title} ${index+1}`:formatInformationValue(row[source.name||'Name'],source.name==='UserFriendlyName'?'edid':''),fields:specs.map(([key,label,unit])=>({key,label,value:formatInformationValue(row[key],unit)}))}))};}
 stop(){this.stopped=true;this.controller.abort();for(const child of this.children)child.kill();for(const resume of this.queue)resume();this.queue=[];}
}
