const collator=new Intl.Collator('zh-CN',{numeric:true});

/** Reuse the locale rules while sorting large file lists. */
export const compareNatural=(left:string,right:string)=>collator.compare(left,right);
