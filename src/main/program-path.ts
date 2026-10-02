import {stat,lstat,readlink} from 'node:fs/promises';
import {isAbsolute,join,dirname,extname,resolve} from 'node:path';

function aliasDirectory(file:string,env:NodeJS.ProcessEnv) {
 const aliases=env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'Microsoft/WindowsApps');
 return !!aliases&&extname(file).toLowerCase()==='.exe'&&resolve(dirname(file)).toLowerCase()===resolve(aliases).toLowerCase();
}
export async function availableProgram(file:string,env:NodeJS.ProcessEnv=process.env):Promise<boolean> {
 if((await stat(file).catch(()=>undefined))?.isFile())return true;
 // Windows app execution aliases are reparse links, not readable PE files.
 // Only accept these links in the system-managed alias directory.
 return aliasDirectory(file,env)&&!!(await lstat(file).catch(()=>undefined))?.isSymbolicLink();
}
export async function programImagePath(file:string,env:NodeJS.ProcessEnv=process.env):Promise<string> {
 if(!aliasDirectory(file,env))return file;
 const target=await readlink(file).catch(()=>undefined);
 return target&&isAbsolute(target)&&extname(target).toLowerCase()==='.exe'?target:file;
}

export async function programPath(program:string,env:NodeJS.ProcessEnv=process.env):Promise<string> {
 if(isAbsolute(program))return program;
 if(!/^[\w .+-]+\.exe$/i.test(program))throw new Error('程序路径无效');
 const windows=env.SystemRoot||'C:\\Windows';
 const paths=program.toLowerCase()==='powershell.exe'?[join(windows,'System32/WindowsPowerShell/v1.0')]:[];
 paths.push(...(env.PATH||env.Path||'').split(';').map(p=>p.replace(/^"|"$/g,'')).filter(p=>isAbsolute(p)),join(windows,'System32'));
 for(const folder of [...new Set(paths)]){const file=join(folder,program);if(await availableProgram(file,env))return file;}
 throw new Error('找不到程序，请选择完整的程序路径');
}
