export type ArchiveRecoveryKind='extract'|'volume-update';
export type ArchiveRecoveryRecord={id:string;created:number;archive:string;parent:string;path:string;ownerPid:number}&({kind?:'extract';stage?:never}|{kind:'volume-update';stage:string});
export type ArchiveRecoverySummary={id:string;created:number;archive?:string;parent?:string;path?:string;error?:string;active:boolean;stage?:string;kind?:ArchiveRecoveryKind};
export type ArchiveRecoveryPage={items:ArchiveRecoverySummary[];total:number;offset:number;truncated?:boolean};
export type ArchiveRecoveryInspection={id:string;kind?:ArchiveRecoveryKind;state:'pending'|'committed'|'rolled-back'|'incomplete'|'empty'|'missing'|'invalid';message:string;items:number;files:number;directories:number;replaced:number;published:number;skipped:number;oldVolumes?:number;newVolumes?:number;samples:{name:string;directory:boolean;existing:boolean}[]};
