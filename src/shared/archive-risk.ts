import {validArchiveRevision} from './archive-revision';
export type ArchiveRisk={revision:string;entries:number;bytes:number;compressed:number;nested:number;highRatio:boolean};
export type ArchiveRiskApproval={revision:string;maxBytes:number;maxMilliseconds:number};
export type ExtractionBudget=Pick<ArchiveRiskApproval,'maxBytes'|'maxMilliseconds'>;
export const extractionDefaults={maxBytes:64*1024**3,maxMilliseconds:30*60*1000};
export function extractionBudget(value:unknown):ExtractionBudget {
 if(value===undefined)return {...extractionDefaults};
 if(!value||typeof value!=='object')throw Error('解压上限无效');const budget=value as ExtractionBudget;
 if(!Number.isSafeInteger(budget.maxBytes)||budget.maxBytes<1||!Number.isSafeInteger(budget.maxMilliseconds)||budget.maxMilliseconds<1||budget.maxMilliseconds>24*60*60*1000)throw Error('解压上限无效');
 return {maxBytes:budget.maxBytes,maxMilliseconds:budget.maxMilliseconds};
}
export function validArchiveRisk(value:unknown):value is ArchiveRisk {
 if(!value||typeof value!=='object')return false;const risk=value as ArchiveRisk;
 return validArchiveRevision(risk.revision)&&['entries','bytes','compressed','nested'].every(key=>Number.isSafeInteger(risk[key as keyof ArchiveRisk])&&Number(risk[key as keyof ArchiveRisk])>=0)&&risk.entries<=1000000&&risk.nested<=risk.entries&&typeof risk.highRatio==='boolean';
}
export function riskApproval(value:unknown):ArchiveRiskApproval|undefined {
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object')throw Error('解压风险确认无效');const approval=value as ArchiveRiskApproval;
 if(!validArchiveRevision(approval.revision))throw Error('解压风险确认无效');
 return {revision:approval.revision,...extractionBudget(approval)};
}
export function archiveRiskReasons(risk:ArchiveRisk):string[]{
 const reasons:string[]=[];
 if(risk.entries>=100000)reasons.push(`包含 ${risk.entries.toLocaleString()} 个项目`);
 if(risk.bytes>=extractionDefaults.maxBytes)reasons.push(`声明展开量 ${(risk.bytes/1024**3).toFixed(1)} GiB`);
 if(risk.highRatio)reasons.push('声明压缩比达到 1000∶1');
 return reasons;
}
