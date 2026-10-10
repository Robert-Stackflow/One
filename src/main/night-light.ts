// Read-only Bond CompactBinary v1 decoding. CloudStore is not a stable Windows API.
// Reject malformed/unknown schemas instead of interpreting them as Night Light off.
type Field={type:number;value:Value};
type Value=boolean|bigint|{element:number;bytes:Uint8Array}|Map<number,Field>|null;
class CompactReader {
 private at=0;private fields=0;
 constructor(private data:Uint8Array){}
 private byte(){if(this.at>=this.data.length)throw Error('truncated');return this.data[this.at++];}
 private take(count:number){if(!Number.isSafeInteger(count)||count<0||count>this.data.length-this.at)throw Error('length');const value=this.data.subarray(this.at,this.at+count);this.at+=count;return value;}
 private integer(){let value=0n;for(let i=0;i<10;i++){const byte=this.byte();if(i===9&&byte>1)throw Error('integer');value|=BigInt(byte&127)<<BigInt(i*7);if(!(byte&128))return value;}throw Error('integer');}
 private count(){const count=this.integer();if(count>65536n)throw Error('count');return Number(count);}
 private value(type:number,depth:number):Value {
  if(depth>8||++this.fields>4096)throw Error('budget');
  if(type===2){const byte=this.byte();if(byte>1)throw Error('boolean');return !!byte;}
  if(type===3||type===14)return BigInt(this.byte());
  if([4,5,6,15,16,17].includes(type)){const value=this.integer(),bits=type===4||type===15?16:type===5||type===16?32:64;if(value>=1n<<BigInt(bits))throw Error('overflow');return value;}
  if(type===7||type===8){this.take(type===7?4:8);return null;}
  if(type===9||type===18){this.take(this.count()*(type===18?2:1));return null;}
  if(type===10)return this.struct(depth+1);
  if(type===11||type===12){
   const element=this.byte();if(element>18||element<2)throw Error('element');const count=this.count();
   if(element===14||element===3)return {element,bytes:this.take(count)};
   for(let i=0;i<count;i++)this.value(element,depth+1);return null;
  }
  if(type===13){const key=this.byte(),value=this.byte(),count=this.count();if(key<2||key>18||value<2||value>18)throw Error('map');for(let i=0;i<count;i++){this.value(key,depth+1);this.value(value,depth+1);}return null;}
  throw Error('type');
 }
 private struct(depth:number){
  if(depth>8)throw Error('depth');
  const fields=new Map<number,Field>();
  for(;;){const header=this.byte(),type=header&31;if(type===0){if(header!==0)throw Error('stop');return fields;}let id=header>>5;if(id===6)id=this.byte();else if(id===7)id=this.byte()|this.byte()<<8;if(fields.has(id))throw Error('duplicate');fields.set(id,{type,value:this.value(type,depth)});}
 }
 read(){
  if(this.byte()!==0x43||this.byte()!==0x42||this.byte()!==1||this.byte()!==0)throw Error('version');
  const value=this.struct(0);if(this.at!==this.data.length)throw Error('trailing');return value;
 }
}
export function parseNightLight(data:Uint8Array):{active?:boolean;detail:string} {
 if(data.length<4||data.length>65536)return {detail:'Windows 夜间模式数据大小不受支持'};
 try{
  const outer=new CompactReader(data).read(),metadata=outer.get(0)?.value,container=outer.get(1)?.value;
  if(!(metadata instanceof Map)||metadata.get(0)?.value!==true||!(container instanceof Map))throw Error('envelope');
  const wrapper=container.get(1)?.value;
  if(!(wrapper instanceof Map))throw Error('payload');
  const payload=wrapper.get(1),bytes=payload?.value;
  if(payload?.type!==11||!bytes||typeof bytes!=='object'||!('element' in bytes)||bytes.element!==14)throw Error('bytes');
  const inner=new CompactReader(bytes.bytes).read();
  if(inner.has(30)&&inner.get(30)?.type!==2)throw Error('usable');
  if(inner.get(30)?.value===false)return {detail:'此设备的 Windows 夜间模式不可用'};
  if(inner.has(0)&&(inner.get(0)?.type!==16||inner.get(0)?.value!==0n))throw Error('status');
  return {active:inner.has(0),detail:''};
 }catch{return {detail:'Windows 夜间模式尚未初始化，或当前数据格式不受支持'};}
}
