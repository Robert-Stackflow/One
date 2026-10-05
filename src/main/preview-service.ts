import {stat} from 'node:fs/promises';
import {basename,dirname,extname,join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {readText} from './text-files';
import type {PreviewData,FileEntry} from '../shared/types';
import {textExtensions} from '../shared/preview';
import type {DirectoryInfo} from '../shared/directory';
function inspect(path:string,kind:string):Promise<{entries?:FileEntry[];metadata?:Record<string,string>;cover?:string;lyrics?:import('../shared/preview').LyricLine[];workbook?:import('../shared/workbook').WorkbookData}>{return new Promise((resolve,reject)=>{
  const worker=new Worker(join(__dirname,'preview-worker.cjs'),{workerData:{path,kind},resourceLimits:{maxOldGenerationSizeMb:192}});
  const timer=setTimeout(()=>{void worker.terminate();reject(new Error('文件解析超时，请用默认程序打开'));},15000);
  const finish=()=>{clearTimeout(timer);void worker.terminate();};worker.once('message',message=>{finish();message.error?reject(new Error(message.error)):resolve(message.result);});worker.once('error',error=>{finish();reject(error);});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('文件解析已终止'));});
});}
export async function reloadWorkbook(path:string):Promise<import('../shared/workbook').WorkbookData>{
 const result=await inspect(path,'workbook');
 if(!result.workbook)throw new Error('工作簿无法读取');
 return result.workbook;
}
const images:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',svg:'image/svg+xml',avif:'image/avif'};
const media:Record<string,string>={mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',opus:'audio/ogg',aac:'audio/aac',m4a:'audio/mp4',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska'};
export async function preparePreview(path:string,register:(path:string,mime:string)=>string,directory:(path:string,target?:string)=>Promise<DirectoryInfo>):Promise<PreviewData>{
  const info=await stat(path),ext=extname(path).slice(1).toLowerCase();
  const navigation=await directory(dirname(path),path).catch(()=>undefined);
  const data:PreviewData={name:basename(path)||path,path,size:info.size,type:'unsupported',siblings:[],navigation,modified:info.mtimeMs,created:info.birthtimeMs,metadata:{'类型':info.isDirectory()?'文件夹':(ext.toUpperCase()||'文件')}};
  if(info.isDirectory()){data.directory=await directory(path);data.type='folder';data.metadata!['项目']=String(data.directory.count);return data;}
  if(!info.isFile())throw new Error('此项目无法预览');
  const kind=images[ext]?'image':media[ext]?'media':ext==='pdf'?'pdf':ext==='docx'?'docx':ext==='pptx'?'pptx':/^(xlsx|xlsm|xltx|ods)$/.test(ext)?'workbook':ext==='epub'?'epub':/^(ttf|otf|woff|woff2)$/.test(ext)?'font':/^(zip|apk|jar|nupkg|xpi|vsix)$/.test(ext)?'archive':null;
  if(kind){
    if((kind==='image'&&info.size>100*1024*1024)||(['docx','pptx','workbook','epub','font'].includes(kind)&&info.size>50*1024*1024)){data.error='文件超过预览大小上限';return data;}
    try{if(['archive','docx','pptx','workbook','epub'].includes(kind)){const result=await inspect(path,kind);data.entries=kind==='archive'?result.entries:undefined;data.workbook=result.workbook;Object.assign(data.metadata!,result.metadata);}else if(['image','media'].includes(kind)){try{const result=await inspect(path,kind);Object.assign(data.metadata!,result.metadata);data.cover=result.cover;data.lyrics=result.lyrics;}catch{}}
      data.type=kind;data.url=register(path,images[ext]||media[ext]||(kind==='pdf'?'application/pdf':'application/octet-stream'));
    }catch(error){data.error=(error as Error).message;}return data;
  }
  if(textExtensions.test(ext)||/^(readme|license|dockerfile|makefile|cmakelists.txt)$/i.test(data.name)||data.name.startsWith('.')){
    if(info.size>50*1024*1024){data.error='文本超过 50 MB，使用默认程序打开';return data;}
    try{if(info.size>1024*1024)data.textURL=register(path,'application/octet-stream');else data.text=await readText(path,'自动');data.metadata!['编码']='UTF-8 / BOM 自动识别';data.type=/^(md|mdx|mdown|markdown)$/.test(ext)?'markdown':/^(html|htm)$/.test(ext)?'html':ext==='json'?'json':ext==='ipynb'?'notebook':/^(yaml|yml)$/.test(ext)?'yaml':/^(csv|tsv)$/.test(ext)?'csv':'text';}catch(error){data.error=(error as Error).message;}
  }return data;
}
