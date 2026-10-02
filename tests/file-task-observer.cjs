// Diagnostics live only in the isolated test process, never in the release app.
async function observeFileTasks(app){
 await require('@playwright/test').expect.poll(()=>app.evaluate(({ipcMain})=>ipcMain._invokeHandlers.has('one:file-tools-run')),{timeout:10000}).toBe(true);
 await app.evaluate(({ipcMain})=>{
  const threads=process.getBuiltinModule('worker_threads'),Original=threads.Worker;
  globalThis.fileTaskTimings=[];
  threads.Worker=class extends Original{
   constructor(file,options){
    super(file,options);
    if(!String(file).endsWith('file-tools-worker.cjs'))return;
    const row={id:options.workerData.context.id,kind:options.workerData.task.kind,started:performance.now()};
    this.fileTaskTiming=row;globalThis.fileTaskTimings.push(row);
    this.on('message',message=>{if(message.report)row.report=performance.now();if(message.error){row.error=String(message.error);row.report=performance.now();}});
    this.once('exit',code=>{row.exited=performance.now();row.exitCode=code;});
   }
   terminate(){
    const row=this.fileTaskTiming;if(row)row.terminate=performance.now();
    const result=super.terminate();
    if(row)result.then(()=>row.released=performance.now(),error=>row.terminationError=String(error));
    return result;
   }
  };
  const original=ipcMain._invokeHandlers.get('one:file-tools-run');
  if(!original)throw Error('File task IPC missing');
  ipcMain._invokeHandlers.set('one:file-tools-run',async(...args)=>{const report=await original(...args);const row=globalThis.fileTaskTimings.find(r=>r.id===report.id);if(row)row.responded=performance.now();return report;});
 });
}
async function fileTaskTimings(app){return app.evaluate(()=>globalThis.fileTaskTimings.map(row=>({...row,workMs:row.report-row.started,releaseMs:row.released-row.terminate,responseAfterReportMs:row.responded-row.report})));}
module.exports={observeFileTasks,fileTaskTimings};
