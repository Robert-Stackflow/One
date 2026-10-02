/** A pushed update must win over an older initial IPC snapshot. */
export async function subscribeSnapshot<T>(subscribe:(listener:(value:T)=>void)=>unknown,read:()=>Promise<T>,apply:(value:T)=>void){
 let changed=false;
 subscribe(value=>{changed=true;apply(value);});
 const initial=await read();
 if(!changed)apply(initial);
}
