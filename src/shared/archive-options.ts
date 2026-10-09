import type {ArchivePasswordEncoding} from './archive';
export function archivePasswordEncoding(value:unknown=65001):ArchivePasswordEncoding {
 if(typeof value!=='number'||![0,437,932,936,950,65001].includes(value))throw Error('ZIP 密码编码无效');
 return value as ArchivePasswordEncoding;
}
export interface ArchiveResources {threads:number;memoryMiB:number}
export const defaultArchiveResources=():ArchiveResources=>({threads:2,memoryMiB:1024});
export interface ArchiveBudget {maxConcurrent:number;totalMemoryMiB:number;totalThreads:number}
export function archiveBudget(value:Partial<ArchiveBudget>={},resources=defaultArchiveResources()):ArchiveBudget {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('归档队列设置无效');
 const maxConcurrent=value.maxConcurrent===undefined?2:value.maxConcurrent;
 const totalMemoryMiB=value.totalMemoryMiB===undefined?Math.max(2048,resources.memoryMiB):value.totalMemoryMiB;
 const totalThreads=value.totalThreads===undefined?Math.max(4,resources.threads):value.totalThreads;
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8)throw Error('同时运行的归档任务数须为 1–8');
 if(!Number.isInteger(totalMemoryMiB)||totalMemoryMiB<128||totalMemoryMiB>32768)throw Error('归档队列总内存预算须为 128–32768 MB');
 if(!Number.isInteger(totalThreads)||totalThreads<1||totalThreads>64)throw Error('归档队列总线程预算须为 1–64');
 return {maxConcurrent,totalMemoryMiB,totalThreads};
}
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
