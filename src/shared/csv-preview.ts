export interface TableShape {rows:number;columns:number}
export interface TableCell {row:number;column:number;text:string;truncated:boolean}
export interface TableRange {row:number;column:number;rows:number;columns:number;cells:TableCell[]}
class Offsets {
 private data=new Uint32Array(4096);length=0;
 add(value:number){if(this.length===this.data.length){const larger=new Uint32Array(this.data.length*2);larger.set(this.data);this.data=larger;}this.data[this.length++]=value;}
 get(index:number){return this.data[index];}
}
/** Delimiter offsets retain the full table without constructing a string for every cell. */
export class CsvStore {
 private ends=new Offsets();private records=new Offsets();readonly shape:TableShape;
 constructor(private text:string,private delimiter:string){
  if(delimiter!==','&&delimiter!=='\t')throw new Error('表格分隔符无效');
  this.records.add(0);let quoted=false,closed=false,start=0,columns=0;
  const finish=(end:number,record:boolean)=>{this.ends.add(end);if(record){columns=Math.max(columns,this.ends.length-this.records.get(this.records.length-1));this.records.add(this.ends.length);}closed=false;};
  for(let index=0;index<text.length;index++){
   const c=text[index];
   if(quoted){if(c==='"'){if(text[index+1]==='"')index++;else{quoted=false;closed=true;}}continue;}
   if(c==='"'&&index===start&&!closed){quoted=true;continue;}
   if(c===delimiter){finish(index,false);start=index+1;}
   else if(c==='\r'||c==='\n'){finish(index,true);if(c==='\r'&&text[index+1]==='\n')index++;start=index+1;}
   else if(closed&&c!==' '&&c!=='\t')throw new Error('引号后的内容无效，请查看源码');
  }
  if(quoted)throw new Error('字段引号未闭合，请查看源码');
  if(start<text.length||this.ends.length>this.records.get(this.records.length-1))finish(text.length,true);
  this.shape={rows:this.records.length-1,columns};
 }
 cell(row:number,column:number){
  if(!Number.isSafeInteger(row)||row<0||row>=this.shape.rows||!Number.isSafeInteger(column)||column<0||column>=this.shape.columns)throw new Error('单元格位置无效');
  const index=this.records.get(row)+column;if(index>=this.records.get(row+1))return '';
  const previous=index?this.ends.get(index-1):-1,start=previous<0?0:previous+1+(this.text[previous]==='\r'&&this.text[previous+1]==='\n'?1:0),end=this.ends.get(index);let value=this.text.slice(start,end);
  if(value.startsWith('"')){value=value.slice(1).replace(/"[ \t]*$/,'').replace(/""/g,'"');}return value;
 }
 range(row:number,column:number,rows:number,columns:number):TableRange {
  if(!Number.isSafeInteger(row)||row<0||row>=this.shape.rows||!Number.isSafeInteger(column)||column<0||column>=this.shape.columns||!Number.isSafeInteger(rows)||rows<1||rows>64||!Number.isSafeInteger(columns)||columns<1||columns>32)throw new Error('表格范围无效');
  const height=Math.min(rows,this.shape.rows-row),width=Math.min(columns,this.shape.columns-column),cells:TableCell[]=[];
  for(let r=row;r<row+height;r++)for(let c=column;c<column+width;c++){const value=this.cell(r,c);cells.push({row:r,column:c,text:value.slice(0,240),truncated:value.length>240});}
  return{row,column,rows:height,columns:width,cells};
 }
}
