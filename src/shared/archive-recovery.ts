export type ArchiveRecoveryRecord={id:string;created:number;archive:string;parent:string;path:string;ownerPid:number};
export type ArchiveRecoverySummary={id:string;created:number;archive?:string;parent?:string;path?:string;error?:string;active:boolean};
export type ArchiveRecoveryPage={items:ArchiveRecoverySummary[];total:number;offset:number;truncated?:boolean};
export type ArchiveRecoveryInspection={id:string;state:'pending'|'committed'|'rolled-back'|'incomplete'|'empty'|'missing'|'invalid';message:string;items:number;files:number;directories:number;replaced:number;published:number;skipped:number;samples:{name:string;directory:boolean;existing:boolean}[]};
