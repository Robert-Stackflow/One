import {runRegex,type RegexRequest} from '../shared/regex-tool';
self.onmessage=(event:MessageEvent<{id:number;request:RegexRequest}>)=>{const {id,request}=event.data;try{self.postMessage({id,result:runRegex(request)});}catch(error){self.postMessage({id,error:(error as Error).message});}};
