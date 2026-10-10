export type QrErrorLevel='L'|'M'|'Q'|'H';
export interface QrRequest {text:string;size:256|512|1024;level:QrErrorLevel}
export interface QrResult {url:string;size:number;bytes:number}
