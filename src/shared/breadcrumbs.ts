/** Keep the root and the current folder; fit the nearest ancestors first. */
export function breadcrumbIndices(widths:number[],available:number,ellipsisWidth:number){
 if(widths.length<3||widths.reduce((a,b)=>a+b,0)<=available)return widths.map((_,i)=>i);
 const last=widths.length-1,visible=[0,last];let used=widths[0]+widths[last]+ellipsisWidth;
 for(let i=last-1;i>0;i--){if(used+widths[i]>available)break;visible.splice(1,0,i);used+=widths[i];}
 return visible;
}
