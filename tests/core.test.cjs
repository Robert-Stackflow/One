const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
let core; let fixture;
test('附着搜索高度包含透明安全边距、完整边框、输入栏和受限结果列表',()=>{
 assert.equal(core.inlineSearchInset,2);assert.equal(core.inlineSearchHeight(0),50);
 assert.equal(core.inlineSearchHeight(0,true),90);assert.equal(core.inlineSearchHeight(2,true),142);
 assert.equal(core.inlineSearchHeight(8,true),394);assert.equal(core.inlineSearchHeight(100,true),394);
 assert.equal(core.inlineSearchHeight(-1),50);assert.equal(core.inlineSearchHeight(NaN),50);
});
test('取色浮窗始终使用固定尺寸；适配负坐标和混合缩放，不积累取整误差',()=>{
 const displays=[{bounds:{x:-1920,y:0,width:1920,height:1080},workArea:{x:-1920,y:0,width:1920,height:1040},scaleFactor:1},{bounds:{x:0,y:0,width:2560,height:1440},workArea:{x:0,y:0,width:2560,height:1400},scaleFactor:1.25}];
 let sides;for(let i=0;i<5000;i++){const point={x:-1900+i%4400,y:i%1400},display=core.overlayDisplay(point,displays),b=core.loupeBounds(point,display,sides);assert.equal(b.width,Math.round(216*display.scaleFactor));assert.equal(b.height,Math.round(276*display.scaleFactor));assert.ok(b.x>=display.workArea.x&&b.x+b.width<=display.workArea.x+display.workArea.width);assert.ok(b.y>=display.workArea.y&&b.y+b.height<=display.workArea.y+display.workArea.height);sides=b;}
 const d=displays[1],p={x:2260,y:500};assert.equal(core.loupeBounds(p,d).left,false);assert.equal(core.loupeBounds(p,d,{left:true,above:false}).left,true);assert.equal(core.loupeBounds({x:2230,y:500},d,{left:true,above:false}).left,false);
});
test('提示浮窗按类型呈现音量、锁定动画和组合键，不依赖重复入场',()=>{
 assert.deepEqual(core.hudContent('音量 34%','level'),{kind:'level',action:'volume',value:34});assert.equal(core.hudContent('亮度 110%').value,100);
 assert.deepEqual(core.hudContent('Caps Lock · 关闭','caps'),{kind:'lock',label:'Caps Lock',enabled:false});assert.deepEqual(core.hudContent('Ctrl + Shift + ArrowUp','keys'),{kind:'keys',keys:['Ctrl','Shift','↑']});assert.deepEqual(core.hudContent('中 · 中文输入法','ime'),{kind:'ime',mode:'中',language:'中文输入法'});
});
test('提示位置保存与旧外观设置迁移；无效位置被拒绝',()=>{
 const s=core.defaultSettings();assert.equal(s.appearance.toastPosition,'bottom-center');for(const position of ['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right']){s.appearance.toastPosition=position;assert.equal(core.validateSettings(s).appearance.toastPosition,position);}
 delete s.appearance.toastPosition;assert.equal(core.validateSettings(s).appearance.toastPosition,'bottom-center');s.appearance.toastPosition='nowhere';assert.throws(()=>core.validateSettings(s),/提示位置/);
});
test('面包屑保留根和当前目录，优先显示最近的祖先',()=>{
 assert.deepEqual(core.breadcrumbIndices([50,80,80,80,100],240,32),[0,4]);assert.deepEqual(core.breadcrumbIndices([50,80,80,80,100],270,32),[0,3,4]);assert.deepEqual(core.breadcrumbIndices([50,80,80,80,100],400,32),[0,1,2,3,4]);assert.deepEqual(core.breadcrumbIndices([50,100],50,32),[0,1]);
});
test('所有按键与状态提示共用位置；迁移保留独立开关与时长',()=>{
 const saved=core.defaultSettings();
 saved.echo.keys={...saved.echo.keys,x:.2,y:.75,display:'2'};
 saved.echo.ime={...saved.echo.ime,x:.8,y:.5,display:'3',enabled:true,duration:2400};
 const next=core.validateSettings(saved);
 for(const hint of Object.values(next.echo)){assert.equal(hint.x,.2);assert.equal(hint.y,.75);assert.equal(hint.display,'2');}
 assert.equal(next.echo.ime.enabled,true);assert.equal(next.echo.ime.duration,2400);
 assert.equal(next.echo.caps.enabled,false);assert.equal(saved.echo.ime.x,.8);
 next.echo.keys.x=1.01;assert.throws(()=>core.validateSettings(next),/位置/);
});
test('大文本分页不拆分 CRLF 或代理字符；局部编辑不丢后续页',()=>{
 const b=new core.TextBuffer(5);const text='甲乙\r\n😀中文\r\n第三行';b.set(text);assert.equal(b.text(),text);assert.equal(b.lineCount,3);for(let i=0;i<b.pages-1;i++)assert.ok(!/\r$|[\uD800-\uDBFF]$/.test(b.page(i)));const tail=b.page(1);b.edit(0,'新行\n');assert.equal(b.page(1),tail);assert.equal(b.text().startsWith('新行\r\n'),true);assert.equal(b.length,b.text().length);assert.equal(b.newlines,core.newlineCount(b.text()));
});
test('中文段落整理、标点和括号检查',()=>{
 assert.equal(core.transform({operation:'joinParagraph',text:'　第一段\n后半句\n\n　第二段'}),'　第一段后半句\r\n\r\n　第二段');
 assert.equal(core.transform({operation:'layout',text:' 第一行  \n\n第二行'}),'　　第一行\r\n　　第二行');
 assert.equal(core.transform({operation:'punctuation',text:'你好, "世界"! 12:30'}),'你好， “世界”！ 12:30');
 assert.equal(core.transform({operation:'natural',text:'第10行\n第2行\n第1行'}),'第1行\r\n第2行\r\n第10行');
 assert.throws(()=>core.transform({operation:'brackets',text:'甲（乙]'}),/未配对/);assert.equal(core.transform({operation:'brackets',text:'甲（乙）'}),'甲（乙）');
 assert.throws(()=>core.validateSteps([{operation:'wrap',width:0}]));
});
test('文件搜索支持路径、空格短语和类型，默认集成关闭',()=>{
 const item={path:'D:\\报告\\季度 报告.pdf',name:'季度 报告.pdf',directory:false,size:100,modified:0};
 assert.ok(core.searchMatcher('doc: "季度 报告"')(item)>0);assert.ok(core.searchMatcher('D:/报告')(item)>0);assert.equal(core.searchMatcher('folder:')(item),-1);assert.equal(core.searchMatcher('ext:txt')(item),-1);assert.equal(core.defaultSearch().explorerTyping,false);assert.throws(()=>core.validateSearch({...core.defaultSearch(),roots:['relative/path']}));
});
test('唤醒按绝对时间到期，锁屏暂停，旧配置安全迁移',()=>{
  const defaults=core.defaultUtilities();assert.equal(defaults.awake.mode,'off');
  const timed={mode:'timed',display:true,expiresAt:2000};
  assert.deepEqual(core.awakeEffective(timed,false,1000),{active:true,expired:false,remaining:1000});
  assert.equal(core.awakeEffective(timed,true,1000).active,false);
  assert.equal(core.awakeEffective(timed,false,2000).expired,true);
  assert.deepEqual(core.validateUtilities(undefined),defaults);
  assert.throws(()=>core.validateUtilities({...defaults,awake:{...timed,expiresAt:0}}));
});
before(async () => {
  await fs.mkdir('work/tests', { recursive: true });
  await build({ entryPoints: ['tests/runtime.ts'], outfile: 'work/tests/runtime.cjs', bundle: true, platform: 'node', external: ['opencc-js','iconv-lite'] });
  core = require('../work/tests/runtime.cjs'); fixture = await fs.mkdtemp(path.resolve('work/tests/sample-'));
});
test('整理混合换行与空白，去重保持第一行顺序', () => {
  assert.equal(core.transform({ operation:'clean', text:' 甲 \r\n\n 乙\r 丙 ' }), '甲\r\n乙\r\n丙');
  assert.equal(core.transform({ operation:'unique', text:'乙\n甲\n乙\n' }), '乙\r\n甲\r\n');
});
test('普通替换保留特殊符号；正则支持分组并报告错误', () => {
  assert.equal(core.transform({ operation:'replace', text:'a.b a?b a.b', pattern:'a.b', replacement:'$&' }), '$& a?b $&');
  assert.equal(core.transform({ operation:'replace', text:'a12 b34', pattern:'([a-z])(\\d+)', replacement:'$2-$1', regex:true }), '12-a 34-b');
  assert.throws(() => core.transform({ operation:'replace', text:'x', pattern:'[', regex:true }));
  assert.throws(() => core.transform({ operation:'replace', text:'x', pattern:'' }));
});
test('简繁转换使用词组；全角和半角转换', () => {
  assert.equal(core.transform({ operation:'simple', text:'臺灣軟體' }), '台湾软件');
  assert.equal(core.transform({ operation:'traditional', text:'台湾软件' }), '臺灣軟體');
  assert.equal(core.transform({ operation:'half', text:'ＡＢＣ　１２３！' }), 'ABC 123!');
  assert.equal(core.transform({ operation:'full', text:'ABC 123!' }), 'ＡＢＣ　１２３！');
});
test('角落停留不足不触发，持续停留只触发一次，离开后冷却', () => {
  const trigger = new core.CornerTrigger();
  assert.equal(trigger.update('TL',0,650,1200),null); assert.equal(trigger.update('TL',649,650,1200),null);
  assert.equal(trigger.update('TL',650,650,1200),'TL'); assert.equal(trigger.update('TL',5000,650,1200),null);
  trigger.update(null,5001,650,1200); trigger.update('TR',5100,650,1200); assert.equal(trigger.update('TR',5750,650,1200),'TR');
});
test('滚轮抑制当前角落动作；进入其他角落仍须完整停留', () => {
  const trigger = new core.CornerTrigger(); trigger.update('TL',0,650,1200); trigger.suppress();
  assert.equal(trigger.update('TL',1000,650,1200),null); assert.equal(trigger.update('TR',1100,650,1200),null);
  assert.equal(trigger.update('TR',1750,650,1200),'TR');
});
test('设置校验拒绝越界参数和任意角落命令', () => {
  const defaults = core.defaultSettings(); assert.equal(defaults.copyMenu,false); assert.deepEqual(core.validateSettings(defaults),defaults);
  assert.throws(() => core.validateSettings({ ...defaults, dwellMs:0 })); assert.throws(() => core.validateSettings({ ...defaults, corners:{ ...defaults.corners,TL:'run.exe' } }));
  assert.throws(() => core.validateSettings({ ...defaults, keyEcho:'true' }));
});

