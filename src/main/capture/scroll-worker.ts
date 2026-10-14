import { parentPort } from 'node:worker_threads';
import { ScrollStitch } from '../../shared/capture/scroll-stitch';
import { ScrollSettle } from '../../shared/capture/scroll-settle';
let engine = new ScrollStitch();
let settling: ScrollSettle;
parentPort!.on('message', ({ id, kind, value }) => {
  try {
    let result;
    if (kind === 'configure'||kind==='restart') {
      if(kind==='restart')engine=new ScrollStitch();
      result = engine.configure(value.options, value.source);
      settling = new ScrollSettle(value.options, value.source);
    } else if (kind === 'settle-reset' || kind === 'observe') {
      if (!settling) throw Error('长截图尚未设置');
      if (kind === 'settle-reset') settling.reset();
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
    const preview = engine.preview();
    parentPort!.postMessage(
      { id, result, preview },
      preview ? [preview.pixels.buffer as ArrayBuffer] : [],
    );
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
