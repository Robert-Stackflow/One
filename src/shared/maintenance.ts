export type MaintenanceKind='startup'|'registry'|'disk';
export interface MaintenanceEntry {id:string;name:string;source:string;status:string;command:string;location:string;category:string;detail:string;action:'disable'|'clean'|'recycle'|'hibernate'|'manage'|'';bytes?:number;count?:number}
export interface MaintenanceReport {id:string;kind:MaintenanceKind;created:number;entries:MaintenanceEntry[]}
export interface MaintenanceReceipt {id:string;created:number;name:string;restorable:boolean;restored:boolean;items:number}
export interface MaintenanceOutcome {succeeded:number;failed:{name:string;error:string}[];bytes:number;failedCount?:number}
export interface MaintenanceProgress { kind:MaintenanceKind;phase:'scan'|'apply'|'restore';completed:number;total:number;label:string }
