export type HashAlgorithm='md5'|'sha1'|'sha256'|'sha512';
export type HashRequest={kind:'text';text:string;algorithm:HashAlgorithm;expected?:string}|{kind:'file';path:string;algorithm:HashAlgorithm;expected?:string};
export interface HashResult {algorithm:HashAlgorithm;digest:string;bytes:number;match?:boolean}
export interface HashProgress {processed:number;total:number}
