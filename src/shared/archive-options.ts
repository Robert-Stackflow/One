export interface ArchiveResources {threads:number;memoryMiB:number}
export const defaultArchiveResources=():ArchiveResources=>({threads:2,memoryMiB:1024});
export function archiveResources(value:Partial<ArchiveResources>={},defaults=defaultArchiveResources()):ArchiveResources {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('归档资源参数无效');
 const threads=value.threads===undefined?defaults.threads:value.threads,memoryMiB=value.memoryMiB===undefined?defaults.memoryMiB:value.memoryMiB;
 if(!Number.isInteger(threads)||threads<1||threads>64)throw Error('压缩线程数须为 1–64');
 if(!Number.isInteger(memoryMiB)||memoryMiB<128||memoryMiB>8192)throw Error('归档进程内存上限须为 128–8192 MB');
 return {threads,memoryMiB};
}
export function archiveLevel(value:unknown=6):number {
 if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>9)throw Error('压缩等级须为 0–9');
 return value;
}
