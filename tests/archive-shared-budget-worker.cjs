const Module=require('node:module');
const path=require('node:path');
const fs=require('node:fs');
const [file,kind,configuration]=process.argv.slice(2),options=JSON.parse(configuration);
const filename=path.resolve('dist/main/archive-shared-worker-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(fs.readFileSync(file,'utf8'),filename);
const leases=new Map(),controllers=new Map(),gates=new Map();let service,budget;
const send=value=>process.send?.(value);
if(kind==='budget')budget=new mod.exports.ArchiveSharedBudget(options);
else{
 service=new mod.exports.ArchiveService(options.cache,(_owner,value)=>send({type:'progress',...value}),()=> '0',()=>{},true,undefined,()=>options);
 const execute=service.execute.bind(service);service.execute=async(...args)=>{
  if(gates.has(args[1])){const gate=gates.get(args[1]);send({type:'phase-held',id:args[1]});await gate.promise;gates.delete(args[1]);}
  return execute(...args);
 };
}
process.on('message',async command=>{
 const {action,id}=command;
 try{
  if(action==='reserve'){
   const controller=new AbortController();controllers.set(id,controller);
   try{const lease=await budget.acquire(id,command.resources,controller.signal,position=>send({type:'waiting',id,position}));leases.set(id,lease);send({type:'admitted',id,environment:lease.environment,budget:lease.budget});}finally{controllers.delete(id);}
  }else if(action==='release'){await leases.get(id)?.release();leases.delete(id);send({type:'released',id});}
  else if(action==='cancel'){controllers.get(id)?.abort(Error('test cancellation'));if(service)service.cancel(id,1);send({type:'cancelled',id});}
  else if(action==='configure'){budget?.configure(command.value);service?.setBudget(command.value);send({type:'configured',id});}
  else if(action==='run'){
   if(command.hold){let resolve;const promise=new Promise(done=>resolve=done);gates.set(id,{promise,resolve});}
   const result=await service.run(1,command.request,id);send({type:'completed',id,result});
  }else if(action==='resume'){gates.get(id)?.resolve();send({type:'resumed',id});}
  else if(action==='close'){for(const controller of controllers.values())controller.abort(Error('closing'));for(const gate of gates.values())gate.resolve();for(const lease of leases.values())await lease.release();await service?.stop();await budget?.close();send({type:'closed'});process.disconnect();}
 }catch(error){send({type:'failure',id,message:error.message,code:error.code});}
});
send({type:'ready'});
