import { parentPort } from 'node:worker_threads';
// Tesseract.js 7.0.0 initializes Lang[] with l.data instead of l.code.
// Keep verified model bytes in memory; normalize only the initialize message.
parentPort!.on('message', (packet) => {
  if (packet.action !== 'initialize' || !Array.isArray(packet.payload?.langs)) return;
  packet.payload.langs = packet.payload.langs
    .map((lang: unknown) => {
      const code = typeof lang === 'string' ? lang : (lang as { code?: unknown })?.code;
      if (code !== 'eng' && code !== 'chi_sim') throw Error('Unsupported OCR language');
      return code;
    })
    .join('+');
});
require('tesseract.js/src/worker-script/node/index.js');
