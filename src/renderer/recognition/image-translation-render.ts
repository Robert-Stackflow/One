import {imageTextLayout,type ImageTranslationDocument} from '../../shared/recognition/image-translation';
import {repairTranslationBackground} from '../../shared/recognition/image-translation-background';

/** Pure composition shared by OCR previews and editable image projects; source pixels stay immutable. */
export async function renderImageTranslation(value:ImageTranslationDocument,source:ImageData,valid:()=>boolean){
  const canvas=document.createElement('canvas');canvas.width=value.width;canvas.height=value.height;const context=canvas.getContext('2d')!;
  const output=new ImageData(new Uint8ClampedArray(source.data),source.width,source.height),backgrounds=new Map<string,ReturnType<typeof repairTranslationBackground>>();
  const overflow=new Set<string>(),plates=new Set<string>();
  try{
    for(let index=0;index<value.blocks.length;index++){
      const block=value.blocks[index];if(block.status==='ready'){const background=repairTranslationBackground(source,output,block);backgrounds.set(block.id,background);if(background.kind==='plate')plates.add(block.id);}
      if(index%8===0){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(!valid())throw Error('图片翻译已取消');}
    }
    context.putImageData(output,0,0);
    for(const background of backgrounds.values())if(background.kind==='plate'){const rect=background.sourceRect;context.fillStyle=background.color;context.fillRect(rect.x,rect.y,rect.width,rect.height);}
    for(const block of value.blocks){
      const background=backgrounds.get(block.id);if(!background)continue;
      const layout=imageTextLayout(block,(text,size)=>{context.font=`${size}px system-ui`;return context.measureText(text).width;});
      if(layout.overflow)overflow.add(block.id);
      const {x,y,width,height}=block.rect;context.save();context.beginPath();context.rect(x,y,width,height);context.clip();
      if(background.kind==='plate'){context.fillStyle=background.color;context.fillRect(x,y,width,height);}
      context.font=`${layout.fontSize}px system-ui`;context.fillStyle=background.textColor;context.textBaseline='top';context.direction=value.target==='ar'?'rtl':'ltr';context.textAlign=value.target==='ar'?'right':'left';
      layout.lines.forEach((line,index)=>context.fillText(line,value.target==='ar'?x+width-2:x+2,y+2+index*layout.lineHeight));context.restore();
    }
    if(!valid())throw Error('图片翻译已取消');return {canvas,overflow,plates};
  }catch(error){canvas.width=canvas.height=0;throw error;}
}
