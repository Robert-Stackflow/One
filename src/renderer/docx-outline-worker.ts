import {prepareDocxOutline} from '../shared/docx-outline';
self.onmessage=async(event:MessageEvent<ArrayBuffer>)=>{
 try{const result=await prepareDocxOutline(event.data);self.postMessage(result,{transfer:[result.bytes]});}
 catch(error){self.postMessage({error:error instanceof Error?error.message:'文档目录无法读取'});}
};
