export interface MenuPreset {
 id:string;label:string;kind:'command'|'builtin';target:string;args:string[];cwd:string;
 available:boolean;source:'preset'|'system';program?:string;console?:boolean;
}
export interface RegisteredHereApp {id:string;label:string;file:string;args:string[]}
export const hereCatalog:readonly {id:string;name:string;files:string[];paths?:string[];args:string[];console?:boolean}[]=[
 {id:'terminal',name:'终端',files:['wt.exe'],args:['-d','{folder}']},
 {id:'vscode',name:'VS Code',files:['Code.exe'],paths:['Microsoft VS Code/Code.exe'],args:['{folder}']},
 {id:'android-studio',name:'Android Studio',files:['studio64.exe','studio.exe'],paths:['Android/Android Studio/bin/studio64.exe','Android Studio/bin/studio64.exe'],args:['{folder}']},
 {id:'visual-studio',name:'Visual Studio',files:['devenv.exe','VSLauncher.exe'],args:['{folder}']},
 {id:'git-bash',name:'Git Bash',files:['git-bash.exe'],paths:['Git/git-bash.exe'],args:['--cd={folder}']},
 {id:'git-gui',name:'Git GUI',files:['git-gui.exe'],paths:['Git/cmd/git-gui.exe'],args:['--working-dir','{folder}']},
 {id:'powershell7',name:'PowerShell 7',files:['pwsh.exe'],paths:['PowerShell/7/pwsh.exe'],args:['-NoLogo','-NoExit'],console:true},
 {id:'cmd',name:'命令提示符',files:['cmd.exe'],args:['/d','/k'],console:true},
 {id:'wsl',name:'WSL',files:['wsl.exe'],args:['--cd','{folder}'],console:true},
 {id:'cursor',name:'Cursor',files:['Cursor.exe'],paths:['cursor/Cursor.exe','Cursor/Cursor.exe'],args:['{folder}']},
 {id:'windsurf',name:'Windsurf',files:['Windsurf.exe'],paths:['Windsurf/Windsurf.exe'],args:['{folder}']},
 {id:'sublime',name:'Sublime Text',files:['sublime_text.exe'],paths:['Sublime Text/sublime_text.exe','Sublime Text 3/sublime_text.exe'],args:['{folder}']},
 {id:'notepad-plus',name:'Notepad++',files:['notepad++.exe'],paths:['Notepad++/notepad++.exe'],args:['-openFoldersAsWorkspace','{folder}']},
 {id:'idea',name:'IntelliJ IDEA',files:['idea64.exe','idea.exe'],args:['{folder}']},
 {id:'pycharm',name:'PyCharm',files:['pycharm64.exe','pycharm.exe'],args:['{folder}']},
 {id:'webstorm',name:'WebStorm',files:['webstorm64.exe','webstorm.exe'],args:['{folder}']},
 {id:'rider',name:'Rider',files:['rider64.exe','rider.exe'],args:['{folder}']},
 {id:'zed',name:'Zed',files:['zed.exe'],paths:['Zed/zed.exe'],args:['{folder}']},
 {id:'wezterm',name:'WezTerm',files:['wezterm-gui.exe'],paths:['WezTerm/wezterm-gui.exe'],args:['start','--cwd','{folder}']},
 {id:'alacritty',name:'Alacritty',files:['alacritty.exe'],paths:['Alacritty/alacritty.exe'],args:['--working-directory','{folder}']},
];
export function registeredPreset(app:RegisteredHereApp):MenuPreset|undefined {
 if(!app||typeof app.file!=='string'||!Array.isArray(app.args)||app.args.length>64||app.args.some(a=>typeof a!=='string'||a.length>4000)||!app.args.some(a=>/%[1VvLlWw]/.test(a)))return;
 const args=app.args.filter(a=>a!=='%*').map(a=>a.replace(/%[Vv]\./g,'{folder}').replace(/%[1VvLlWw]/g,'{folder}'));
 // Unhandled selection/shell placeholders must not turn into a broken preset.
 if(args.some(a=>/%[*23456789]/.test(a)))return;
 const file=app.file.split(/[\\/]/).pop()!.toLowerCase(),known=hereCatalog.find(c=>c.files.some(f=>f.toLowerCase()===file));
 return {id:'system:'+app.id,label:known?'在此打开 '+known.name:app.label.replace(/\(&.\)|&/g,'').trim(),kind:'command',target:app.file,args:known&&['cmd','powershell7'].includes(known.id)?[...known.args]:args,cwd:'{folder}',available:true,source:'system',program:app.file,...(known?.console?{console:true}:{})};
}
