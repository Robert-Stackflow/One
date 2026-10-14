export interface DialogBarData {opened:string[];bookmarks:string[];recent:string[]}
export const dialogBarHeight=70;
export interface DialogBarRect {x:number;y:number;width:number;height:number}
export function dialogBarLayout(owner:DialogBarRect,area:DialogBarRect,rows=0,active=false){
 const width=Math.max(1,Math.min(800,owner.width-24,area.width-16)),base=Math.min(dialogBarHeight,area.height);
 const bottom=area.y+area.height,below=Math.max(0,bottom-(owner.y+owner.height)-4),above=Math.max(0,owner.y-area.y-4);
 // Choose the anchor from the owner alone: expanding results must never move
 // the input onto the file name field or the dialog's action buttons.
 const side=below<base+54&&above>=base&&above>below?'above':'below';
 const anchor=side==='above'?Math.max(area.y+base,Math.min(owner.y-4,bottom)):Math.max(area.y,Math.min(owner.y+owner.height+4,bottom-base));
 const count=Number.isFinite(rows)?Math.min(6,Math.max(0,Math.trunc(rows))):0,requested=count?count*58+10:active?54:0;
 const available=side==='above'?anchor-area.y-base:bottom-anchor-base;
 const height=base+Math.min(requested,Math.max(0,available)),y=side==='above'?anchor-height:anchor;
 return{side,bounds:{x:Math.round(Math.max(area.x,Math.min(owner.x+(owner.width-width)/2,area.x+area.width-width))),y:Math.round(y),width:Math.round(width),height:Math.round(height)}};
}
export function dialogBarBounds(owner:DialogBarRect,area:DialogBarRect,rows=0,active=false):DialogBarRect{return dialogBarLayout(owner,area,rows,active).bounds;}
