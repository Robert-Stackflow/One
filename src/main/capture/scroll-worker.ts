import { parentPort } from 'node:worker_threads';
import { ScrollStitch } from '../../shared/capture/scroll-stitch';
import { ScrollSettle } from '../../shared/capture/scroll-settle';
import type {PixelFrame} from '../../shared/capture/scroll-stitch';
let engine = new ScrollStitch();
let settling: ScrollSettle;
let staged:PixelFrame|undefined;
function clearStage(){staged?.pixels.fill(0);staged=undefined;}
parentPort!.on('message', ({ id, kind, value }) => {
  try {
    let result;
    if (kind === 'configure'||kind==='restart') {
      clearStage();
      if(kind==='restart')engine=new ScrollStitch();
      result = engine.configure(value.options, value.source);
      settling = new ScrollSettle(value.options, value.source);
    } else if(kind==='stage'){
      clearStage();const frame=value.frame as PixelFrame;
      if(!frame||!(frame.pixels instanceof Uint8Array))throw Error('采集像素帧无效');
      const stable=!value.monitored||settling.observe(frame,performance.now());
      if(stable)staged=frame;else frame.pixels.fill(0);
      parentPort!.postMessage({id,stable});return;
    } else if(kind==='release-frame'){
      clearStage();parentPort!.postMessage({id});return;
    } else if(kind==='commit'){
      if(!staged)throw Error('稳定像素帧已失效');
      try{result=engine.sample(staged);}finally{clearStage();}
    } else if (kind === 'settle-reset' || kind === 'observe') {
      if (!settling) throw Error('长截图尚未设置');
      if (kind === 'settle-reset') {clearStage();settling.reset();}
      parentPort!.postMessage({
        id,
        stable: kind === 'observe' && settling.observe(value, performance.now()),
      });
      return;
    } else if (kind === 'sample') result = engine.sample(value);
    else if (kind === 'join') result = engine.join(value);
    else if (kind === 'undo') result = engine.undo();
    else if (kind === 'discard') result = engine.discard();
    else if (kind === 'output') {
      const output = engine.output();
      parentPort!.postMessage({ id, output }, [output.pixels.buffer as ArrayBuffer]);
      return;
    } else throw Error('拼接操作无效');
    const preview = (kind==='commit'||kind==='sample')&&['unchanged','ambiguous','backwards'].includes(result!.match)?null:engine.preview();
    parentPort!.postMessage(
      { id, result, preview },
      preview ? [preview.pixels.buffer as ArrayBuffer] : [],
    );
  } catch (error) {
    if(kind==='stage'&&value?.frame?.pixels instanceof Uint8Array)value.frame.pixels.fill(0);
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
