/** Shared transport for chat and explicit feature requests; it owns no conversation/history. */
export const serviceRequest:typeof fetch=(input,options)=>fetch(input,{...options,redirect:'error',credentials:'omit'});
