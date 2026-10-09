import type {ArchiveScan} from './archive-scan';
export type ArchiveEncoding = 0|437|932|936|950|65001;
// Unlike filename encoding, 0 explicitly means the Windows system code page.
export type ArchivePasswordEncoding = ArchiveEncoding;
export type ArchiveConflict = 'rename'|'skip'|'replace';
export type ArchiveBrowse = {directory:string;search:string;flat:boolean};
export type ArchiveEntry = {index:number;name:string;directory:boolean;size:number;compressed:number;encrypted:boolean;implicit?:boolean};
export type ArchiveEntryDetails = {entry:ArchiveEntry;packedKnown:boolean;packedShared:boolean;modified?:number;crc32?:string;method?:string};
export type ArchiveListing = {path:string;total:number;comment:string;offset:number;entries:ArchiveEntry[];revision?:string;editable?:boolean;matched?:number;browse?:ArchiveBrowse};
export type PreviewArchiveRequest={path:string;offset?:number;browse?:ArchiveBrowse;password?:string;encoding?:ArchiveEncoding;passwordEncoding?:ArchivePasswordEncoding};
export type ArchiveProgress = {id:string;operation:'create'|'extract'|'test'|'prepare'|'update'|'commit'|'drag'|'scan'|'queue'|'recover'|'cleanup';done:number;total:number;queuePosition?:number};
export type ArchiveResult = {path:string;count:number;revision?:string;skipped?:number;cancelled?:boolean;recovery?:string;scan?:ArchiveScan;risk?:import('./archive-risk').ArchiveRisk;details?:ArchiveEntryDetails};
export type ArchiveTaskOperation='create'|'extract'|'test'|'update'|'drag'|'recover'|'cleanup';
export type ArchiveTaskState='running'|'completed'|'failed'|'cancelled'|'interrupted';
export type ArchiveTask = {id:string;operation:ArchiveTaskOperation;state:ArchiveTaskState;path:string;started:number;finished?:number;phase:ArchiveProgress['operation'];done:number;total:number;queuePosition?:number;cancellable:boolean;result?:ArchiveResult;scan?:ArchiveScan;message?:string};
export type ArchiveTaskOverview={active:ArchiveTask[];recent:ArchiveTask[];error:string};
export type ArchiveEdit =
  | {kind:'delete';indexes:number[];folders?:string[]}
  | {kind:'rename';index:number;name:string}
  | {kind:'rename-folder';folder:string;name:string}
  | {kind:'mkdir';name:string}
  | {kind:'add';source:string;name:string;replace?:boolean}
  | {kind:'comment';text:string};
export type ArchiveRequest = Partial<import('./archive-options').ArchiveResources> & {passwordEncoding?:ArchivePasswordEncoding;riskApproval?:import('./archive-risk').ArchiveRiskApproval;extractionLimits?:import('./archive-risk').ExtractionBudget} & (
  | {operation:'list';path:string;offset?:number;encoding?:ArchiveEncoding;password?:string;browse?:ArchiveBrowse}
  | {operation:'details';path:string;index:number;revision:string;encoding?:ArchiveEncoding;password?:string}
  | ({operation:'create';path:string;sources:string[];password?:string;volumeBytes?:number;level?:number}&Partial<import('./archive-compression').ArchiveCompression>)
  | {operation:'extract';path:string;parent:string;destination?:'folder'|'smart'|'here';conflict?:ArchiveConflict;selected?:number[];selectedFolders?:string[];revision?:string;password?:string;encoding?:ArchiveEncoding;propagateZone?:boolean;scan?:boolean}
  | {operation:'update';path:string;revision:string;changes:ArchiveEdit[];password?:string;encoding?:ArchiveEncoding}
  | {operation:'drag';path:string;revision:string;selected:number[];selectedFolders?:string[];password?:string;encoding?:ArchiveEncoding;propagateZone?:boolean;scan?:boolean}
  | {operation:'test';path:string;password?:string;encoding?:ArchiveEncoding});
