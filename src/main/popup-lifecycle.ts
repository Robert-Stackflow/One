import type {BrowserWindow} from 'electron';

/** First paint can precede load completion; remember it instead of awaiting it twice. */
export class PopupReadiness {
 private ready=false;
 constructor(private window:BrowserWindow){window.once('ready-to-show',()=>{this.ready=true;});}
 run(show:()=>void){
  if(this.window.isDestroyed())return;
  if(this.ready)show();
  else this.window.once('ready-to-show',()=>{if(!this.window.isDestroyed())show();});
 }
}

/** Ignore blur timers from menus that were hidden/replaced during a cascade transition. */
export function deferPopupBlur(window:BrowserWindow,current:()=>boolean,dismiss:()=>void,delayMs:number){
 const timer=setTimeout(()=>{if(window.isDestroyed()||!window.isVisible()||!current())return;dismiss();},delayMs);
 timer.unref();
}

/** Reclaim hidden menu renderers without touching visible menus or search inputs. */
export class PopupLifecycle {
 private timers=new Map<BrowserWindow,NodeJS.Timeout>();
 private tracked=new Set<BrowserWindow>();
 private stopped=false;
 constructor(private idleMs=45_000){}
 track(window:BrowserWindow){
  if(this.stopped||window.isDestroyed()||this.tracked.has(window))return;
  this.tracked.add(window);
  const clear=()=>{clearTimeout(this.timers.get(window));this.timers.delete(window);};
  const idle=()=>{if(this.stopped||window.isDestroyed()||window.isVisible()||this.timers.has(window))return;const timer=setTimeout(()=>{this.timers.delete(window);if(!window.isDestroyed()&&!window.isVisible())window.destroy();},this.idleMs);timer.unref();this.timers.set(window,timer);};
  window.on('show',clear);window.on('hide',idle);window.once('closed',()=>{clear();this.tracked.delete(window);});idle();
 }
 stop(){this.stopped=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.tracked.clear();}
}
