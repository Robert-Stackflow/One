import {join,relative,isAbsolute,resolve} from 'node:path';
import type {ArchiveRecoveryRecord,ArchiveRecoveryInspection} from '../shared/archive-recovery';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const absolute=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=32768&&!/[\0-\x1f]/.test(value)&&isAbsolute(value)&&resolve(value)===value;
const integer=(value:unknown,max=4096):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const stamp=(value:unknown,parts:number):value is string=>typeof value==='string'&&value.split(':').length===parts&&value.split(':').every(part=>/^\d{1,10}$/.test(part)&&BigInt(part)<=0xffffffffn);
const fields=(value:Record<string,unknown>,names:string[])=>{const keys=Object.keys(value);return keys.length===names.length&&keys.every((name,index)=>name===names[index]);};
function invalid(message:string):never{throw Error(message);}

/** Payload validation for the private version 3 native journal. The caller
 * verifies streaming envelope CRCs, ordering, byte limits and directory races.
 * This is a read-only report; native restore/cleanup independently revalidates
 * the plan and locks the actual files before any mutation. */
export function volumeJournalInspector(value:ArchiveRecoveryRecord&{kind:'volume-update'},result:ArchiveRecoveryInspection,parentIdentity:string,recoveryIdentity:string,stageIdentity?:string){
 let header=false,prepared=false,committed=false,rollback=false,rolledBack=false,format=0,oldCount=0,newCount=0,backed=0,published=0,lastBackup=-1,lastPublished=-1;
 let names:string[]=[],oldNames=new Set<string>(),newNames=new Set<string>();
 const flags=new Uint8Array(4096),identities=new Set<string>();
 const family=(primary:string,count:number)=>Array.from({length:count},(_,index)=>format===0?(index?primary.slice(0,-4)+'.z'+String(index).padStart(2,'0'):primary):primary.slice(0,-3)+String(index+1).padStart(3,'0'));
 const remember=(fingerprint:unknown)=>{
  if(!stamp(fingerprint,7))invalid('分卷恢复清单文件身份无效');
  const identity=fingerprint.split(':').slice(0,3).join(':');if(identities.has(identity))invalid('分卷恢复计划中的文件身份重复');identities.add(identity);
 };
 const line=(row:Record<string,unknown>)=>{
  if(row.type==='header'){
   if(header||result.items||!fields(row,['type','version','kind','parent','stage','recovery','parentIdentity','stageIdentity','recoveryIdentity','primary','format','oldVolumes','newVolumes'])||row.version!==3||row.kind!=='volume-update'||
    !absolute(row.parent)||!same(row.parent,value.parent)||!absolute(row.stage)||!same(row.stage,value.stage)||!absolute(row.recovery)||!same(row.recovery,value.path)||
    !stamp(row.parentIdentity,3)||!stamp(row.stageIdentity,3)||!stamp(row.recoveryIdentity,3)||row.parentIdentity===row.stageIdentity||row.parentIdentity===row.recoveryIdentity||row.stageIdentity===row.recoveryIdentity||
    typeof row.primary!=='string'||!row.primary||/[<>:"|?*\\/\0-\x1f]/.test(row.primary)||/[. ]$/.test(row.primary)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.primary)||!same(join(value.parent,row.primary),value.archive)||
    ![0,7].includes(Number(row.format))||typeof row.format!=='number'||!integer(row.oldVolumes)||!row.oldVolumes||!integer(row.newVolumes)||!row.newVolumes||
    (row.format===0?(!/\.zip$/i.test(row.primary)||row.oldVolumes<2):!/\.7z\.001$/i.test(row.primary)))invalid('分卷恢复清单不属于本次任务或版本不受支持');
   if(row.parentIdentity!==parentIdentity||row.recoveryIdentity!==recoveryIdentity||stageIdentity&&row.stageIdentity!==stageIdentity)invalid('分卷恢复目录或暂存目录身份已经变化');
   format=row.format as number;oldCount=row.oldVolumes as number;newCount=row.newVolumes as number;
   const primary=(row.primary as string).toLowerCase();oldNames=new Set(family(primary,oldCount));newNames=new Set(family(primary,newCount));names=[...new Set([...oldNames,...newNames])].sort();header=true;
   result.oldVolumes=oldCount;result.newVolumes=newCount;return;
  }
  if(!header||rolledBack)invalid('分卷恢复清单状态顺序无效');
  if(row.type==='item'){
   if(prepared||rollback||!fields(row,['type','index','source','target','backup','sourceStamp','targetStamp'])||row.index!==result.items||result.items>=names.length)invalid('分卷恢复清单项目顺序无效');
   const index=result.items,name=names[index],old=oldNames.has(name),next=newNames.has(name);
   if(!absolute(row.target)||!same(row.target,join(value.parent,name))||!absolute(row.backup)||!same(row.backup,join(value.path,index+'.original'))||
    (next?(!absolute(row.source)||!same(row.source,join(value.stage,name))||!stamp(row.sourceStamp,7)):(row.source!==''||row.sourceStamp!==''))||
    (old?!stamp(row.targetStamp,7):row.targetStamp!==''))invalid('分卷恢复清单路径或文件身份无效');
   if(next)remember(row.sourceStamp);if(old)remember(row.targetStamp);
   flags[index]=1|(old?2:0)|(next?4:0);++result.items;++result.files;if(old)++result.replaced;
   if(result.samples.length<30)result.samples.push({name:relative(value.parent,row.target as string),directory:false,existing:old});return;
  }
  if(row.type==='prepared'){
   if(prepared||rollback||!fields(row,['type','items'])||row.items!==result.items||result.items!==names.length)invalid('分卷恢复清单没有完整计划');prepared=true;return;
  }
  if(row.type==='backed-up'||row.type==='published'){
   if(!prepared||rollback||committed||!fields(row,['type','index'])||!integer(row.index,4095)||!(flags[row.index]&1))invalid('分卷恢复清单发布顺序无效');
   const index=row.index as number;
   if(row.type==='backed-up'){
    if(published||!(flags[index]&2)||flags[index]&8||index<=lastBackup)invalid('分卷恢复清单备份顺序无效');flags[index]|=8;lastBackup=index;++backed;
   }else{
    if(backed!==oldCount||!(flags[index]&4)||flags[index]&16||index<=lastPublished)invalid('分卷恢复清单发布顺序无效');flags[index]|=16;lastPublished=index;++published;++result.published;
   }return;
  }
  if(row.type==='committed'){
   if(!prepared||rollback||committed||!fields(row,['type','count','removed'])||backed!==oldCount||published!==newCount||row.count!==newCount||row.removed!==Math.max(0,oldCount-newCount))invalid('分卷恢复清单完成标记无效');committed=true;return;
  }
  if(row.type==='rollback-started'){
   if(!prepared||rollback||committed||!fields(row,['type']))invalid('分卷恢复清单回滚顺序无效');rollback=true;return;
  }
  if(row.type==='rolled-back'){
   if(!rollback||!fields(row,['type']))invalid('分卷恢复清单回滚完成标记无效');rolledBack=true;return;
  }
  invalid('分卷恢复清单包含未知记录');
 };
 const finish=()=>{
  if(!header||!prepared)invalid('分卷恢复清单没有完整计划');
  result.state=committed?'committed':rolledBack?'rolled-back':'pending';
  result.message=committed?'清单记录整组分卷已保存完成，可在核对当前卷组后清理旧副本。':rolledBack?'清单记录旧卷组已回滚。还原和清理时仍会核对全部当前文件。':'分卷保存或回滚尚未确认完成，请保留原卷、暂存目录和恢复资料。';
 };
 return{line,finish};
}
