import {imageTextLayoutAsync,imageTranslationFrame,type ImageTranslationDocument} from '../../shared/recognition/image-translation';
import {repairTranslationBackground} from '../../shared/recognition/image-translation-background';

/** Pure composition shared by OCR previews and editable image projects; source pixels stay immutable. */
export async function renderImageTranslation(value:ImageTranslationDocument,source:ImageData,valid:()=>boolean){
  const canvas=document.createElement('canvas');canvas.width=value.width;canvas.height=value.height;const context=canvas.getContext('2d')!;
  const output=new ImageData(new Uint8ClampedArray(source.data),source.width,source.height),backgrounds=new Map<string,ReturnType<typeof repairTranslationBackground>>();
  const overflow=new Set<string>(),plates=new Set<string>();
  let sliceStart=performance.now();
  const yieldControl=async(force=false)=>{if(force||performance.now()-sliceStart>=8){await new Promise<void>(resolve=>setTimeout(resolve,0));sliceStart=performance.now();}if(!valid())throw Error('图片翻译已取消');};
  try{
    for(let index=0;index<value.blocks.length;index++){
      const block=value.blocks[index];if(block.status==='ready'){const background=repairTranslationBackground(source,output,block);backgrounds.set(block.id,background);if(background.kind==='plate')plates.add(block.id);}
      if(index%8===0)await yieldControl(true);
    }
    context.putImageData(output,0,0);
    for(const background of backgrounds.values())if(background.kind==='plate'){const rect=background.sourceRect;context.fillStyle=background.color;context.fillRect(rect.x,rect.y,rect.width,rect.height);}
    for(const block of value.blocks){
      const background=backgrounds.get(block.id);if(!background)continue;
      let measuredSize=0;
      const layout=await imageTextLayoutAsync(block,(text,size)=>{if(measuredSize!==size){context.font=`${size}px system-ui`;measuredSize=size;}return context.measureText(text).width;},{valid,yieldControl});
      if(layout.overflow)overflow.add(block.id);
      const {x,y,width,height}=block.rect;context.save();context.beginPath();context.rect(x,y,width,height);context.clip();
      if(background.kind==='plate'){context.fillStyle=background.color;context.fillRect(x,y,width,height);}
      const frame=imageTranslationFrame(block);
      context.translate(x+(frame.rotation===90||frame.rotation===180?width:0),y+(frame.rotation===180||frame.rotation===270?height:0));
      context.rotate(frame.rotation*Math.PI/180);
      context.font=`${layout.fontSize}px system-ui`;context.fillStyle=background.textColor;context.textBaseline='top';context.direction=value.target==='ar'?'rtl':'ltr';context.textAlign=value.target==='ar'?'right':'left';
      const visibleLines=Math.ceil(Math.max(0,frame.height-2)/layout.lineHeight);
      layout.lines.slice(0,visibleLines).forEach((line,index)=>context.fillText(line,value.target==='ar'?frame.width-2:2,2+index*layout.lineHeight));context.restore();
      await yieldControl();
    }
    if(!valid())throw Error('图片翻译已取消');return {canvas,overflow,plates};
  }catch(error){canvas.width=canvas.height=0;throw error;}
}
