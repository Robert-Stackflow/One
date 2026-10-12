import { parentPort } from 'node:worker_threads';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

interface Frame {
  rgba: Uint8Array;
  width: number;
  height: number;
  colors: number;
  delay: number;
  repeat: number;
  first: boolean;
  last: boolean;
  optimize: boolean;
}
let pending: Frame | undefined,
  emitted = 0;
function encode(frame: Frame, last: boolean) {
  const palette = quantize(frame.rgba, frame.colors),
    pixels = applyPalette(frame.rgba, palette),
    encoder = GIFEncoder({ auto: false });
  if (!emitted) encoder.writeHeader();
  encoder.writeFrame(pixels, frame.width, frame.height, {
    first: emitted === 0,
    palette,
    delay: frame.delay * 10,
    repeat: frame.repeat,
    colorDepth: Math.max(2, Math.ceil(Math.log2(palette.length))),
  });
  emitted++;
  if (last) encoder.finish();
  return encoder.bytesView();
}
function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}
/** Quantization runs outside Electron's main thread; only one pending frame is retained. */
parentPort!.on('message', (job: Frame) => {
  try {
    const chunks: Uint8Array[] = [];
    if (!job.optimize) chunks.push(encode(job, job.last));
    else {
      if (pending && pending.delay + job.delay <= 65535 && same(pending.rgba, job.rgba))
        pending.delay += job.delay;
      else {
        if (pending) chunks.push(encode(pending, false));
        pending = job;
      }
      if (job.last) {
        chunks.push(encode(pending!, true));
        pending = undefined;
      }
    }
    const bytes =
      chunks.length === 1
        ? chunks[0]
        : new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    if (chunks.length > 1) {
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    }
    parentPort!.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort!.postMessage({ error: (error as Error).message });
  }
});
