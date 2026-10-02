export interface SheetCell { column:number; value:string; formula?:string }
export interface SheetRow { number:number; cells:SheetCell[] }
export interface SheetData { name:string; rows:SheetRow[]; columns:number; truncated:boolean }
export interface WorkbookData { sheets:SheetData[] }
export function columnName(index:number){let value='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;}
