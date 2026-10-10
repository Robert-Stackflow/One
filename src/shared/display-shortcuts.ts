export interface DisplayShortcuts {increase:string;decrease:string;step:number}
export interface DisplayShortcutState {increase:{active:boolean;error:string};decrease:{active:boolean;error:string};busy:boolean;operationError:string}
export const defaultDisplayShortcuts=():DisplayShortcuts=>({increase:'',decrease:'',step:5});
export function displayAccelerator(value:string):string {
 if(!value)return '';if(value.length>100||!/^(?:(?:Control|Ctrl|Alt|Shift|Super|Meta|Win)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i.test(value))throw Error('请使用包含 Ctrl、Alt、Shift 或 Win 的有效组合键');
 const pieces=value.split('+'),key=pieces.pop()!,mods=pieces.map(p=>({ctrl:'Control',control:'Control',alt:'Alt',shift:'Shift',win:'Super',meta:'Super',super:'Super'}[p.toLowerCase()]!));if(new Set(mods).size!==mods.length)throw Error('快捷键修饰键不能重复');
 const special=['Space','Tab','Enter','Escape','Backspace','Delete','Home','End','PageUp','PageDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];const normalized=special.find(k=>k.toLowerCase()===key.toLowerCase())?.replace('Arrow','')||key.toUpperCase();return [...['Control','Alt','Shift','Super'].filter(m=>mods.includes(m)),normalized].join('+');
}
export function validateDisplayShortcuts(value:unknown):DisplayShortcuts {
 if(value===undefined)return defaultDisplayShortcuts();const p=value as DisplayShortcuts;if(!p||typeof p.increase!=='string'||typeof p.decrease!=='string'||!Number.isInteger(p.step)||p.step<1||p.step>20)throw Error('亮度快捷键设置无效');
 const up=displayAccelerator(p.increase),down=displayAccelerator(p.decrease);if(up&&up===down)throw Error('调亮和调暗不能使用相同快捷键');return {increase:p.increase,decrease:p.decrease,step:p.step};
}
