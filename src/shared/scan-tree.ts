import type {DiskNode,ScanProgress} from './types';

const parentLink=Symbol('scan-parent');
type TreeNode=DiskNode&{[parentLink]?:TreeNode|string};
const emptyChildren=Object.freeze([]) as unknown as DiskNode[];

export class ScanTree {
 readonly nodes=new Map<string,TreeNode>();
 private waiting=new Map<string,Set<TreeNode>>();
 root?:DiskNode;
 private detach(node:TreeNode,affected:Set<TreeNode>){
  const parent=node[parentLink];
  if(typeof parent==='string'){
   const children=this.waiting.get(parent);children?.delete(node);if(!children?.size)this.waiting.delete(parent);
  }else if(parent)affected.add(parent);
  node[parentLink]=undefined;
 }
 private attach(node:TreeNode,path:string|null){
  if(!path)return;
  const parent=this.nodes.get(path);
  if(parent?.directory){node[parentLink]=parent;parent.children.push(node);}
  else {node[parentLink]=path;let children=this.waiting.get(path);if(!children){children=new Set();this.waiting.set(path,children);}children.add(node);}
 }
 apply(progress:ScanProgress){
  const affected=new Set<TreeNode>();
  // Remove each parent's children once, even when an entire large folder disappears.
  for(const path of progress.removed||[]){
   const first=this.nodes.get(path);if(!first)continue;const pending=[first];
   while(pending.length){const node=pending.pop()!;for(const child of node.children)pending.push(child as TreeNode);this.detach(node,affected);this.nodes.delete(node.path);}
  }
  for(const parent of affected)parent.children=parent.children.filter(node=>this.nodes.get(node.path)===node);
  affected.clear();
  const links=new Map<TreeNode,string|null>();
  for(const patch of progress.nodes){
   let node=this.nodes.get(patch.path);
   if(!node){node={path:patch.path,name:patch.name,directory:patch.directory,size:patch.size,issue:patch.issue,modified:patch.modified,children:patch.directory?[]:emptyChildren,[parentLink]:undefined};this.nodes.set(node.path,node);links.set(node,patch.parent);}
   else {
    const parent=node[parentLink],parentPath=typeof parent==='string'?parent:parent?.path||null;
    if(parentPath!==patch.parent){this.detach(node,affected);links.set(node,patch.parent);}
    node.name=patch.name;node.size=patch.size;node.modified=patch.modified;node.issue=patch.issue;
    if(node.directory!==patch.directory){node.children=patch.directory?[]:emptyChildren;node.directory=patch.directory;}
   }
  }
  for(const parent of affected)parent.children=parent.children.filter(node=>(node as TreeNode)[parentLink]===parent);
  for(const [node,path] of links)this.attach(node,path);
  // A child can precede its parent in a native progress batch.
  for(const patch of progress.nodes){const parent=this.nodes.get(patch.path),children=this.waiting.get(patch.path);if(!parent?.directory||!children)continue;this.waiting.delete(patch.path);for(const node of children){node[parentLink]=parent;parent.children.push(node);}}
  this.root=this.nodes.get(progress.rootPath);
 }
 parentOf(node:DiskNode):DiskNode|undefined {const parent=(node as TreeNode)[parentLink];return typeof parent==='string'?this.nodes.get(parent):parent;}
 ancestors(node:DiskNode):DiskNode[]{const result:DiskNode[]=[];let parent=this.parentOf(node);while(parent){result.unshift(parent);parent=this.parentOf(parent);}return result;}
}
