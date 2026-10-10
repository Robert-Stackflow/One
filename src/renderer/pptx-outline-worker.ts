import {preparePptxOutline} from '../shared/pptx-outline';
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
 try{const result=await preparePptxOutline(event.data);self.postMessage(result,{transfer:[result.bytes]});}
 catch(error){self.postMessage({error:error instanceof Error?error.message:'演示文稿目录无法读取'});}
};
