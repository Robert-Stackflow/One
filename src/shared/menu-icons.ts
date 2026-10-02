import type {SearchMenuItem} from './search';
import {builtinById} from './menu-builtins';

/** Older menus used generic glyphs. Keep explicit choices; hydrate program defaults. */
export function menuIconPath(item:SearchMenuItem):string|undefined {
 if(item.iconMode==='custom')return;
 if(item.kind==='builtin'&&builtinById(item.target)?.systemIcon&&(!item.icon||item.icon==='auto'||item.icon.replace(/^lucide:/,'')===builtinById(item.target)?.icon))return 'one-builtin:'+item.target;
 if(item.icon!=='auto' && item.icon && !/^(?:lucide:)?(?:file|window|terminal)$/.test(item.icon))return;
 let program='';
 if(item.kind==='builtin'&&item.target==='terminal')program='powershell.exe';
 else if(item.kind==='shell'||item.kind==='command'&&item.shell)program=item.shell==='custom'?item.shellPath||'':item.shell==='cmd'?'cmd.exe':item.shell==='pwsh'?'pwsh.exe':'powershell.exe';
 else if(item.kind==='command'||item.kind==='file')program=item.target.trim();
 if(/^[a-z]:[\\/]|^\\\\/i.test(program))return program;
 if(/^[\w .+-]+\.exe$/i.test(program))return 'one-program:'+program;
}
