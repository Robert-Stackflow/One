import {transformURL,type URLCodecScope,type URLCodecAction} from '../shared/url-codec';
self.onmessage=(event:MessageEvent<{id:number;text:string;scope:URLCodecScope;action:URLCodecAction}>)=>{
 const {id,text,scope,action}=event.data;
 try{self.postMessage({id,result:transformURL(text,scope,action)});}catch(error){self.postMessage({id,error:(error as Error).message});}
};
