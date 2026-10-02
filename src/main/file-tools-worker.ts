import {parentPort,workerData} from 'node:worker_threads';
import {runFileTool} from './file-tools-engine';
void runFileTool(workerData.task,{...workerData.context,progress:value=>parentPort!.postMessage({progress:value})}).then(report=>parentPort!.postMessage({report})).catch(error=>parentPort!.postMessage({error:error instanceof Error?error.message:String(error)}));
