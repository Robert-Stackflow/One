const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const directory = path.resolve('assets/icons');
  const source = await fs.readFile(path.join(directory,'one.svg'),'utf8');
  const env = {...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.resolve('work/icon-export-profile')}; delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ args: [path.resolve('.')], env });
  try {
    const page = await application.firstWindow();
    const sizes = [16,20,24,28,30,32,36,40,48,56,64,96,128,256,512,1024];
    const pngs = [];
    for (const size of sizes) {
      const result = await page.evaluate(async ({source,size}) => {
        const image = new Image(); image.src = 'data:image/svg+xml;base64,'+btoa(source); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d'); context.drawImage(image,0,0,size,size);
        const alpha = context.getImageData(0,0,size,size).data;
        let taskbarPng;
        if (size <= 64) {
          const input = context.getImageData(0,0,size,size);
          const output = context.createImageData(size,size);
          const weights = [1,2,1,2,4,2,1,2,1];
          for (let y=0;y<size;y++) for (let x=0;x<size;x++) for (let channel=0;channel<4;channel++) {
            let blurred=0,weightIndex=0;
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
              const px=Math.max(0,Math.min(size-1,x+dx)),py=Math.max(0,Math.min(size-1,y+dy));
              blurred+=input.data[(py*size+px)*4+channel]*weights[weightIndex++];
            }
            const index=(y*size+x)*4+channel,value=input.data[index];
            output.data[index]=Math.max(0,Math.min(255,Math.round(value+1.5*(value-blurred/16))));
          }
          const taskbar=document.createElement('canvas');taskbar.width=size;taskbar.height=size;
          taskbar.getContext('2d').putImageData(output,0,0);
          taskbarPng=taskbar.toDataURL('image/png').split(',')[1];
        }
        return {png:canvas.toDataURL('image/png').split(',')[1],taskbarPng,corner:alpha[3],center:alpha[(Math.floor(size/2)*size+Math.floor(size/2))*4+3]};
      },{source,size});
      assert.equal(result.corner,0); assert.equal(result.center,255);
      const png = Buffer.from(result.png,'base64');await fs.writeFile(path.join(directory,`one-${size}.png`),png);
      const taskbarPng=result.taskbarPng?Buffer.from(result.taskbarPng,'base64'):png;
      if(result.taskbarPng)await fs.writeFile(path.join(directory,`one-taskbar-${size}.png`),taskbarPng);
      pngs.push({size,png:taskbarPng});
    }
    const images = pngs.filter(image=>image.size<=256), header = Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
    let offset = header.length;
    images.forEach(({size,png},i)=>{const entry=6+i*16;header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(png.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=png.length;});
    await fs.writeFile(path.join(directory,'one.ico'),Buffer.concat([header,...images.map(image=>image.png)]));
    console.log(JSON.stringify({sizes,icoFrames:images.length,transparentExterior:true,opaqueCenter:true,directory}));
  } finally { await application.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
