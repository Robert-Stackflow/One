/** Sparse height changes keep long, mostly uniform lists compact. */
export class RowHeights {
 private changes=new Map<number,number>();private positions:number[]=[];private sums:number[]=[];private dirty=false;
 constructor(readonly base:number,public count=0){if(!Number.isFinite(base)||base<1)throw Error('行高度无效');this.reset(count);}
 reset(count:number){if(!Number.isSafeInteger(count)||count<0)throw Error('行数无效');this.count=count;this.changes.clear();this.positions=[];this.sums=[];this.dirty=false;}
 set(position:number,height:number){
  if(!Number.isSafeInteger(position)||position<0||position>=this.count||!Number.isFinite(height)||height<1)return false;
  if(Math.abs(this.size(position)-height)<.01)return false;
  if(Math.abs(height-this.base)<.01)this.changes.delete(position);else this.changes.set(position,height-this.base);this.dirty=true;return true;
 }
 size(position:number){return this.base+(this.changes.get(position)||0);}
 private index(position:number){
  if(this.dirty){this.positions=[...this.changes.keys()].sort((a,b)=>a-b);let sum=0;this.sums=this.positions.map(p=>sum+=this.changes.get(p)!);this.dirty=false;}
  let low=0,high=this.positions.length;while(low<high){const middle=(low+high)>>>1;if(this.positions[middle]<position)low=middle+1;else high=middle;}return low;
 }
 offset(position:number){position=Math.max(0,Math.min(this.count,position));const index=this.index(position);return position*this.base+(index?this.sums[index-1]:0);}
 get total(){return this.offset(this.count);}
 position(offset:number){
  if(!this.count||offset<=0)return 0;if(offset>=this.total)return this.count;
  let low=0,high=this.count;while(low<high){const middle=Math.ceil((low+high)/2);if(this.offset(middle)<=offset)low=middle;else high=middle-1;}return low;
 }
}
