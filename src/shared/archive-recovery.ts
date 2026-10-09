export type ArchiveRecoveryKind='extract'|'volume-update';
export type ArchiveRecoveryRecord={id:string;created:number;archive:string;parent:string;path:string;ownerPid:number}&({kind?:'extract';stage?:never}|{kind:'volume-update';stage:string});
export type ArchiveRecoverySummary={id:string;created:number;archive?:string;parent?:string;path?:string;error?:string;active:boolean;stage?:string;kind?:ArchiveRecoveryKind};
export type ArchiveRecoveryPage={items:ArchiveRecoverySummary[];total:number;offset:number;truncated?:boolean};
export type ArchiveStageSnapshot={token:string;sealed:boolean;created:number;files:number;bytes:number;retired:number;missing:number;stageMissing:boolean;recoveryMissing:boolean};
export type ArchiveRecoveryInspection={id:string;kind?:ArchiveRecoveryKind;state:'pending'|'committed'|'rolled-back'|'incomplete'|'empty'|'missing'|'invalid'|'staged';message:string;items:number;files:number;directories:number;replaced:number;published:number;skipped:number;oldVolumes?:number;newVolumes?:number;stage?:ArchiveStageSnapshot;samples:{name:string;directory:boolean;existing:boolean}[]};

/** Only accept the bounded private native snapshot, never a caller supplied path. */
export function archiveStageInspection(value:unknown):ArchiveStageSnapshot&{samples:string[]}{
 const names=['type','token','sealed','created','files','bytes','retired','missing','stageMissing','recoveryMissing','samples'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||!names.every(name=>Object.hasOwn(value,name)))throw Error('暂存检查返回无效数据');
 const row=value as Record<string,unknown>,count=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
 if(row.type!=='stage-inspection'||typeof row.token!=='string'||!/^[a-f0-9]{64}$/.test(row.token)||typeof row.sealed!=='boolean'||typeof row.stageMissing!=='boolean'||typeof row.recoveryMissing!=='boolean'||!count(row.created,4097)||!count(row.files,4097)||!count(row.bytes,Number.MAX_SAFE_INTEGER)||!count(row.retired,1)||!count(row.missing,4097)||row.created!==row.files+row.retired+row.missing||row.stageMissing&&(row.files!==0||row.bytes!==0)||row.recoveryMissing&&(!row.stageMissing||row.created!==0)||!Array.isArray(row.samples)||row.samples.length!==Math.min(row.files,30)||!row.samples.every(name=>typeof name==='string'&&name.length>0&&name.length<=32768&&!/[\\/<>:"|?*\0-\x1f]/.test(name)&&name!=='.'&&name!=='..'&&!/[. ]$/.test(name))||new Set(row.samples.map(name=>name.toLowerCase())).size!==row.samples.length)throw Error('暂存检查返回无效数据');
 return{token:row.token,sealed:row.sealed,created:row.created,files:row.files,bytes:row.bytes,retired:row.retired,missing:row.missing,stageMissing:row.stageMissing,recoveryMissing:row.recoveryMissing,samples:[...row.samples]};
}
