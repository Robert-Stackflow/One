const api = window.one.recording!;
const fixture = (window as any).recordingFixture;
let recorder: MediaRecorder | undefined, serial = Promise.resolve(), complete: Promise<void> | undefined;
let chunks = 0, tailWritten = false, startedAt = 0, token = '', timer: ReturnType<typeof setInterval> | undefined;
let release: (()=>void)|undefined;
Object.assign(window, {
  async readRecordingFixture(url:string) {
    const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;
    try {
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Recording video did not decode')),5000);
        video.onloadeddata=()=>{clearTimeout(timer);resolve();};
        video.onerror=()=>{clearTimeout(timer);reject(Error('Recording video resource was rejected'));};
        video.src=url;
      });
      await video.play();
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Recording video did not present frames')),5000);
        video.requestVideoFrameCallback(()=>video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();}));
      });
      video.pause();
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const context=canvas.getContext('2d')!;context.drawImage(video,0,0);
      return {width:canvas.width,height:canvas.height,alpha:context.getImageData(0,0,1,1).data[3]};
    } finally {video.removeAttribute('src');video.load();}
  },
  recordingClientStats: () => ({chunks,tailWritten,recording:recorder?.state,token}),
  async startRecordingFixture(sourceId:string) {
    const options={mode:'video' as const,container:'webm' as const,sourceId,systemAudio:false,microphone:false,microphoneId:'',fps:15 as const,maxWidth:1920 as const};
    token=await api.arm(options);
    await fixture.display(false);
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;
    const context=canvas.getContext('2d')!;
    let frame=0;
    const paint=()=>{context.fillStyle=frame++%2?'#f0b429':'#3377ff';context.fillRect(0,0,160,100);};
    paint();timer=setInterval(paint,30);
    const stream=canvas.captureStream(15);
    recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    chunks=0;tailWritten=false;serial=Promise.resolve();
    recorder.ondataavailable=event=>{
      if(event.data.size)serial=serial.then(async()=>{const bytes=new Uint8Array(await event.data.arrayBuffer());await api.chunk(token,chunks,bytes);chunks++;});
    };
    complete=new Promise<void>((resolve,reject)=>{
      recorder!.onstop=()=>void(async()=>{
        try{
          // Keep the final callback outstanding so service-side drain must wait for it.
          await new Promise(resolve=>setTimeout(resolve,100));
          await serial;await api.finish(token,(performance.now()-startedAt)/1000,'',recorder!.mimeType);tailWritten=true;resolve();
        }catch(error){reject(error);}finally{release?.();release=undefined;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());}
      })();
    });
    release=api.onStop(()=>{if(recorder?.state!=='inactive')recorder?.stop();});
    await api.started(token,recorder.mimeType);startedAt=performance.now();recorder.start(80);
    return token;
  },
  awaitRecordingFixture:()=>complete,
});
