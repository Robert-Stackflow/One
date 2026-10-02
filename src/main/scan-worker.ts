import { parentPort, workerData } from 'node:worker_threads';
import { scanDirectory } from './scan';
const cancellation = new Int32Array(workerData.cancellation);
scanDirectory(workerData.path, progress => parentPort?.postMessage({ progress }), () => Atomics.load(cancellation, 0) === 1)
  .then(({ root, files, directories, issues }) => parentPort?.postMessage({ result: { rootPath: root.path, bytes: root.size, files, directories, issues } }), error => parentPort?.postMessage({ error: String(error.message ?? error) }));
