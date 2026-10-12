import type {RecorderAPI,RecordingAudioSource} from '../../shared/recording/recording';
import {audioLevel} from '../audio-level';
import {selectSource} from '../controls';

/** Idle device tests belong to the page; recording capture has a separate lifetime. */
export function recorderAudioTests(root:HTMLElement,api:RecorderAPI){
  const channels=['system','microphone'] as const;
  const events=new AbortController(),requests=new Map<RecordingAudioSource,number>();
  const controls=new Map<RecordingAudioSource,ReturnType<typeof audioLevel>>();
  let active=false,disabled=false,disposed=false,stopping=Promise.resolve();
  const q=(id:string)=>root.querySelector<HTMLElement>('#recording-'+id)!;
  const enabled=(channel:RecordingAudioSource)=>(q(channel==='system'?'system-audio':'microphone') as HTMLInputElement).checked;
  const device=(channel:RecordingAudioSource)=>selectSource(q(channel==='system'?'system-device':'microphone-device'))!.value;
  async function set(channel:RecordingAudioSource,on:boolean){
    if(on&&(!active||disabled||disposed||!enabled(channel)))return;
    const revision=(requests.get(channel)||0)+1;requests.set(channel,revision);
    const control=controls.get(channel)!;
    control.set({channel,status:on?'starting':'idle',level:0});
    try{await api.audioTest(channel,on,on?device(channel):'');}
    catch(error){if(active&&!disposed&&requests.get(channel)===revision)control.set({channel,status:'error',level:0,message:(error as Error).message});}
  }
  function update(next=disabled){disabled=next;for(const channel of channels)controls.get(channel)!.disable(!active||disposed||disabled||!enabled(channel));}
  function stop(){
    // Invalidate queued starts even before their first level event reaches this page.
    const work=Promise.all(channels.map(channel=>set(channel,false))).then(()=>{});
    stopping=Promise.all([stopping,work]).then(()=>{});return stopping;
  }
  for(const channel of channels){
    const node=document.createElement('div');
    q(channel==='system'?'system-sound-source':'microphone-sound-source').append(node);
    controls.set(channel,audioLevel(node,channel==='system'?'系统声音':'麦克风',on=>{void set(channel,on);}));
    q(channel==='system'?'system-audio':'microphone').addEventListener('change',()=>{if(!enabled(channel)&&controls.get(channel)!.active)void set(channel,false);update();},{signal:events.signal});
    q(channel==='system'?'system-device':'microphone-device').addEventListener('change',()=>{if(controls.get(channel)!.active)void set(channel,true);},{signal:events.signal});
  }
  const unsubscribe=api.onAudioTest(state=>{if(active&&!disposed)controls.get(state.channel)?.set(state);});
  update();
  return {
    update,
    activate(value:boolean){if(disposed)return Promise.resolve();active=value;update();return value?stopping:stop();},
    async dispose(){if(disposed)return;disposed=true;active=false;events.abort();unsubscribe();await stop();update();},
  };
}
