type RGB = readonly [number,number,number];
const clamp = (value:number) => Math.max(0,Math.min(1,value));
function luminance(rgb:RGB) {
  const linear=rgb.map(channel=>{const value=channel/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;});
  return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
}
export const maxTextOutlineWidth = (fontSize:number) => Math.max(2,fontSize/10);
/** Keep already-legible text subtle; strengthen only where it blends into the local image. */
export function textOutline(color:string,fontSize:number,background:readonly RGB[] = []) {
  const rgb = (/^#[0-9a-f]{6}$/i.test(color) ? color.slice(1).match(/../g)!.map(value=>parseInt(value,16)) : [0,0,0]) as [number,number,number];
  const foreground=luminance(rgb);
  if(!background.length)return {color:foreground>.4?'rgba(96,96,96,0.45)':'rgba(220,220,220,0.45)',width:Math.max(1,fontSize/24)};
  const levels=background.map(luminance).sort((a,b)=>a-b);
  const contrasts=levels.map(level=>(Math.max(level,foreground)+.05)/(Math.min(level,foreground)+.05)).sort((a,b)=>a-b);
  // The lower quartile catches mixed/photo backgrounds without reacting to a single noisy pixel.
  const contrast=contrasts[Math.floor((contrasts.length-1)*.25)];
  const need=clamp((4.5-contrast)/3.5);
  const average=background.reduce((sum,pixel)=>sum.map((value,i)=>value+pixel[i]) as [number,number,number],[0,0,0] as [number,number,number]).map(value=>value/background.length);
  const target=levels[Math.floor(levels.length/2)]>.35?24:240;
  const mix=.5+.3*need;
  const channels=average.map(value=>Math.round(value*(1-mix)+target*mix));
  return {
    color:`rgba(${channels.join(',')},${(.22+.58*need).toFixed(3)})`,
    width:Math.min(maxTextOutlineWidth(fontSize),Math.max(1,fontSize*(.025+.075*need))),
  };
}