test('0.2 设置迁移补齐外观与取色，热角命令参数保留为独立数组',()=>{
  const old=core.defaultSettings();delete old.appearance;delete old.cornerBindings;delete old.colorShortcut;delete old.colorHistory;
  const settings=core.validateSettings(old);assert.equal(settings.appearance.lightBackground,'#ffffff');assert.equal(settings.appearance.darkBackground,'#181818');assert.equal(settings.colorShortcut,'Control+Alt+C');
  settings.corners.TL='command';settings.cornerBindings.TL={command:'program.exe',args:['a b','$(not shell)','& not shell'],cwd:'',shortcut:''};assert.deepEqual(core.validateSettings(settings).cornerBindings.TL.args,settings.cornerBindings.TL.args);
  assert.throws(()=>core.validateSettings({...settings,cornerBindings:{...settings.cornerBindings,TL:{...settings.cornerBindings.TL,args:'unparsed command'}}}),/参数/);
  assert.throws(()=>core.validateSettings({...settings,appearance:{...settings.appearance,accent:'url(example)'}}),/颜色/);
  settings.corners.TR='hotkey';settings.cornerBindings.TR.shortcut='Ctrl+Shift+S';assert.equal(core.validateSettings(settings).corners.TR,'hotkey');settings.cornerBindings.TR.shortcut='eval(process)';assert.throws(()=>core.validateSettings(settings),/快捷键/);
});
test('矩形面积按大小分配，不丢失项目且边界不越界', () => {
  const nodes = [10,30,60].map((n,i) => ({ name:String(i),path:String(i),directory:false,children:[],size:n }));
  const tiles = core.layout(nodes,0,0,1000,300); assert.equal(tiles.length,3);
  for (const tile of tiles) { assert.ok(tile.x>=0 && tile.y>=0 && tile.x+tile.width<=1000.0001 && tile.y+tile.height<=300.0001); assert.ok(Math.abs(tile.width*tile.height/300000 - tile.node.size/100)<.00001); }
});
test('目录扫描聚合已知长度；连接不重复统计或循环', async () => {
  const folder = path.join(fixture,'disk'); await fs.mkdir(path.join(folder,'child'),{recursive:true});
  await fs.writeFile(path.join(folder,'a.bin'),Buffer.alloc(10)); await fs.writeFile(path.join(folder,'child','b.bin'),Buffer.alloc(30));
  const link = path.join(folder,'loop'); await fs.symlink(folder,link,'junction');
  const result = await core.scanDirectory(folder); assert.equal(result.root.size,40); assert.equal(result.files,2); assert.equal(result.directories,2); assert.equal(result.issues.length,1);
  await fs.unlink(link);
});
test('扫描可取消；选中文件不被当作目录', async () => {
  await assert.rejects(core.scanDirectory(fixture,undefined,() => true),/取消/);
  const file = path.join(fixture,'file.txt'); await fs.writeFile(file,'hello'); await assert.rejects(core.scanDirectory(file),/请选择目录/);
});
test('UTF-8 / UTF-16 / GBK 编码能往返，自动检测拒绝含糊编码', async () => {
  for (const encoding of ['UTF-8','UTF-16','GBK']) { const file = path.join(fixture,encoding+'.txt'); await core.saveText(file,'中文 ABC',encoding); assert.equal(await core.readText(file,encoding),'中文 ABC'); if(encoding!=='GBK') assert.equal(await core.readText(file,'自动'),'中文 ABC'); }
  await assert.rejects(core.readText(path.join(fixture,'GBK.txt'),'自动'),/选择 GBK/);
});
test('编码丢失拒绝保存，已有文件内容保持原样', async () => {
  const file = path.join(fixture,'preserve.txt'); await fs.writeFile(file,'原文件'); await assert.rejects(core.saveText(file,'汉字 😀','GBK'),/无损/); assert.equal(await fs.readFile(file,'utf8'),'原文件');
});

