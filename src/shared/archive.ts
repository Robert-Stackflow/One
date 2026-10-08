export type ArchiveEncoding = 0|437|932|936|950|65001;
export type ArchiveConflict = 'rename'|'skip'|'replace';
export type ArchiveEntry = {index:number;name:string;directory:boolean;size:number;compressed:number;encrypted:boolean};
export type ArchiveListing = {path:string;total:number;comment:string;offset:number;entries:ArchiveEntry[];revision?:string;editable?:boolean};
export type ArchiveProgress = {id:string;operation:'create'|'extract'|'test'|'prepare'|'update'|'commit'|'drag';done:number;total:number};
export type ArchiveResult = {path:string;count:number;skipped?:number;cancelled?:boolean};
export type ArchiveEdit =
  | {kind:'delete';indexes:number[]}
  | {kind:'rename';index:number;name:string}
  | {kind:'mkdir';name:string}
  | {kind:'add';source:string;name:string;replace?:boolean}
  | {kind:'comment';text:string};
export type ArchiveRequest =
  | {operation:'list';path:string;offset?:number;encoding?:ArchiveEncoding;password?:string}
  | {operation:'create';path:string;sources:string[];password?:string;volumeBytes?:number}
  | {operation:'extract';path:string;parent:string;destination?:'folder'|'smart'|'here';conflict?:ArchiveConflict;selected?:number[];password?:string;encoding?:ArchiveEncoding}
  | {operation:'update';path:string;revision:string;changes:ArchiveEdit[];password?:string;encoding?:ArchiveEncoding}
  | {operation:'drag';path:string;revision:string;selected:number[];password?:string;encoding?:ArchiveEncoding}
  | {operation:'test';path:string;password?:string;encoding?:ArchiveEncoding};
