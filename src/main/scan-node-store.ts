import type {ScanNode} from '../shared/types';

interface Prefix {parent:string;base:string;users:number}

/** Share each parent directory once; reconstruct file paths only at IPC boundaries. */
export class ScanNodeStore {
 private prefixes=new Map<string,Prefix>();
 retain(node:ScanNode):StoredScanNode {
  let prefix:Prefix|undefined;
  const base=node.path.slice(0,node.path.length-node.name.length);
  if(node.parent&&node.name&&node.path.endsWith(node.name)&&(base===node.parent+'\\'||base===node.parent+'/'||base===node.parent)) {
   prefix=this.prefixes.get(base);
   if(!prefix){prefix={parent:node.parent,base,users:0};this.prefixes.set(base,prefix);}
   // Preserve an unusual alternate spelling of the parent exactly.
   if(prefix.parent!==node.parent)prefix=undefined;
  }
  if(prefix)prefix.users++;
  return new StoredScanNode(node,prefix);
 }
 release(node:StoredScanNode){const prefix=node.prefix;if(prefix&&--prefix.users===0)this.prefixes.delete(prefix.base);}
 clear(){this.prefixes.clear();}
}

export class StoredScanNode implements ScanNode {
 readonly name:string;readonly directory:boolean;size:number;readonly modified?:number;readonly issue?:string;
 private readonly fullPath?:string;private readonly fullParent?:string|null;
 constructor(node:ScanNode,readonly prefix?:Prefix){
  this.name=node.name;this.directory=node.directory;this.size=node.size;this.modified=node.modified;this.issue=node.issue;
  if(!prefix){this.fullPath=node.path;this.fullParent=node.parent;}
 }
 get path(){return this.prefix?this.prefix.base+this.name:this.fullPath!;}
 get parent(){return this.prefix?this.prefix.parent:this.fullParent!;}
}

export function scanNodePatch(node:ScanNode):ScanNode {
 return {path:node.path,parent:node.parent,name:node.name,directory:node.directory,size:node.size,modified:node.modified,issue:node.issue};
}
