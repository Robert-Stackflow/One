import {DeveloperDataError,transformDeveloperData,type DeveloperDataRequest} from '../shared/developer-data';

self.onmessage=(event:MessageEvent<{id:number;request:DeveloperDataRequest}>)=>{
 const {id,request}=event.data;
 try{self.postMessage({id,result:transformDeveloperData(request)});}
 catch(error){const issue=error instanceof DeveloperDataError?error:new DeveloperDataError((error as Error).message);self.postMessage({id,error:{message:issue.message,line:issue.line,column:issue.column}});}
};
