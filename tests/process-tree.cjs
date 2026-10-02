// Windows parent process IDs can refer to an earlier process with a reused ID.
// Compare exact FILETIME values, without rounding them through JS numbers.
function processTree(processes,root,expectedCreation){
 const byId=new Map(processes.map(p=>[p.pid,p])),parent=byId.get(root);
 if(!parent?.created||expectedCreation!==undefined&&parent.created!==expectedCreation)throw Error('Root process exited or changed during sampling');
 const creation=new Map(processes.filter(p=>p.created).map(p=>[p.pid,BigInt(p.created)])),owned=new Set([root]);
 let changed=true;while(changed){changed=false;for(const p of processes){
  if(owned.has(p.pid)||!owned.has(p.parentPid)||!creation.has(p.pid))continue;
  if(creation.get(p.pid)>=creation.get(p.parentPid)){owned.add(p.pid);changed=true;}
 }}
 return processes.filter(p=>owned.has(p.pid));
}
function totals(processes,at=performance.now()){
 return{at,resident:processes.reduce((n,p)=>n+p.resident,0),privateResident:processes.reduce((n,p)=>n+p.privateResident,0),private:processes.reduce((n,p)=>n+p.private,0),cpuSeconds:processes.reduce((n,p)=>n+p.cpuSeconds,0),processes};
}
module.exports={processTree,totals};
