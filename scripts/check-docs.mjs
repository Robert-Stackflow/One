import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';

// Include new Markdown before staging; ignored dependencies, samples and logs are excluded.
const root=resolve('.'),files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','*.md'],{cwd:root}).toString('utf8').split('\0').filter(Boolean))];
const allowed=['user-guide','development','research','history'],edges=new Map(),errors=[];let links=0;
for(const file of files){
 const parts=file.split('/');
 if(file!=='README.md'&&file!=='docs/README.md'&&(parts[0]!=='docs'||!allowed.includes(parts[1])))errors.push(`${file}: 文档未放入分类目录`);
 const targets=[];edges.set(file,targets);
 for(const match of readFileSync(resolve(root,file),'utf8').matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)){
  let href=match[1].trim();if(href.startsWith('<'))href=href.slice(1,href.indexOf('>'));else href=href.split(/\s+["']/)[0];
  if(!href||href.startsWith('#')||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href))continue;
  let decoded;try{decoded=decodeURIComponent(href.split(/[?#]/)[0]);}catch{errors.push(`${file}: 无效链接 ${href}`);continue;}
  const target=resolve(dirname(resolve(root,file)),decoded),inside=relative(root,target);links++;
  if(inside==='..'||inside.startsWith('..\\')||inside.startsWith('../')||isAbsolute(inside)){errors.push(`${file}: 链接超出仓库 ${href}`);continue;}
  if(!existsSync(target)){errors.push(`${file}: 链接目标不存在 ${href}`);continue;}
  if(/\.md$/i.test(target))targets.push(inside.replaceAll('\\','/'));
 }
}
const reached=new Set(),queue=['README.md','docs/README.md'];
while(queue.length){const file=queue.pop();if(reached.has(file))continue;reached.add(file);queue.push(...edges.get(file)||[]);}
for(const file of files)if(!reached.has(file))errors.push(`${file}: 无法从文档导航访问`);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`文档检查通过：${files.length} 份文档，${links} 个仓库内链接，全部已分类并可从导航访问。`);
