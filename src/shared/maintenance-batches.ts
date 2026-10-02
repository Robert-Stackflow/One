import type {MaintenanceOutcome} from './maintenance';

/** Preserve the worker's 1,000-item validation boundary without limiting a full selection. */
export async function applyMaintenanceBatches(ids:string[],apply:(ids:string[])=>Promise<MaintenanceOutcome>,progress:(outcome:MaintenanceOutcome)=>void=()=>{}){
 if(!ids.length||new Set(ids).size!==ids.length)throw Error('维护选择无效');
 const result:MaintenanceOutcome={succeeded:0,bytes:0,failed:[],failedCount:0};
 for(let at=0;at<ids.length;at+=1000){const next=await apply(ids.slice(at,at+1000));result.succeeded+=next.succeeded;result.bytes+=next.bytes;result.failedCount!+=next.failedCount??next.failed.length;result.failed.push(...next.failed.slice(0,Math.max(0,500-result.failed.length)));progress(result);}
 return result;
}
