import {searchEngineUrl,type SearchWebEngine} from '../shared/search-shortcuts';
export function parseSuggestions(data:unknown):string[]{
 const values=Array.isArray(data)&&Array.isArray(data[1])?data[1]:Array.isArray(data)?data:[];
 return [...new Set(values.map(value=>typeof value==='string'?value:typeof value?.phrase==='string'?value.phrase:'').filter(value=>value&&value.length<=160))].slice(0,8);
}
export async function searchSuggestions(engine:SearchWebEngine,query:string){
 if(!engine.suggestUrl||typeof query!=='string'||!query.trim()||query.length>200)return [];
 const url=searchEngineUrl(engine.suggestUrl,query.trim()),response=await fetch(url,{signal:AbortSignal.timeout(4000),redirect:'error',credentials:'omit',headers:{Accept:'application/json'}});
 if(!response.ok||Number(response.headers.get('content-length')||0)>128*1024)return [];
 const bytes=await response.arrayBuffer();if(bytes.byteLength>128*1024)return [];
 try{return parseSuggestions(JSON.parse(new TextDecoder().decode(bytes)));}catch{return [];}
}
