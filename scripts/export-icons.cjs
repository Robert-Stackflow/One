const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const directory = path.resolve('assets/icons');
  const sources = { regular: await fs.readFile(path.join(directory,'one.svg'),'utf8'), small: await fs.readFile(path.join(directory,'one-small.svg'),'utf8') };
  const env = {...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.resolve('work/icon-export-profile')}; delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ args: [path.resolve('.')], env });
  try {
    const page = await application.firstWindow();
    const sizes = [16,20,24,28,32,36,40,48,56,64,96,128,256,512,1024];
    const pngs = [];
    for (const size of sizes) {
      const result = await page.evaluate(async ({source,size}) => {
        const image = new Image(); image.src = 'data:image/svg+xml;base64,'+btoa(source); await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d'); context.drawImage(image,0,0,size,size);
        const alpha = context.getImageData(0,0,size,size).data;
        return {png:canvas.toDataURL('image/png').split(',')[1],corner:alpha[3],center:alpha[(Math.floor(size/2)*size+Math.floor(size/2))*4+3]};
      },{source:size<=24?sources.small:sources.regular,size});
      assert.equal(result.corner,0); assert.equal(result.center,255);
      const png = Buffer.from(result.png,'base64');await fs.writeFile(path.join(directory,`one-${size}.png`),png);pngs.push({size,png});
    }
    const images = pngs.filter(image=>image.size<=256), header = Buffer.alloc(6+images.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
    let offset = header.length;
    images.forEach(({size,png},i)=>{const entry=6+i*16;header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(png.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=png.length;});
    await fs.writeFile(path.join(directory,'one.ico'),Buffer.concat([header,...images.map(image=>image.png)]));
    console.log(JSON.stringify({sizes,icoFrames:images.length,transparentExterior:true,opaqueCenter:true,directory}));
  } finally { await application.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
