import {Text,type ChangeSet} from '@codemirror/state';

/** One character per line ending, independent of CodeMirror's normalized document. */
export interface LineEndings {codes:string;preferred:string;extra:number}
export interface ParsedText {doc:Text;endings:LineEndings}
const extra=(codes:string)=>{let n=0;for(let i=0;i<codes.length;i++)if(codes.charCodeAt(i)===50)n++;return n;};
export function endingsOf(text:string):LineEndings {
 const codes:string[]=[];for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c===13){if(text.charCodeAt(i+1)===10){codes.push('2');i++;}else codes.push('3');}else if(c===10)codes.push('1');}
 const value=codes.join('');return {codes:value,preferred:value[0]||'1',extra:extra(value)};
}
export function editEndings(before:LineEndings,doc:Text,changes:ChangeSet,inserted?:LineEndings):LineEndings {
 let changed=false;changes.iterChanges((from,to,_a,_b,text)=>{if(text.lines>1||doc.lineAt(from).number!==doc.lineAt(to).number)changed=true;});if(!changed)return before;
 const parts:string[]=[];let at=0;
 changes.iterChanges((from,to,_newFrom,_newTo,text)=>{const first=doc.lineAt(from).number-1,last=doc.lineAt(to).number-1;parts.push(before.codes.slice(at,first),inserted?.codes??before.preferred.repeat(text.lines-1));at=last;});
 parts.push(before.codes.slice(at));const codes=parts.join('');return {codes,preferred:before.codes.length?before.preferred:inserted?.preferred||before.preferred,extra:extra(codes)};
}
export const yieldText=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
/** Bounded chunks let navigation and cancellation run while constructing the persistent rope. */
export async function parseText(text:string,cancelled:()=>boolean=()=>false):Promise<ParsedText|undefined> {
 let doc=Text.empty;const codes:string[]=[];let additional=0;
 for(let at=0;at<text.length;){
  if(cancelled())return;let end=Math.min(text.length,at+65536);
  if(end<text.length&&(text.charCodeAt(end-1)===13||text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff))end--;
  const piece=text.slice(at,end),endings=endingsOf(piece);codes.push(endings.codes);additional+=endings.extra;doc=doc.append(Text.of(piece.split(/\r\n|\r|\n/)));at=end;
  if(text.length>200000)await yieldText();
 }
 const all=codes.join('');return {doc,endings:{codes:all,preferred:all[0]||'1',extra:additional}};
}
export function serializeText(doc:Text,endings:LineEndings){
 const parts:string[]=[];let n=0;for(const line of doc.iterLines()){parts.push(line);if(n<endings.codes.length)parts.push(endings.codes[n]==='2'?'\r\n':endings.codes[n]==='3'?'\r':'\n');n++;}return parts.join('');
}
export async function serializeTextAsync(doc:Text,endings:LineEndings){
 const blocks:string[]=[],parts:string[]=[];let n=0,last=performance.now();
 for(const line of doc.iterLines()){
  parts.push(line);if(n<endings.codes.length)parts.push(endings.codes[n]==='2'?'\r\n':endings.codes[n]==='3'?'\r':'\n');n++;
  if(n%2048===0){blocks.push(parts.join(''));parts.length=0;if(performance.now()-last>8){await yieldText();last=performance.now();}}
 }
 blocks.push(parts.join(''));return blocks.join('');
}
