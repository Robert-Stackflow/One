import { app } from 'electron';
import { paddleWorkerBench } from './paddle-worker-runtime';
app.setPath('userData', process.env.ONE_PADDLE_PROFILE!);
app.disableHardwareAcceleration();
void app.whenReady().then(() => paddleWorkerBench(process.env.ONE_PADDLE_PROBE_ROOT!))
  .then(() => app.exit(0), error => { console.error(String(error)); app.exit(1); });
