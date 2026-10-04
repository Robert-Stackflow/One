import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
import { spawn } from 'node:child_process';
import { Settings } from '../shared/types';
import {levels} from './levels';
import { brightness } from './brightness';
import { foreground, lockWorkstation, nativeAvailable, nativeError, keyboardIndicators, capsLockState, modifiersHeld } from './native';
import type {EchoChannel} from '../shared/echo';
import {echoNames} from '../shared/echo';
import {CapsDeadline} from '../shared/quick-actions';
import type {LevelState} from '../shared/hud';
type Callbacks = { echo(text: string,channel?:EchoChannel): void; level(value:LevelState):void;caps(active:boolean):void; show(): void; color():void; preview(hwnd: number,focus:number): Promise<void> };
export class InputService {
  private modalActive=false;
  setModalActive(active:boolean){this.modalActive=active;this.configureNative();this.checkIndicators();}
  private running = false; private error = ''; private held = new Set<number>();
  private capsDeadline=new CapsDeadline();private capsVisible=false;private indicatorTimer?:NodeJS.Timeout;private indicators?:ReturnType<typeof keyboardIndicators>;
  private previewBusy = false; private lastPreview = 0;
  private lastErrorEcho = 0;
  constructor(private settings: Settings, private callbacks: Callbacks) {
    uIOhook.on('keydown', event => this.key(event)); uIOhook.on('keyup', event => this.held.delete(event.keycode));
  }
  private blocked() {
    if(this.modalActive)return true;
    const f = foreground(); if (!f) return true;
    return f.password || (this.settings.pauseFullscreen && f.fullscreen) || this.settings.excludedApps.split(/[,;\n]/).map(x => x.trim().toLowerCase()).filter(Boolean).includes(f.name.toLowerCase());
  }
  private key(event: UiohookKeyboardEvent) {
    if (!this.running) return;
    if (this.held.has(event.keycode)) return; this.held.add(event.keycode);
    if (this.blocked()) return;
    const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win'].filter(Boolean);
    const modifierCodes: number[] = [UiohookKey.Ctrl, UiohookKey.CtrlRight, UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Shift, UiohookKey.ShiftRight, UiohookKey.Meta, UiohookKey.MetaRight];
    if (this.settings.keyEcho && this.settings.echo.keys.enabled && !([UiohookKey.CapsLock,UiohookKey.NumLock,UiohookKey.ScrollLock] as number[]).includes(event.keycode) && !modifierCodes.includes(event.keycode) && (!this.settings.onlyCombinations || modifiers.length)) {
      const name = Object.entries(UiohookKey).find(([, value]) => value === event.keycode)?.[0] || `键 ${event.keycode}`;
      this.callbacks.echo([...modifiers, name].join(' + '),'keys');
    }
    if (this.settings.explorerPreview && event.keycode === UiohookKey.Space && !modifiers.length && Date.now() - this.lastPreview > 400 && !this.previewBusy) {
      const f = foreground(true); if (!f?.fileView||!f.focus) return;
      this.lastPreview = Date.now(); this.previewBusy = true;
      void this.callbacks.preview(f.hwnd,f.focus).catch(error => { this.error = String(error); }).finally(() => { this.previewBusy = false; });
    }
  }
  update(settings: Settings) {
    this.settings = settings;
    const needed = settings.keyEcho || settings.explorerPreview;
    try { if (needed && !this.running) { uIOhook.start(); this.running = true; this.error = ''; } else if (!needed && this.running) { uIOhook.stop(); this.running = false; this.held.clear(); } }
    catch (error) { this.error = String(error); }
    clearInterval(this.indicatorTimer);this.indicators=undefined;if(settings.keyEcho||settings.capsLock.persistent||settings.capsLock.autoOff){this.checkIndicators();this.indicatorTimer=setInterval(()=>this.checkIndicators(),160);}else {this.capsDeadline.reset();this.showCaps(false);}
    this.configureNative();
    if(settings.edgeScroll){levels.warm();if(Object.values(settings.edges).some(edge=>edge.action==='brightness'))void brightness.status().catch(()=>{});}
  }
  private configureNative(){
    levels.corners(this.settings,this.modalActive,corner=>this.triggerCorner(corner));
    levels.quick(this.settings,this.modalActive,level=>{if(!this.blocked()){this.error='';this.callbacks.level(level);}},error=>{this.error=error;if(Date.now()-this.lastErrorEcho>4000){this.lastErrorEcho=Date.now();this.callbacks.echo(error);}});
  }
  private showCaps(active:boolean){if(this.capsVisible===active)return;this.capsVisible=active;this.callbacks.caps(active);}
  private checkIndicators(){try{
    const caps=capsLockState(),blocked=this.blocked();this.showCaps(caps&&this.settings.capsLock.persistent&&!blocked);
    if(this.capsDeadline.update(caps,this.settings.capsLock,Date.now())&&!this.modalActive&&!modifiersHeld())uIOhook.keyTap(UiohookKey.CapsLock);
    if(!this.settings.keyEcho||blocked)return;const next=keyboardIndicators();
    if(this.indicators)for(const key of ['ime','caps','num','scroll'] as const)if(this.settings.echo[key].enabled&&next[key]!==this.indicators[key]&&!(key==='caps'&&this.settings.capsLock.persistent))this.callbacks.echo(key==='ime'?next.ime:`${echoNames[key]} · ${next[key]?'开启':'关闭'}`,key);
    this.indicators=next;
  }catch(error){this.error=String(error);}}
  private triggerCorner(corner:keyof Settings['corners']) {
    if(this.blocked())return;
    try { const action = this.settings.corners[corner];
      if (action === 'desktop') uIOhook.keyTap(UiohookKey.D, [UiohookKey.Meta]);
      if (action === 'tasks') uIOhook.keyTap(UiohookKey.Tab, [UiohookKey.Meta]);
      if (action === 'lock') lockWorkstation();
      if (action === 'one') this.callbacks.show();
      if (action === 'start') uIOhook.keyTap(UiohookKey.Meta);
      if (action === 'explorer') uIOhook.keyTap(UiohookKey.E,[UiohookKey.Meta]);
      if (action === 'screenshot') uIOhook.keyTap(UiohookKey.S,[UiohookKey.Meta,UiohookKey.Shift]);
      if (action === 'color') this.callbacks.color();
      if (action === 'hotkey') {
        const parts=this.settings.cornerBindings[corner].shortcut.split('+');
        const aliases:Record<string,string>={control:'Ctrl',ctrl:'Ctrl',alt:'Alt',shift:'Shift',win:'Meta',meta:'Meta',arrowleft:'ArrowLeft',arrowright:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown'};
        const codes=parts.map(part=>{const name=aliases[part.toLowerCase()]||Object.keys(UiohookKey).find(key=>key.toLowerCase()===part.toLowerCase());const code=name?(UiohookKey as Record<string,number>)[name]:undefined;if(code===undefined)throw new Error('不支持此快捷键');return code;});
        const key=codes.pop()!;uIOhook.keyTap(key,codes);
      }
      if (action === 'command') {
        const binding=this.settings.cornerBindings[corner];
        // The executable and arguments are stored separately: no implicit shell evaluation.
        const process=spawn(binding.command,binding.args,{cwd:binding.cwd||undefined,windowsHide:true,detached:true,stdio:'ignore',shell:false});
        process.on('error',error=>{this.error=error.message;this.callbacks.echo('命令执行失败');});process.unref();
      }
    } catch (error) { this.error = String(error); }
  }
  status() { return { hook: this.running||this.settings.edgeScroll||Object.values(this.settings.quickActions).some(value=>value===true)||this.settings.capsLock.autoOff||this.settings.capsLock.persistent, native: nativeAvailable(), error: this.error || nativeError }; }
  stop() { this.capsDeadline.reset();this.showCaps(false);this.held.clear(); levels.stop();clearInterval(this.indicatorTimer); if (this.running) uIOhook.stop(); this.running = false; }
}
