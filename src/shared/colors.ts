export const colorFormatNames = {hex:'HEX',rgb:'RGB',hsl:'HSL',hsv:'HSV',cmyk:'CMYK',hsb:'HSB',hsi:'HSI',hwb:'HWB',ncol:'NCol',xyz:'CIEXYZ',lab:'CIELAB',oklab:'Oklab',oklch:'Oklch',vec4:'VEC4',decimal:'Decimal',hexInt:'HEX Int'} as const;
export type ColorFormat = keyof typeof colorFormatNames;
export interface ColorState {history:string[];formats:ColorFormat[];format:ColorFormat;showEditor:boolean;selected:string}
/** Opaque tints and shades of a sampled sRGB color, never inferred transparency. */
export function colorVariants(hex:string):{hex:string;label:string}[]{
  if(!/^#[\da-f]{6}$/i.test(hex))throw new Error('颜色格式无效');
  const rgb=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)),colors=new Map<string,string>();
  for(const amount of [.45,.25,.12,0,-.12,-.25,-.45]){
    const value='#'+rgb.map(n=>Math.round(amount>0?n+(255-n)*amount:n*(1+amount)).toString(16).padStart(2,'0')).join('').toUpperCase();
    colors.set(value,amount===0?'当前颜色':`${amount>0?'更亮':'更暗'} ${Math.round(Math.abs(amount)*100)}%`);
  }
  colors.set(hex.toUpperCase(),'当前颜色');return [...colors].map(([hex,label])=>({hex,label}));
}
const round=(n:number,d=2)=>Number(n.toFixed(d));
/** sRGB, D65 white point. CMYK is a mathematical conversion, not a printer profile. */
export function colorFormats(hex:string):Record<ColorFormat,string>{
  if(!/^#[\da-f]{6}$/i.test(hex))throw new Error('颜色格式无效');
  const [R,G,B]=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)),r=R/255,g=G/255,b=B/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,light=(max+min)/2;
  let hue=delta?(max===r?(g-b)/delta%6:max===g?(b-r)/delta+2:(r-g)/delta+4)*60:0;hue=(hue+360)%360;
  const sat=delta/(1-Math.abs(2*light-1))||0,sv=max?delta/max:0,k=1-max;
  const linear=(n:number)=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
  const [lr,lg,lb]=[r,g,b].map(linear);
  const X=.4124564*lr+.3575761*lg+.1804375*lb,Y=.2126729*lr+.7151522*lg+.0721750*lb,Z=.0193339*lr+.1191920*lg+.9503041*lb;
  const f=(n:number)=>n>216/24389?Math.cbrt(n):(24389/27*n+16)/116;
  const fx=f(X/.95047),fy=f(Y),fz=f(Z/1.08883);
  const ll=Math.cbrt(.4122214708*lr+.5363325363*lg+.0514459929*lb),mm=Math.cbrt(.2119034982*lr+.6806995451*lg+.1073969566*lb),ss=Math.cbrt(.0883024619*lr+.2817188376*lg+.6299787005*lb);
  const L=.2104542553*ll+.793617785*mm-.0040720468*ss,A=1.9779984951*ll-2.428592205*mm+.4505937099*ss,BB=.0259040371*ll+.7827717662*mm-.808675766*ss,C=Math.hypot(A,BB),H=C<1e-7?0:(Math.atan2(BB,A)*180/Math.PI+360)%360;
  const p=(n:number)=>round(n*100),h=round(hue),sum=r+g+b;
  const hsiDen=Math.sqrt((r-g)**2+(r-b)*(g-b));const theta=hsiDen?Math.acos(Math.max(-1,Math.min(1,(r-(g+b)/2)/hsiDen)))*180/Math.PI:0;
  return {hex:hex.toUpperCase(),rgb:`rgb(${R}, ${G}, ${B})`,hsl:`hsl(${h}, ${p(sat)}%, ${p(light)}%)`,hsv:`hsv(${h}, ${p(sv)}%, ${p(max)}%)`,cmyk:`cmyk(${p(max?(max-r)/max:0)}%, ${p(max?(max-g)/max:0)}%, ${p(max?(max-b)/max:0)}%, ${p(k)}%)`,hsb:`hsb(${h}, ${p(sv)}%, ${p(max)}%)`,hsi:`hsi(${round(b>g?360-theta:theta)}, ${p(sum?1-3*min/sum:0)}%, ${p(sum/3)}%)`,hwb:`hwb(${h} ${p(min)}% ${p(1-max)}%)`,ncol:`${['R','Y','G','C','B','M'][Math.floor(hue/60)]}${round(hue%60/60*100)}, ${p(min)}%, ${p(1-max)}%`,xyz:`XYZ(${round(X*100,4)}, ${round(Y*100,4)}, ${round(Z*100,4)})`,lab:`CIELab(${round(116*fy-16)}, ${round(500*(fx-fy))}, ${round(200*(fy-fz))})`,oklab:`oklab(${round(L,4)} ${round(A,4)} ${round(BB,4)})`,oklch:`oklch(${round(L,4)} ${round(C,4)} ${round(H)})`,vec4:`(${round(r,4)}f, ${round(g,4)}f, ${round(b,4)}f, 1f)`,decimal:String(R+G*256+B*65536),hexInt:'0xFF'+hex.slice(1).toUpperCase()};
}
