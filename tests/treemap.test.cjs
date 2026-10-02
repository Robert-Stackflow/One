const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
let TreemapLayout,layout;
before(async()=>{const output=path.resolve(process.env.ONE_UNIT_OUTPUT_DIR||'work/unit','treemap');await fs.mkdir(output,{recursive:true});await require('esbuild').build({entryPoints:['src/shared/treemap.ts'],outfile:path.join(output,'map.cjs'),bundle:true,platform:'node'});({TreemapLayout,layout}=require(path.join(output,'map.cjs')));});
const node=(name,size)=>({name,path:'root/'+name,size,directory:false,children:[]});
test('compressed strips retain every item, exact area and lookup beyond the former map cap',()=>{
 const nodes=Array.from({length:30003},(_,i)=>node(String(i).padStart(6,'0'),i%97+1)),original=nodes.slice(),map=new TreemapLayout(nodes,3,7,913,607);let count=0,area=0,total=nodes.reduce((s,n)=>s+n.size,0);
 map.forEach((node,x,y,width,height)=>{count++;area+=width*height;assert.ok(x>=3&&y>=7&&x+width<=916.000001&&y+height<=614.000001);assert.ok(Math.abs(width*height/(913*607)-node.size/total)<1e-9);assert.equal(map.hit(x+width/2,y+height/2)?.node,node);});
 assert.equal(count,nodes.length);assert.ok(Math.abs(area-913*607)<1e-5);assert.deepEqual(nodes,original);assert.equal(map.find(nodes.at(-1))?.node,nodes.at(-1));assert.equal(map.find({...nodes.at(-1)})?.node,nodes.at(-1));
});
test('strip binary search agrees with geometric containment across mixed orientations and seams',()=>{
 const nodes=Array.from({length:137},(_,i)=>node(String(i),(i*37%101+1)**2));
 for(const [width,height]of[[950,700],[120,1900],[1900,120]]){
  const map=new TreemapLayout(nodes,-100,5,width,height),tiles=layout(nodes,-100,5,width,height);
  for(let i=0;i<1000;i++){
   const x=-100+(i*271%997)/997*width,y=5+(i*193%991)/991*height,expected=tiles.find(t=>x>=t.x&&y>=t.y&&x<t.x+t.width&&y<t.y+t.height);
   assert.equal(map.hit(x,y)?.node,expected?.node,'point '+x+','+y);
  }
  for(const tile of tiles)for(const [dx,dy]of[[.00001,.00001],[.99999,.99999]])assert.equal(map.hit(tile.x+tile.width*dx,tile.y+tile.height*dy)?.node,tile.node);
  assert.equal(map.hit(-101,5),undefined);assert.equal(map.hit(-100+width,5),undefined);assert.equal(map.hit(-100,5+height),undefined);assert.equal(map.hit(NaN,0),undefined);
 }
});
test('layout ignores invalid sizes and dimensions, while huge finite sizes remain proportional',()=>{
 const nodes=[node('zero',0),node('negative',-1),node('infinite',Infinity),node('NaN',NaN),node('small',1e307),node('large',1e308)];
 const tiles=layout(nodes,0,0,100,100);assert.equal(tiles.length,2);assert.ok(Math.abs(tiles[0].width*tiles[0].height/10000-10/11)<1e-9);assert.equal(new TreemapLayout(nodes,0,0,0,100).hit(0,0),undefined);assert.deepEqual(layout(nodes,0,0,NaN,100),[]);assert.deepEqual(layout(nodes,0,0,100,-1),[]);
});
