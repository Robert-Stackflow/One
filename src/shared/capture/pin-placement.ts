import type {Rectangle} from './region';
/** Include output shadow padding while keeping screenshot content at its original desktop pixels. */
export function capturePinBounds(physical:Rectangle|undefined,size:{width:number;height:number},selection:Rectangle,output:{width:number;height:number;x:number;y:number}):Rectangle|undefined{
 if(!physical)return;
 const x=physical.width/size.width,y=physical.height/size.height;
 return {x:Math.round(physical.x+(selection.x-output.x)*x),y:Math.round(physical.y+(selection.y-output.y)*y),width:Math.round(output.width*x),height:Math.round(output.height*y)};
}