test('旧设置迁移保留左右音量，四个边缘可独立配置并拒绝无效值', () => {
  const old=core.defaultSettings(); delete old.edges; old.volumeStep=7;
  const migrated=core.validateSettings(old); assert.deepEqual(migrated.edges.left,{action:'volume',step:7}); assert.equal(migrated.edges.top.action,'off');
  migrated.edges.top={action:'brightness',step:3}; migrated.edges.right={action:'off',step:2}; migrated.edges.bottom={action:'volume',step:5};
  assert.deepEqual(core.validateSettings(migrated),migrated);
  assert.throws(()=>core.validateSettings({...migrated,edges:{...migrated.edges,top:{action:'exec',step:3}}}));
  assert.throws(()=>core.validateSettings({...migrated,edges:{...migrated.edges,top:{action:'brightness',step:21}}}));
});

test('四边命中覆盖负坐标、缩放宽度、屏幕接缝和角落优先级', () => {
  const bounds={x:-1200,y:-100,width:1200,height:800}; const edges=core.defaultSettings().edges;
  for(const edge of Object.values(edges))edge.action='brightness';
  assert.equal(core.edgeAt({x:-1199,y:200},bounds,[],4,edges),'left');
  assert.equal(core.edgeAt({x:-1,y:200},bounds,[],4,edges),'right');
  assert.equal(core.edgeAt({x:-500,y:-98},bounds,[],4,edges),'top');
  assert.equal(core.edgeAt({x:-500,y:699},bounds,[],4,edges),'bottom');
  assert.equal(core.edgeAt({x:-500,y:-94},bounds,[],4,edges),null);
  assert.equal(core.edgeAt({x:-1,y:200},bounds,[{x:0,y:0,width:1920,height:1080}],4,edges),null);
  assert.equal(core.edgeAt({x:-1,y:-50},bounds,[{x:0,y:0,width:1920,height:1080}],4,edges),'right');
  edges.top.action='off';assert.equal(core.edgeAt({x:-1199,y:-99},bounds,[],4,edges),'left');
  assert.equal(core.edgeAt({x:500,y:200},bounds,[],4,edges),null);
});

