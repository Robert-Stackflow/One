export type ArchiveEncoding = 0|437|932|936|950|65001;
export type ArchiveEntry = {index:number;name:string;directory:boolean;size:number;compressed:number;encrypted:boolean};
export type ArchiveListing = {path:string;total:number;comment:string;offset:number;entries:ArchiveEntry[]};
export type ArchiveProgress = {id:string;operation:'create'|'extract'|'test'|'prepare';done:number;total:number};
export type ArchiveResult = {path:string;count:number};
export type ArchiveRequest =
  | {operation:'list';path:string;offset?:number;encoding?:ArchiveEncoding;password?:string}
  | {operation:'create';path:string;sources:string[];password?:string;volumeBytes?:number}
  | {operation:'extract';path:string;parent:string;destination?:'folder'|'smart';selected?:number[];password?:string;encoding?:ArchiveEncoding}
  | {operation:'test';path:string;password?:string;encoding?:ArchiveEncoding};
