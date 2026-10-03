export type IndexPriority='high'|'normal'|'uncommon';
export interface IndexPriorityRule {path:string;priority:IndexPriority}
export const indexPriorityKey=(path:string)=>path.replaceAll('/','\\').replace(/\\+$/,'').toLowerCase();
export const indexedUnder=(path:string,root:string)=>{const p=indexPriorityKey(path),r=indexPriorityKey(root);return p===r||p.startsWith(r+'\\');};
export function validateIndexPriorities(value:unknown):IndexPriorityRule[]{
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>64)throw Error('最多设置 64 个目录优先级');
 const rules=new Map<string,IndexPriorityRule>();
 for(const rule of value){if(!rule||typeof rule.path!=='string'||rule.path.length>32768||/[\0\r\n]/.test(rule.path)||!(/^[A-Z]:[\\/]|^\\\\[^\\]+\\[^\\]+/i.test(rule.path))||!['high','normal','uncommon'].includes(rule.priority))throw Error('目录优先级无效');rules.set(indexPriorityKey(rule.path),{path:rule.path,priority:rule.priority});}
 return [...rules.values()];
}