test('复杂矩形布局互不重叠并保持面积比例', () => {
  const nodes=Array.from({length:80},(_,i)=>({path:String(i),name:String(i),directory:false,children:[],size:(i*37%101+1)**2}));
  for(const [width,height] of [[1000,480],[140,600]]) {
    const tiles=core.layout(nodes,0,0,width,height),total=nodes.reduce((s,n)=>s+n.size,0);assert.equal(tiles.length,nodes.length);
    for(let i=0;i<tiles.length;i++) {const a=tiles[i];assert.ok(Math.abs(a.width*a.height/(width*height)-a.node.size/total)<1e-8); for(let j=i+1;j<tiles.length;j++) {const b=tiles[j];const overlap=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));assert.ok(overlap<1e-6);}}
  }
});

test('文件筛选支持通配符、排除、大小、修改时间并重新聚合目录', () => {
  const now=Date.now(); const jpg={path:'p/a.jpg',name:'a.jpg',directory:false,size:2*1024**2,children:[],modified:now-40*86400000};
  const zip={...jpg,path:'p/b.zip',name:'b.zip',size:100}; const root={path:'p',name:'p',directory:true,size:jpg.size+100,children:[jpg,zip]};
  assert.equal(core.diskPredicate('*.jpg;>1mb;>30days',now)(jpg),true);assert.equal(core.diskPredicate('*.jpg;>1mb;>30days',now)(zip),false);
  assert.equal(core.diskPredicate('|*.zip')(zip),false);assert.equal(core.diskPredicate('|*.zip')(jpg),true);
  assert.equal(core.diskPredicate('a.jpg')(jpg),true);assert.throws(()=>core.diskPredicate('>3bananas'));
  const filtered=core.filteredTree(root,core.diskPredicate('*.jpg')); assert.equal(filtered.size,jpg.size);assert.equal(filtered.children.length,1);assert.equal(root.children.length,2);
});

