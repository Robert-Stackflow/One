import type {SearchEntry} from '../shared/search';

// Syllables stay beside the command names so newly added actions can be
// searched by full pinyin and initials without loading a dictionary at startup.
const commands=[
 ['preview','快速预览','预览选中的文件或文件夹','kuai su yu lan'],
 ['diff','文件比较','将选中的两个项目放入左右两侧','wen jian bi jiao'],
 ['rename','批量重命名','把选中的项目添加到重命名范围','pi liang chong ming ming'],
 ['locksmith','检查文件占用','检查当前选中的文件或文件夹','jian cha wen jian zhan yong'],
 ['disk','空间分析','分析当前目录','kong jian fen xi'],
 ['integrity','完整性校验','为目录生成或核对 SHA-256 清单','wan zheng xing jiao yan'],
 ['tasks','任务中心','查看正在执行的任务和历史结果','ren wu zhong xin'],
 ['page:home','打开概览','查看磁盘、任务与常用工具','da kai gai lan'],
 ['page:tools','打开文件工具','重复文件、比较、重命名与全文搜索','da kai wen jian gong ju'],
 ['page:text','打开文本处理','清理、转换、比较与批处理','da kai wen ben chu li'],
 ['page:search','打开文件搜索设置','索引、快捷入口与菜单','da kai wen jian sou suo she zhi'],
 ['page:input','打开操作增强','快捷操作、边缘、唤醒与置顶','da kai cao zuo zeng qiang'],
 ['page:disk','打开空间分析','查看目录占用与变化','da kai kong jian fen xi'],
 ['page:locksmith','打开文件占用','检查被进程占用的文件','da kai wen jian zhan yong'],
 ['page:system','打开系统维护','启动项、注册表、磁盘清理、网络端口与系统服务','da kai xi tong wei hu'],
 ['page:hardware','打开系统信息','查看硬件与网络信息','da kai xi tong xin xi'],
 ['page:ports','打开网络端口','查看端口、进程与连接','da kai wang luo duan kou'],
 ['page:services','打开系统服务','查看服务状态与启动方式','da kai xi tong fu wu'],
 ['page:color','打开屏幕取色','从屏幕拾取颜色','da kai ping mu qu se'],
 ['page:capture','打开截图','区域、窗口与多显示器截图','da kai jie tu'],
 ['page:recording','打开录制','屏幕、窗口、摄像头与录音','da kai lu zhi'],
 ['page:materials','打开素材','图片与录制工程','da kai su cai'],
 ['page:pins','打开贴图','管理桌面贴图与分组','da kai tie tu'],
 ['capture-region','区域截图','选择屏幕区域','qu yu jie tu'],
 ['capture-copy','截屏并自动复制','选区后复制到剪贴板','jie ping bing zi dong fu zhi'],
 ['capture-custom','自定义截屏','配置位置、尺寸与延迟','zi ding yi jie ping'],
 ['capture-screen','显示器截图','截取当前显示器','xian shi qi jie tu'],
 ['capture-clipboard','编辑剪贴板图片','打开图片编辑器','bian ji jian tie ban tu pian'],
 ['pins-clipboard','贴出剪贴板','将图片、文字或文件贴到桌面','tie chu jian tie ban'],
 ['pins-toggle','隐藏 / 显示全部贴图','切换桌面贴图可见性','yin cang xian shi quan bu tie tu'],
 ['pins-next-group','切换贴图分组','切换显示的桌面贴图组','qie huan tie tu fen zu'],
 ['page:settings','打开设置','外观与通用设置','da kai she zhi']
] as const;
const keywords:Record<string,string>={'page:ports':'port ports network 网络 端口','page:services':'service services 系统 服务','page:hardware':'hardware system info 系统 硬件 信息','page:disk':'storage space 磁盘 空间','page:locksmith':'lock file occupied 占用 锁定','page:color':'color picker colour 取色 颜色','page:tools':'file tools 文件 工具','page:text':'text markdown 文本','page:input':'utility utilities 操作 增强'};

function oneEdit(query:string,word:string){
 if(query.length<4||Math.abs(query.length-word.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<query.length&&j<word.length){
  if(query[i]===word[j]){i++;j++;continue;}
  if(++edits>1)return false;
  if(query[i]===word[j+1]&&query[i+1]===word[j]){i+=2;j+=2;continue;}
  if(query.length>word.length)i++;else if(query.length<word.length)j++;else{i++;j++;}
 }
 return edits+(query.length-i)+(word.length-j)<=1;
}
function nearPinyin(query:string,word:string){
 if(query.length<4)return false;
 return [query.length-1,query.length,query.length+1].some(length=>length<=word.length&&oneEdit(query,word.slice(0,length)));
}
function subsequence(query:string,word:string){let index=0;for(const letter of word)if(letter===query[index])index++;return index===query.length;}
function score(query:string,id:string,label:string,detail:string,pinyin:string,settings:{pinyin:boolean;fuzzy:boolean}){
 if(!query)return 1;
 const plain=(label+' '+detail).toLowerCase(),alias=(keywords[id]||'').toLowerCase();
 if(label.toLowerCase()===query)return 120;
 if(label.toLowerCase().includes(query))return 100;
 if(plain.includes(query)||alias.includes(query))return 85;
 if(!settings.pinyin)return 0;
 if(!/^[a-z]+$/.test(query))return 0;
 const syllables=pinyin.split(' '),variants=[syllables];
 if(label.startsWith('打开'))variants.push(syllables.slice(2));
 let best=0;
 for(const parts of variants){
  const full=parts.join(''),initials=parts.map(part=>part[0]).join('');
  for(const word of [full,initials]){
   if(word===query)best=Math.max(best,90);
   else if(word.startsWith(query))best=Math.max(best,75);
   else if(word.includes(query))best=Math.max(best,65);
   else if(settings.fuzzy&&nearPinyin(query,word))best=Math.max(best,45);
   else if(settings.fuzzy&&query.length>=3&&query.length/word.length>=0.55&&subsequence(query,word))best=Math.max(best,35);
  }
 }
 return best;
}
export function commandMatches(term:string,limit=6,settings:{pinyin:boolean;fuzzy:boolean}={pinyin:true,fuzzy:true}):SearchEntry[]{
 const query=term.trim().toLowerCase().replace(/\s+/g,'');
 return commands.map(([id,label,detail,pinyin],order)=>({id,label,detail,order,rank:score(query,id,label,detail,pinyin,settings)}))
  .filter(command=>command.rank>0).sort((a,b)=>b.rank-a.rank||a.order-b.order).slice(0,limit)
  .map(({id,label,detail})=>({path:'action:'+id,name:label,subtitle:detail,directory:false,size:0,modified:0,launchKind:'action'}));
}
