import type { Annotation, ImageDocument } from '../../shared/capture/image-document';
import { textOutline } from '../../shared/capture/text-outline';

/** One small readback per paint, independent of viewport zoom and export resolution. */
export function outlineBackground(target:CanvasRenderingContext2D,scene:ImageDocument,source?:CanvasImageSource,backdrop?:CanvasImageSource) {
  if(!scene.annotations.some(mark=>mark.textOutline&&['text','watermark'].includes(mark.tool))||(!source&&!backdrop))return undefined;
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,256/Math.max(scene.width,scene.height));
  canvas.width=Math.max(1,Math.round(scene.width*scale));canvas.height=Math.max(1,Math.round(scene.height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true})!;
  context.scale(canvas.width/scene.width,canvas.height/scene.height);
  if(backdrop)context.drawImage(backdrop,0,0,scene.width,scene.height);
  else {context.transform(...scene.transform);context.drawImage(source!,0,0);}
  const {data}=context.getImageData(0,0,canvas.width,canvas.height);
  const width=canvas.width,height=canvas.height;canvas.width=canvas.height=0;
  const viewport=target.getTransform().inverse();
  return (mark:Annotation,fontSize:number,x:number,y:number,metrics:TextMetrics) => {
    const samples:[number,number,number][]=[];
    const transform=viewport.multiply(target.getTransform());
    const textWidth=Math.max(fontSize/2,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight);
    const textHeight=Math.max(fontSize/2,metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent);
    for(let row=0;row<4;row++)for(let column=0;column<12;column++){
      const point=transform.transformPoint({x:x-metrics.actualBoundingBoxLeft+textWidth*(column+.5)/12,y:y-metrics.actualBoundingBoxAscent+textHeight*(row+.5)/4});
      const px=Math.floor(point.x/scene.width*width),py=Math.floor(point.y/scene.height*height);
      if(px<0||py<0||px>=width||py>=height)continue;
      const at=(py*width+px)*4;if(data[at+3]<128)continue;
      samples.push([data[at],data[at+1],data[at+2]]);
    }
    return textOutline(mark.color,fontSize,samples);
  };
}
