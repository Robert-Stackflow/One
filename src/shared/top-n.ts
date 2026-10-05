/** Return the first `limit` values in sort order without sorting the full input. */
export function topN<T>(values:Iterable<T>,limit:number,compare:(left:T,right:T)=>number):T[]{
 if(limit<=0)return [];
 type Ranked={value:T;index:number};
 const heap:Ranked[]=[];
 const order=(left:Ranked,right:Ranked)=>compare(left.value,right.value)||left.index-right.index;
 const swap=(left:number,right:number)=>{[heap[left],heap[right]]=[heap[right],heap[left]];};
 let index=0;
 for(const value of values){
  const ranked={value,index:index++};
  if(heap.length<limit){
   heap.push(ranked);
   for(let child=heap.length-1;child>0;){const parent=(child-1)>>1;if(order(heap[parent],heap[child])>=0)break;swap(parent,child);child=parent;}
  }else if(order(ranked,heap[0])<0){
   heap[0]=ranked;
   for(let parent=0;;){const left=parent*2+1;if(left>=heap.length)break;const right=left+1,child=right<heap.length&&order(heap[right],heap[left])>0?right:left;if(order(heap[parent],heap[child])>=0)break;swap(parent,child);parent=child;}
  }
 }
 return heap.sort(order).map(item=>item.value);
}
