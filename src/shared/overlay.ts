export interface OverlayRect {x:number;y:number;width:number;height:number}
export interface OverlayDisplay {bounds:OverlayRect;workArea:OverlayRect;scaleFactor:number}
export interface OverlaySides {left:boolean;above:boolean}
// Keep the CSS border inside the transparent window's physical clip at fractional DPI.
export const inlineSearchInset=2;
export const inlineSearchBaseHeight=44+2+inlineSearchInset*2;
export function inlineSearchHeight(rows:number,active=false){
 const count=Number.isFinite(rows)?Math.min(8,Math.max(0,Math.trunc(rows))):0;
 return inlineSearchBaseHeight+(count?count*42+8:active?40:0);
}
/** Input and output are physical pixels. Window dimensions always start in DIP. */
export function loupeBounds(point:{x:number;y:number},display:OverlayDisplay,sides?:OverlaySides,actualSize?:{width:number;height:number}){
 const a=display.workArea,scale=display.scaleFactor,width=Math.min(a.width,actualSize?.width??Math.round(216*scale)),height=Math.min(a.height,actualSize?.height??Math.round(276*scale)),gap=Math.round(24*scale),hysteresis=Math.round(16*scale);
 const right=point.x+gap+width<=a.x+a.width,below=point.y+gap+height<=a.y+a.height;
 const left=sides?.left?point.x+gap+width>a.x+a.width-hysteresis:!right,above=sides?.above?point.y+gap+height>a.y+a.height-hysteresis:!below;
 return {x:Math.round(Math.max(a.x,Math.min(a.x+a.width-width,point.x+(left?-width-gap:gap)))),y:Math.round(Math.max(a.y,Math.min(a.y+a.height-height,point.y+(above?-height-gap:gap)))),width,height,left,above};
}
export function overlayDisplay(point:{x:number;y:number},displays:OverlayDisplay[]){
 let best=displays[0],distance=Infinity;
 for(const d of displays){const a=d.bounds,dx=Math.max(a.x-point.x,0,point.x-(a.x+a.width-1)),dy=Math.max(a.y-point.y,0,point.y-(a.y+a.height-1)),value=dx*dx+dy*dy;if(value<distance){distance=value;best=d;}}
 return best;
}
