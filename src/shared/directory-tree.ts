import type {DirectoryInfo} from './directory';
export interface DirectoryBranch {node?:DirectoryNode;error?:string}
interface Span {index:number;branch:DirectoryBranch;start:number;end:number}
export interface DirectoryNode {info:DirectoryInfo;children:Map<number,DirectoryBranch>;parent?:DirectoryNode;parentIndex?:number;layout?:{spans:Span[];count:number}}
export interface DirectoryRow {node:DirectoryNode;index:number;depth:number;note?:string}
function layout(node:DirectoryNode){if(node.layout)return node.layout;let extra=0;const spans:Span[]=[];for(const [index,branch]of [...node.children].sort((a,b)=>a[0]-b[0])){const count=branch.node?directoryRowCount(branch.node):1,start=index+extra;extra+=count;spans.push({index,branch,start,end:start+1+count});}return node.layout={spans,count:Math.max(1,node.info.count)+extra};}
export const directoryRowCount=(node:DirectoryNode):number=>layout(node).count;
export function invalidateDirectory(node:DirectoryNode){for(let current:DirectoryNode|undefined=node;current;current=current.parent)current.layout=undefined;}
function previous<T>(items:T[],matches:(item:T)=>boolean):T|undefined {let left=0,right=items.length;while(left<right){const middle=(left+right)>>>1;if(matches(items[middle]))left=middle+1;else right=middle;}return items[left-1];}
export function directoryRowAt(node:DirectoryNode,position:number,depth=0):DirectoryRow {
 if(!node.info.count)return{node,index:-1,depth,note:'空文件夹'};const span=previous(layout(node).spans,span=>span.start<position);
 if(span&&position<span.end)return span.branch.node?directoryRowAt(span.branch.node,position-span.start-1,depth+1):{node,index:-1,depth:depth+1,note:span.branch.error||'正在读取…'};
 return{node,index:position-(span?span.end-span.index-1:0),depth};
}
export function directoryPositionOf(node:DirectoryNode,index:number):number {const span=previous(layout(node).spans,span=>span.index<index),position=index+(span?span.end-span.index-1:0);return node.parent?directoryPositionOf(node.parent,node.parentIndex!)+1+position:position;}
