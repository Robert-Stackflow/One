import {parentPort,workerData} from 'node:worker_threads';
import {MaintenanceService} from './maintenance-service';
const service=new MaintenanceService(workerData.path,workerData.roots,value=>parentPort!.postMessage({progress:value}));
const operations=['scan','apply','receipts','restore','manage'] as const;
parentPort!.on('message',async({id,operation,args})=>{try{if(operation==='stop'){service.stop();return;}if(!operations.includes(operation))throw new Error('维护任务无效');const value=await (service[operation as typeof operations[number]] as (...args:any[])=>Promise<unknown>).apply(service,args);parentPort!.postMessage({id,value});}catch(error){parentPort!.postMessage({id,error:(error as Error).message});}});
