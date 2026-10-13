export const sidebarGroups = [
  {id:'files',name:'文件',items:[['tools','文件工具'],['text','文本处理'],['search','文件搜索'],['disk','空间分析'],['archive','压缩与解压']]},
  {id:'tools',name:'工具',items:[['ai','AI 对话'],['input','操作增强'],['preview','快速预览'],['developer','开发工具'],['images','图片工具']]},
  {id:'capture',name:'截图与录制',items:[['capture','截图'],['recording','录制'],['materials','素材'],['pins','贴图']]},
  {id:'system',name:'系统',items:[['system','系统维护'],['ports','端口服务'],['hardware','系统信息']]},
] as const;
export type SidebarGroupId=typeof sidebarGroups[number]['id'];
export type SidebarPage=typeof sidebarGroups[number]['items'][number][0];
export interface SidebarPreferences {
  collapsed:Record<SidebarGroupId,boolean>;
  order:Record<SidebarGroupId,SidebarPage[]>;
  pinned:SidebarPage[];
}
export function defaultSidebar():SidebarPreferences {
  return {
    collapsed:Object.fromEntries(sidebarGroups.map(group=>[group.id,false])) as SidebarPreferences['collapsed'],
    order:Object.fromEntries(sidebarGroups.map(group=>[group.id,group.items.map(([id])=>id)])) as SidebarPreferences['order'],
    pinned:['tools','search','disk','input','ai','developer','images','capture','recording','system','ports','hardware'],
  };
}
export function validateSidebar(value:unknown):SidebarPreferences {
  const result=defaultSidebar();
  if(value===undefined)return result;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('侧边栏设置无效');
  const input=value as Partial<SidebarPreferences>;
  if(Object.keys(input).some(key=>!['collapsed','order','pinned'].includes(key)))throw Error('未知侧边栏设置');
  for(const key of ['collapsed','order'] as const){
    const map=input[key];
    if(map!==undefined&&(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).some(id=>!sidebarGroups.some(group=>group.id===id))))throw Error('侧边栏分组设置无效');
  }
  for(const group of sidebarGroups){
    const collapsed=input.collapsed?.[group.id];
    if(collapsed!==undefined){if(typeof collapsed!=='boolean')throw Error('侧边栏折叠设置无效');result.collapsed[group.id]=collapsed;}
    const order=input.order?.[group.id],allowed=group.items.map(([id])=>id) as SidebarPage[];
    if(order!==undefined){
      if(!Array.isArray(order)||order.length>allowed.length||new Set(order).size!==order.length||order.some(id=>!allowed.includes(id)))throw Error('只能调整同组功能的顺序');
      result.order[group.id]=[...order,...allowed.filter(id=>!order.includes(id))];
    }
  }
  if(input.pinned!==undefined){
    const allowed=sidebarGroups.flatMap(group=>group.items.map(([id])=>id)) as SidebarPage[];
    if(!Array.isArray(input.pinned)||input.pinned.length>allowed.length||new Set(input.pinned).size!==input.pinned.length||input.pinned.some(id=>!allowed.includes(id)))throw Error('侧边栏固定入口无效');
    result.pinned=[...input.pinned];
  }
  return result;
}
