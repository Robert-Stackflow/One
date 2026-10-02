import './build.mjs';
import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const processHandle = spawn(electron, ['.'], { stdio: 'inherit', env });
processHandle.on('exit', code => process.exit(code ?? 0));
