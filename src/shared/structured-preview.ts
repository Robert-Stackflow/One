export type StructureKind='object'|'array'|'string'|'number'|'boolean'|'null'|'undefined';
export interface StructureNode {id:number;kind:StructureKind;count:number;preview:string;truncated:boolean}
export interface StructureEntry {index:number;key:string;node:StructureNode}
export interface StructureLocation {parent:ExpandedBranch|null;index:number;branch?:ExpandedBranch}
const container=(node:StructureNode)=>node.kind==='object'||node.kind==='array';

/** Keep the parsed document in the worker; return only the requested property range. */
export class StructureStore {
 private nodes=new Map<number,unknown>();
 private ids=new WeakMap<object,number>();
 private keys=new WeakMap<object,string[]>();
 private next=1;
 constructor(value:unknown){this.nodes.set(0,value);if(value!==null&&typeof value==='object')this.ids.set(value,0);}
 private keyList(value:object){let keys=this.keys.get(value);if(!keys){keys=Object.keys(value);this.keys.set(value,keys);}return keys;}
 private value(id:number){if(!this.nodes.has(id))throw new Error('结构节点不存在');return this.nodes.get(id);}
 private describe(value:unknown):StructureNode {
  if(value!==null&&typeof value==='object'){
   let id=this.ids.get(value);if(id===undefined){id=this.next++;this.ids.set(value,id);this.nodes.set(id,value);}
   const array=Array.isArray(value);return{id,kind:array?'array':'object',count:array?value.length:this.keyList(value).length,preview:'',truncated:false};
  }
  const kind=value===null?'null':typeof value as StructureKind;
  return{id:-1,kind,count:0,preview:typeof value==='string'?JSON.stringify(value.slice(0,240)):String(value),truncated:typeof value==='string'&&value.length>240};
 }
 root(){return{...this.describe(this.value(0)),id:0};}
 children(id:number,start:number,count:number):StructureEntry[]{
  const value=this.value(id);if(value===null||typeof value!=='object')throw new Error('该节点没有子项');
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(count)||count<1||count>256)throw new Error('结构范围无效');
  const array=Array.isArray(value),keys=array?undefined:this.keyList(value),length=array?value.length:keys!.length,end=Math.min(length,start+count),entries:StructureEntry[]=[];
  for(let index=start;index<end;index++){const key=array?String(index):keys![index];entries.push({index,key,node:this.describe((value as Record<string,unknown>)[key])});}
  return entries;
 }
 text(id:number,index?:number){
  let value=this.value(id);
  if(index!==undefined){if(value===null||typeof value!=='object'||!Number.isSafeInteger(index)||index<0)throw new Error('结构范围无效');const key=Array.isArray(value)?String(index):this.keyList(value)[index];if(key===undefined||!Object.hasOwn(value,key))throw new Error('结构节点不存在');value=(value as Record<string,unknown>)[key];}
  return typeof value==='string'?value:JSON.stringify(value,null,2)??String(value);
 }
}

export class ExpandedBranch {
 open=false;size=1;children=new Map<number,ExpandedBranch>();
 constructor(readonly node:StructureNode,readonly key:string,readonly parent:ExpandedBranch|null,readonly index:number,readonly depth:number){}
 sorted(){return [...this.children.values()].sort((a,b)=>a.index-b.index);}
}

/** Flat row positions count unopened properties without allocating a row for each one. */
export class StructureTree {
 readonly root:ExpandedBranch;
 constructor(node:StructureNode){this.root=new ExpandedBranch(node,'$',null,0,0);this.root.open=container(node);this.root.size=1+(this.root.open?node.count:0);}
 locate(position:number):StructureLocation {
  if(!Number.isSafeInteger(position)||position<0||position>=this.root.size)throw new Error('结构行不存在');
  let branch=this.root,local=position;
  outer:for(;;){
   if(local===0)return{parent:branch.parent,index:branch.index,branch};
   let offset=1,next=0;
   for(const child of branch.sorted()){
    const gap=child.index-next;
    if(local<offset+gap)return{parent:branch,index:next+local-offset};
    offset+=gap;
    if(local<offset+child.size){local-=offset;branch=child;continue outer;}
    offset+=child.size;next=child.index+1;
   }
   return{parent:branch,index:next+local-offset};
  }
 }
 circular(location:StructureLocation,node:StructureNode){if(!container(node))return false;for(let p=location.parent;p;p=p.parent)if(p.node.id===node.id)return true;return false;}
 expand(location:StructureLocation,entry:StructureEntry){
  if(!container(entry.node)||!entry.node.count||this.circular(location,entry.node))return;
  const branch=location.branch||new ExpandedBranch(entry.node,entry.key,location.parent,location.index,(location.parent?.depth??-1)+1);
  if(branch.open)return branch;
  branch.open=true;if(branch.parent)branch.parent.children.set(branch.index,branch);this.update(branch);return branch;
 }
 collapse(branch:ExpandedBranch){branch.open=false;branch.children.clear();branch.size=1;if(branch.parent){branch.parent.children.delete(branch.index);this.update(branch.parent);}else this.update(branch);}
 collapseAll(){this.collapse(this.root);}
 private update(branch:ExpandedBranch){for(let p:ExpandedBranch|null=branch;p;p=p.parent)p.size=1+(p.open?p.node.count+[...p.children.values()].reduce((sum,child)=>sum+child.size-1,0):0);}
 position(branch:ExpandedBranch){let position=0;for(let p=branch;p.parent;p=p.parent){position+=1+p.index;for(const sibling of p.parent.children.values())if(sibling.index<p.index)position+=sibling.size-1;}return position;}
}

export function structurePath(location:StructureLocation,key:string){
 const parts:string[]=[];if(location.parent)parts.push(propertyPart(key,location.parent.node.kind==='array'));
 for(let p=location.parent;p?.parent;p=p.parent)parts.push(propertyPart(p.key,p.parent.node.kind==='array'));
 return '$'+parts.reverse().join('');
}
function propertyPart(key:string,array:boolean){return array?'['+key+']':/^[A-Za-z_$][\w$]*$/.test(key)?'.'+key:'['+JSON.stringify(key)+']';}
