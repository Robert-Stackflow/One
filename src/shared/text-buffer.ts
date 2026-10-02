/** Only the current page is mounted in a textarea. Counts update in O(page size). */
export function newlineCount(text:string){let count=0;for(let i=0;i<text.length;i++){if(text.charCodeAt(i)===13){count++;if(text.charCodeAt(i+1)===10)i++;}else if(text.charCodeAt(i)===10)count++;}return count;}
export class TextBuffer {
 private chunks:string[]=[''];private breaks:number[]=[0];length=0;newlines=0;
 constructor(private pageSize=50000){this.pageSize=Math.max(2,Math.floor(pageSize)||50000);}
 set(text:string){this.chunks=[];this.breaks=[];this.length=text.length;this.newlines=0;for(let start=0;start<text.length;){let end=Math.min(text.length,start+this.pageSize);if(end<text.length&&(text.charCodeAt(end-1)===13&&text.charCodeAt(end)===10||text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff))end--;const part=text.slice(start,end),count=newlineCount(part);this.chunks.push(part);this.breaks.push(count);this.newlines+=count;start=end;}if(!this.chunks.length){this.chunks=[''];this.breaks=[0];}}
 get pages(){return this.chunks.length;}
 get lineCount(){return this.length?this.newlines+1:0;}
 page(index:number){return this.chunks[index]||'';}
 edit(index:number,value:string){const previous=this.page(index);const ending=previous.includes('\r\n')?'\r\n':previous.includes('\r')?'\r':'\n';const text=value.replace(/\r\n?|\n/g,ending);this.length+=text.length-previous.length;const count=newlineCount(text);this.newlines+=count-(this.breaks[index]||0);this.chunks[index]=text;this.breaks[index]=count;}
 text(){return this.chunks.join('');}
}
