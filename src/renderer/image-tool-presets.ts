export interface NamedImagePreset<T>{name:string;value:T}

export function readImagePresets<T>(storage:Storage,key:string,validate:(value:unknown)=>T):NamedImagePreset<T>[]{
 try{
  const data=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(data))return [];
  const seen=new Set<string>(),result:NamedImagePreset<T>[]=[];
  for(const item of data){if(!item||typeof item.name!=='string')continue;const name=item.name.trim(),lower=name.toLocaleLowerCase();if(!name||name.length>30||/[\x00-\x1f]/.test(name)||seen.has(lower))continue;try{result.push({name,value:validate(item.value)});seen.add(lower);}catch{}if(result.length>=12)break;}
  return result;
 }catch{return [];}
}

export function saveImagePreset<T>(storage:Storage,key:string,presets:NamedImagePreset<T>[],name:string,value:T){
 const cleaned=name.trim();if(!cleaned||cleaned.length>30||/[\x00-\x1f]/.test(cleaned))throw Error('预设名称需为 1 至 30 个字符');
 const index=presets.findIndex(item=>item.name.toLocaleLowerCase()===cleaned.toLocaleLowerCase());
 if(index<0&&presets.length>=12)throw Error('最多保存 12 个预设');
 const next=[...presets],item={name:cleaned,value};if(index>=0)next[index]=item;else next.push(item);
 storage.setItem(key,JSON.stringify(next));return next;
}

export function deleteImagePreset<T>(storage:Storage,key:string,presets:NamedImagePreset<T>[],name:string){
 const next=presets.filter(item=>item.name!==name);storage.setItem(key,JSON.stringify(next));return next;
}
