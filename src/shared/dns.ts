export interface DnsCheckResult{server:string;latencyMs:number;addresses4:string[];addresses6:string[];aliases:string[];error?:string}
export interface DnsCheckReport{domain:string;created:number;results:DnsCheckResult[]}
