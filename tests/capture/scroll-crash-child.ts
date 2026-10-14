import {createScrollDirectory,ScrollDiskStorage} from '../../src/main/capture/scroll-storage';
void createScrollDirectory(process.argv[2]).then(lease=>{
  new ScrollDiskStorage(lease.directory,lease.token).put(new Uint8Array(64).fill(255));
  process.stdout.write(JSON.stringify(lease)+'\n');setInterval(()=>{},1000);
}).catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