test('增量扫描在完成前可重建树，祖先大小正确；取消也发送最后一批', async () => {
  const root=path.join(fixture,'stream'); await fs.mkdir(path.join(root,'nested'),{recursive:true});
  for(let start=0;start<2100;start+=100) await Promise.all(Array.from({length:100},(_,i)=>fs.writeFile(path.join(root,'nested',`${start+i}.txt`),'1234567890')));
  const tree=new core.ScanTree();let intermediate=false,events=0,complete=false;
  const result=await core.scanDirectory(root,progress=>{events++;tree.apply(progress);if(progress.files>0&&progress.files<2100&&!complete)intermediate=true;assert.equal(tree.root.size,progress.bytes);});complete=true;
  assert.equal(intermediate,true);assert.ok(events>=3);assert.equal(tree.root.size,21000);assert.equal(result.root.size,tree.root.size);assert.equal(tree.nodes.size,2102);assert.equal(tree.root.children[0].children.length,2100);
  let cancel=false,last=0; const partial=new core.ScanTree();
  await assert.rejects(core.scanDirectory(root,progress=>{partial.apply(progress);last=progress.bytes;if(progress.files>0)cancel=true;},()=>cancel),/取消/);
  assert.ok(last>0);assert.equal(partial.root.size,last);assert.ok(partial.root.children[0].children.length>0);
});
test('颜色转换覆盖黑白、原色与 Windows 编码，并迁移格式偏好',()=>{
  const red=core.colorFormats('#FF0000');assert.equal(Object.keys(red).length,16);assert.equal(red.rgb,'rgb(255, 0, 0)');assert.equal(red.hsl,'hsl(0, 100%, 50%)');assert.equal(red.cmyk,'cmyk(0%, 100%, 100%, 0%)');assert.equal(red.decimal,'255');assert.equal(red.hexInt,'0xFFFF0000');assert.equal(core.colorFormats('#FFE4B5').decimal,'11920639');assert.equal(core.colorFormats('#000000').cmyk,'cmyk(0%, 0%, 0%, 100%)');assert.equal(core.colorFormats('#FFFFFF').lab,'CIELab(100, 0, 0)');for(const v of Object.values(core.colorFormats('#000000')))assert.doesNotMatch(v,/NaN|Infinity/);assert.throws(()=>core.colorFormats('bad'));
  const old=core.defaultSettings();delete old.colorFormat;delete old.colorVisibleFormats;assert.equal(core.validateSettings(old).colorFormat,'hex');assert.throws(()=>core.validateSettings({...old,colorFormat:'invalid'}));
});
test('媒体文件响应支持精确范围、尾部读取、HEAD 和越界拒绝',async()=>{
  const file=path.join(fixture,'media-range.bin');await fs.writeFile(file,Buffer.from('0123456789'));
  const range=await core.fileResponse(file,'application/octet-stream',new Request('https://local/file',{headers:{Range:'bytes=3-6'}}));assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 3-6/10');assert.equal(range.headers.get('content-length'),'4');assert.equal(await range.text(),'3456');
  const tail=await core.fileResponse(file,'application/octet-stream',new Request('https://local/file',{headers:{Range:'bytes=-3'}}));assert.equal(await tail.text(),'789');
  const head=await core.fileResponse(file,'application/octet-stream',new Request('https://local/file',{method:'HEAD'}));assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  const bad=await core.fileResponse(file,'application/octet-stream',new Request('https://local/file',{headers:{Range:'bytes=10-20'}}));assert.equal(bad.status,416);
});

