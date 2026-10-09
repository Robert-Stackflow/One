export type ArchiveScan={state:'disabled'|'empty'|'passed'|'incomplete'|'blocked';files:number;emptyFiles?:number;provider?:string;reason?:string};
export const validArchiveScan=(value:unknown):value is ArchiveScan=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const item=value as ArchiveScan;
 const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
 return ['disabled','empty','passed','incomplete','blocked'].includes(item.state)&&count(item.files)&&(count(item.emptyFiles)||item.state==='incomplete'&&item.emptyFiles===undefined)&&item.files+(item.emptyFiles??0)<=1000000&&(item.provider===undefined||typeof item.provider==='string'&&item.provider.length<=256)&&(item.reason===undefined||typeof item.reason==='string'&&item.reason.length<=512)&&(item.state!=='passed'||item.files>0&&!!item.provider)&&(!['disabled','empty'].includes(item.state)||item.files===0)&&(item.state!=='disabled'||item.emptyFiles===0);
};
export const copyArchiveScan=(scan:ArchiveScan):ArchiveScan=>({state:scan.state,files:scan.files,...(scan.emptyFiles===undefined?{}:{emptyFiles:scan.emptyFiles}),...(scan.provider?{provider:scan.provider}:{}),...(scan.reason?{reason:scan.reason}:{})});
export const archiveScanText=(scan?:ArchiveScan)=>!scan?'':({disabled:'未开启恶意软件扫描',empty:'没有非空文件需要扫描',passed:`扫描未检出威胁 · ${scan.files} 个文件`,incomplete:'未完成恶意软件扫描',blocked:'扫描阻止了本次解压'}[scan.state]);
