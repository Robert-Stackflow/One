import {readFile,stat} from 'node:fs/promises';

const maxSvgBytes=5*1024*1024;

export function validateSvg(text:string):string{
 if(!/<svg(?:\s|>)/i.test(text))throw Error('不是有效 SVG 图片');
 if(/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|image|feImage)\b|@import\b/i.test(text))throw Error('SVG 含外部资源或可执行内容，无法安全处理');
 for(const match of text.matchAll(/(?:^|[\s])(?:xlink:)?href\s*=\s*(['"])(.*?)\1/gi))if(!/^#[\w:.-]+$/.test(match[2]))throw Error('SVG 外部链接不受支持');
 const withoutLocalUrls=text.replace(/url\(\s*(['"]?)#[\w:.-]+\1\s*\)/gi,'');
 if(/url\s*\(/i.test(withoutLocalUrls))throw Error('SVG 外部资源不受支持');
 return text;
}

export async function readSafeSvg(path:string):Promise<string>{
 const size=(await stat(path)).size;if(size>maxSvgBytes)throw Error('SVG 文件超过 5 MB 上限');
 const data=await readFile(path);if(data.length>maxSvgBytes)throw Error('SVG 文件超过 5 MB 上限');if(data.includes(0))throw Error('SVG 文件编码无效');
 return validateSvg(data.toString('utf8'));
}
