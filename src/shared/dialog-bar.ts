export interface DialogBarData {opened:string[];bookmarks:string[];recent:string[]}
export const dialogBarHeight=70;
export interface DialogBarRect {x:number;y:number;width:number;height:number}
export function dialogBarBounds(owner:DialogBarRect,area:DialogBarRect,rows=0,active=false):DialogBarRect{
 const width=Math.max(1,Math.min(800,owner.width-24,area.width-16)),base=Math.min(dialogBarHeight,area.height);
 const barY=Math.max(area.y,Math.min(owner.y+owner.height-2,area.y+area.height-base-4));
 const count=Number.isFinite(rows)?Math.min(6,Math.max(0,Math.trunc(rows))):0,requested=count?count*58+10:active?54:0;
 const panel=Math.min(requested,Math.max(0,area.height-base-8)),height=base+panel,y=Math.max(area.y,Math.min(barY,area.y+area.height-height-4));
 return{x:Math.round(Math.max(area.x,Math.min(owner.x+(owner.width-width)/2,area.x+area.width-width))),y:Math.round(y),width:Math.round(width),height:Math.round(height)};
}
