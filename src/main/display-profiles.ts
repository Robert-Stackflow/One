import {randomUUID} from 'node:crypto';
import {profileName,validProfileId,validateDisplayProfiles,type DisplayProfile,type DisplayProfileWarning} from '../shared/display-profiles';
import type {DisplayManagementService} from './display-management';
type Update=(change:(current:DisplayProfile[])=>DisplayProfile[])=>Promise<DisplayProfile[]>;
export class DisplayProfilesService {
 constructor(private displays:DisplayManagementService,private read:()=>DisplayProfile[],private update:Update){}
 private find(id:unknown){if(!validProfileId(id))throw Error('方案标识无效');const profile=this.read().find(p=>p.id===id);if(!profile)throw Error('方案已删除，请重新选择');return profile;}
 async save(name:unknown,id?:string):Promise<{profiles:DisplayProfile[];profileId:string;warnings:DisplayProfileWarning[]}>{
  const title=profileName(name);if(id!==undefined)this.find(id);else if(this.read().length>=16)throw Error('最多保存 16 个显示器方案');
  if(this.read().some(p=>p.id!==id&&p.name.toLowerCase()===title.toLowerCase()))throw Error('显示器方案名称重复');
  const {targets,warnings}=await this.displays.captureProfile().catch(error=>{if(error instanceof Error&&(error.name==='AbortError'||/已取消显示器操作/.test(error.message)))throw Error('已取消保存方案');throw error;}),profileId=id||randomUUID();
  const profiles=await this.update(current=>{
   if(id&&!current.some(p=>p.id===id))throw Error('方案已删除，未保存更新');
   return validateDisplayProfiles([...current.filter(p=>p.id!==profileId),{id:profileId,name:title,targets}]);
  });return {profiles,profileId,warnings};
 }
 async rename(id:unknown,name:unknown){const profile=this.find(id),title=profileName(name);return this.update(current=>{
  if(!current.some(p=>p.id===profile.id))throw Error('方案已删除，请重新选择');return validateDisplayProfiles(current.map(p=>p.id===profile.id?{...p,name:title}:p));
 });}
 async remove(id:unknown){const profile=this.find(id);return this.update(current=>current.filter(p=>p.id!==profile.id));}
 async apply(id:unknown){const profile=this.find(id);try{return await this.displays.applyProfile(profile);}catch(error){throw Error(`方案应用未完成，部分参数可能已生效，请重新检测。${error instanceof Error?error.message:''}`);}}
}