test('菜单支持分组与参数，拒绝循环、重复 ID 和危险协议',()=>{
 const item={id:'one',parent:'',kind:'group',label:'工具',target:'',args:[],cwd:'',icon:'folder',enabled:true};
 const command={...item,id:'two',parent:'one',kind:'command',label:'编辑',target:'notepad.exe',args:['{selected}']};
 assert.equal(core.validateMenu([item,command])[1].args[0],'{selected}');
 assert.throws(()=>core.validateMenu([item,item]));
 assert.throws(()=>core.validateMenu([{...item,parent:'two'},{...item,id:'two',parent:'one'}]));
 assert.throws(()=>core.validateMenu([{...item,kind:'url',target:'javascript:alert(1)'}]));
 const old=core.defaultSearch();delete old.menu;delete old.fuzzy;delete old.pinyin;const next=core.validateSearch(old);assert.ok(next.menu.length&&next.fuzzy&&next.pinyin);
});

test('菜单最多五层，阻止第六层和自引用',()=>{
 const items=Array.from({length:6},(_,i)=>({id:'depth-'+i,parent:i?'depth-'+(i-1):'',kind:'group',label:'组'+i,target:'',args:[],cwd:'',icon:'folder',enabled:true}));assert.equal(core.validateMenu(items.slice(0,5)).length,5);assert.throws(()=>core.validateMenu(items),/五层/);
});
