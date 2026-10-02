import type { DiskNode, ScanProgress } from './types';
export class ScanTree {
  readonly nodes = new Map<string, DiskNode>();
  readonly parents = new Map<string, string>();
  root?: DiskNode;
  apply(progress: ScanProgress) {
    for(const path of progress.removed||[]){const parent=this.nodes.get(this.parents.get(path)||'');if(parent)parent.children=parent.children.filter(n=>n.path!==path);this.nodes.delete(path);this.parents.delete(path);}
    const added = [];
    for (const patch of progress.nodes) {
      let node = this.nodes.get(patch.path);
      if (!node) { node = { ...patch, children: [] }; this.nodes.set(node.path, node); added.push(patch); }
      else Object.assign(node, patch);
    }
    for (const patch of added) {
      if (patch.parent) { this.nodes.get(patch.parent)?.children.push(this.nodes.get(patch.path)!); this.parents.set(patch.path, patch.parent); }
    }
    this.root = this.nodes.get(progress.rootPath);
  }
  ancestors(node: DiskNode): DiskNode[] {
    const result: DiskNode[] = [];
    let path = this.parents.get(node.path);
    while (path) { const parent = this.nodes.get(path); if (!parent) break; result.unshift(parent); path = this.parents.get(path); }
    return result;
  }
}
