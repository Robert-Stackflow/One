import {isAbsolute,resolve} from 'node:path';
import {isArchivePath} from '../shared/archive-actions';
/** Explicit argument only; unrelated startup paths never become extraction jobs. */
export function archiveLaunchPath(args:string[]):string|undefined {
 const matches=args.filter(arg=>arg.startsWith('--one-archive='));
 if(!matches.length)return;
 if(matches.length!==1)throw Error('一次只能打开一个压缩包');
 const path=matches[0].slice('--one-archive='.length);
 if(!path||path.length>32768||!isAbsolute(path)||/[\0\r\n]/.test(path))throw Error('压缩包路径无效');
 if(!isArchivePath(path))throw Error('暂不支持该压缩格式');
 return resolve(path);
}
