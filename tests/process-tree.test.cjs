const test=require('node:test'),assert=require('node:assert/strict'),{processTree,totals}=require('./process-tree.cjs');
const row=(pid,parentPid,created)=>({pid,parentPid,created:String(created),resident:10,privateResident:8,private:12,cpuSeconds:1});
test('memory attribution excludes older orphan branches under reused process IDs',()=>{
 const rows=[row(6,4,140n),row(4,3,120n),row(3,1,100n),row(1,0,90n),row(7,4,115n),row(8,7,150n),row(9,0,180n)];
 const selected=processTree(rows,1,'90');assert.deepEqual(selected.map(p=>p.pid),[6,4,3,1]);
 assert.deepEqual(totals(selected,100),{at:100,resident:40,privateResident:32,private:48,cpuSeconds:4,processes:selected});
});
test('exact creation times reject older children separated by less than JS number precision',()=>{
 const root=134000000000000002n,rows=[row(1,0,root),row(2,1,root-1n),row(3,1,root),row(4,1,root+1n)];
 assert.deepEqual(processTree(rows,1).map(p=>p.pid),[1,3,4]);
});
test('missing or replaced roots fail sampling instead of reporting zero memory',()=>{
 assert.throws(()=>processTree([row(2,1,100n)],1),/Root process/);
 assert.throws(()=>processTree([row(1,0,100n)],1,'99'),/Root process/);
 assert.throws(()=>processTree([{pid:1,parentPid:0}],1),/Root process/);
});
test('unknown creation times and disconnected cycles do not establish ancestry',()=>{
 const rows=[row(1,0,90n),{...row(2,1,100n),created:undefined},row(3,2,120n),row(4,5,130n),row(5,4,130n)];
 assert.deepEqual(processTree(rows,1).map(p=>p.pid),[1]);
});
