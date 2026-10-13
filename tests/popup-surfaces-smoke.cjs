const { _electron: electron } = require('@playwright/test');
const { build } = require('esbuild');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');

// Each entry represents a distinct production surface, including legacy panels
// without a popover attribute. Load every production stylesheet to catch overrides.
const surfaces = [
  ['标准对话框','main','one-dialog','dialog'],
  ['文本查看','main','one-dialog text-value-dialog','dialog'],
  ['自定义截屏','main','one-dialog custom-capture-dialog','dialog'],
  ['聊天图片','ai-chat','chat-image-dialog','dialog'],
  ['GIF 画质','recording-player','','dialog','gif-quality-dialog'],
  ['公共弹层','main','one-popover'], ['下拉菜单','main','select-popup'],
  ['字体菜单','main','select-popup font-popup'], ['日期选择','main','custom-date-popup'],
  ['时间选择','main','custom-time-popup'], ['颜色选择','main','color-picker-panel'],
  ['AI 模型','ai-chat','model-picker clip-popover'], ['会话重命名','ai-chat','chat-rename-popup'],
  ['压缩包菜单','main','archive-more-menu'], ['截图输出','capture','capture-panel capture-menu one-popover'],
  ['截图工具','capture','capture-tool-menu'], ['图片工具','image-editor','capture-tool-menu'],
  ['截图水印内容','capture','watermark-menu watermark-menu-content one-popover'],
  ['截图水印文字','capture','watermark-menu watermark-menu-type one-popover'],
  ['截图水印布局','capture','watermark-menu watermark-menu-layout one-popover'],
  ['图片水印','image-editor','watermark-menu one-popover'],
  ['输出效果','image-editor','image-properties capture-menu one-popover'],
  ['图片更多操作','image-editor','editor-actions-menu one-popover'],
  ['录制属性','recording-toolbar','capture-menu capture-tool-menu one-popover'],
  ['录制设置','recording-player','recording-settings-menu one-popover'],
  ['录制更多操作','recording-player','editor-actions-menu one-popover'],
  ['贴图操作','main','pins-action-menu one-popover'], ['确认气泡','main','confirmation-popover'],
  ['路径锁定','file-action','lock-path-popover'], ['命令选择','main','command-picker'],
  ['菜单添加','main','menu-add-popup'], ['预览打开方式','preview','preview-open-popover'],
  ['反馈提示','main','feedback-toast'], ['贴图提示','pin','','div','toast'],
  ['磁盘菜单','main','disk-context','legacy'], ['磁盘提示','main','map-tooltip','legacy'],
  ['面包屑菜单','main','breadcrumb-menu','legacy'], ['标尺菜单','main','color-ruler-menu','legacy'],
  ['文件选择选项','picker','picker-options','legacy'], ['位置选择','main','echo-position-panel','legacy'],
  ['普通通知','main','toast','legacy'], ['辅助搜索面板','dialog-bar','dialog-companion-shell','surface'],
  ['菜单预览','main','menu-preview-surface shortcut-menu','surface'],
  ['悬停提示','main','one-tooltip visible','surface'],
];

(async()=>{
  const root=path.resolve('work/current/ui-popup-unification');await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'fixture-'));
  const assetName='popup-test-'+path.basename(profile)+'.js',asset=path.resolve('dist/renderer/assets',assetName);
  const bundle=await build({stdin:{contents:`export {openAnchoredPopover,closeAnchoredPopover} from './src/renderer/anchored-popover';export {openDialog,closeDialog} from './src/renderer/dialog';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'popupTest',write:false,loader:{'.css':'empty'},logLevel:'silent'});
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try{
    await fs.writeFile(asset,bundle.outputFiles[0].text,{flag:'wx'});
    const nativeEntry=path.join(profile,'popup-motion.cjs');
    await build({entryPoints:['src/main/popup-window-motion.ts'],outfile:nativeEntry,bundle:true,platform:'node',external:['electron'],logLevel:'silent'});
    app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.one);
    const assets=path.resolve('dist/renderer/assets'),seen=new Set(),styles=[];
    async function dependencies(source){
      for(const match of source.matchAll(/["'](?:\.\/)?(?:assets\/)?([\w.-]+\.(?:js|css))["']/g)){
        const name=match[1];if(seen.has(name))continue;seen.add(name);
        const file=path.join(assets,name);try{await fs.access(file);}catch{continue;}
        if(name.endsWith('.css'))styles.push(name);else await dependencies(await fs.readFile(file,'utf8'));
      }
    }
    await dependencies(await fs.readFile('dist/renderer/index.html','utf8'));
    assert(styles.length>5,'Expected the active lazy-loaded feature stylesheets');
    await page.evaluate(async styles=>{await Promise.all(styles.map(file=>new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='one://app/assets/'+file;link.onload=resolve;link.onerror=reject;document.head.append(link);})));},styles);
    await page.addScriptTag({url:'one://app/assets/'+assetName});
    // Exercise the delegated tooltip, including its reduced-motion transition.
    await page.evaluate(()=>{const button=document.createElement('button');button.id='popup-tooltip-test';button.title='统一提示样式';button.textContent='提示';button.style.cssText='position:fixed;left:500px;top:100px';document.body.append(button);});
    await page.locator('#popup-tooltip-test').hover();await page.waitForSelector('#one-tooltip.visible');
    const tooltip=await page.locator('#one-tooltip').evaluate(node=>({text:node.textContent,transition:getComputedStyle(node).transitionDuration}));
    assert.equal(tooltip.text,'统一提示样式');assert.equal(tooltip.transition,'0.18s, 0.18s');
    await page.emulateMedia({reducedMotion:'reduce'});assert(await page.locator('#one-tooltip').evaluate(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0)));
    await page.evaluate(()=>document.getElementById('popup-tooltip-test').remove());
    const reports=[];
    for(const reduced of [false,true]){
      await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
      for(const theme of ['light','dark'])for(const zoom of [1,1.5]){
        await page.evaluate(async theme=>{await window.one.patchSettings({appearance:{mode:theme}});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},theme);
        const rows=await page.evaluate(({surfaces,theme,zoom})=>{
          document.documentElement.dataset.theme=theme;document.body.style.zoom=String(zoom);
          const failures=[],rows=[];
          for(const [name,view,classes,kind='div',id] of surfaces){
            document.body.dataset.view=view;
            const node=document.createElement(kind==='dialog'?'dialog':'div');node.className=classes;if(id)node.id=id;
            node.textContent=name;node.style.cssText='position:fixed;inset:auto;left:40px;top:60px;width:260px;min-height:60px;padding:16px;';
            document.body.append(node);
            if(kind==='dialog')node.showModal();else if(!['legacy','surface'].includes(kind)){node.popover='manual';node.showPopover();}
            const style=getComputedStyle(node),probe=document.createElement('div');probe.style.cssText='border:var(--popup-border);box-shadow:var(--popup-shadow)';node.append(probe);
            const expected=getComputedStyle(probe);
            const entry={name,theme,zoom,border:style.borderTopWidth,borderStyle:style.borderTopStyle,shadow:style.boxShadow,background:style.backgroundColor,color:style.color,animation:style.animationName,duration:style.animationDuration};rows.push(entry);
            if(style.borderTopWidth!==expected.borderTopWidth||style.borderTopStyle!=='solid'||style.borderTopColor!==expected.borderTopColor||style.boxShadow!==expected.boxShadow)failures.push(entry);
            const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
            if(!['surface'].includes(kind)&&(reduced?style.animationName!=='none':style.animationName!=='one-popup-in'||style.animationDuration!=='0.18s'))failures.push(entry);
            if(kind==='dialog')node.close();node.remove();probe.remove();
          }
          return {rows,failures};
        },{surfaces,theme,zoom});
        reports.push(...rows.rows);
        if(rows.failures.length){await fs.writeFile(path.join(root,'failures.json'),JSON.stringify(rows,null,2));throw Error(`${rows.failures.length} popup checks failed: ${rows.failures.map(r=>r.name).join(', ')}; see failures.json`);}
      }
    }
    assert.notEqual(reports.find(r=>r.name==='标准对话框'&&r.theme==='light').background,reports.find(r=>r.name==='标准对话框'&&r.theme==='dark').background);
    // Interrupt/reopen the real shared motion controllers: no scale or stale hide.
    await page.emulateMedia({reducedMotion:'no-preference'});
    const motion=await page.evaluate(async()=>{
      document.body.style.zoom='1';document.body.dataset.view='main';
      const anchor=document.createElement('button'),panel=document.createElement('div');anchor.textContent='菜单';anchor.style.cssText='position:fixed;left:100px;top:100px';panel.className='one-popover';panel.textContent='选项';document.body.append(anchor,panel);
      popupTest.openAnchoredPopover(anchor,panel);const animation=panel.getAnimations()[0],frames=animation.effect.getKeyframes();
      const closing=popupTest.closeAnchoredPopover(panel);popupTest.openAnchoredPopover(anchor,panel);const closed=await closing;
      await Promise.all(panel.getAnimations().map(a=>a.finished));const visible=panel.matches(':popover-open');await popupTest.closeAnchoredPopover(panel);panel.remove();anchor.remove();
      const dialog=document.createElement('dialog');dialog.className='one-dialog';dialog.textContent='对话框';document.body.append(dialog);popupTest.openDialog(dialog);const close=popupTest.closeDialog(dialog);popupTest.openDialog(dialog);const dismissed=await close;const reopened=dialog.open;await popupTest.closeDialog(dialog);dialog.remove();
      return {duration:animation.effect.getTiming().duration,scaled:frames.some(f=>f.scale||f.transform),closed,visible,dismissed,reopened};
    });
    assert.deepEqual(motion,{duration:180,scaled:false,closed:false,visible:true,dismissed:false,reopened:true});
    const nativeChrome=await page.evaluate(()=>{
      document.body.classList.add('shortcut-menu-window');const root=document.createElement('div');root.className='shortcut-menu popup-enter';document.body.append(root);
      const style=getComputedStyle(root),result={border:style.borderTopWidth,shadow:style.boxShadow,animation:style.animationName};root.remove();document.body.classList.remove('shortcut-menu-window');return result;
    });
    assert.deepEqual(nativeChrome,{border:'0px',shadow:'none',animation:'none'});
    const native=await app.evaluate(async({BrowserWindow},entry)=>{
      const {bindPopupWindowMotion,popupWindowRoles}=process.getBuiltinModule('module').createRequire(entry)(entry);
      const window=new BrowserWindow({width:260,height:140,show:false,frame:false,skipTaskbar:true,hasShadow:true});
      let reduced=false;bindPopupWindowMotion(window,()=>reduced);await window.loadURL('about:blank');
      try{
        const initial=window.getOpacity();window.showInactive();await new Promise(r=>setTimeout(r,65));const midway=window.getOpacity();
        window.hide();const hidden=window.getOpacity();window.showInactive();await new Promise(r=>setTimeout(r,240));const reopened=window.getOpacity();
        window.hide();reduced=true;window.showInactive();const immediate=window.getOpacity();
        return {initial,midway,hidden,reopened,immediate,shadow:window.hasShadow(),roles:[...popupWindowRoles]};
      }finally{window.destroy();}
    },nativeEntry);
    assert(native.initial<.01&&native.midway>0&&native.midway<1&&native.hidden<.01);
    assert.equal(native.reopened,1);assert.equal(native.immediate,1);assert.equal(native.shadow,true);
    for(const theme of ['light','dark']){
      await page.evaluate(async theme=>{await window.one.patchSettings({appearance:{mode:theme}});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},theme);
      await page.evaluate(async theme=>{
        document.documentElement.dataset.theme=theme;document.body.dataset.view='image-editor';document.body.style.zoom='1';document.getElementById('app').style.visibility='hidden';
        document.querySelectorAll('[data-popup-gallery]').forEach(n=>n.remove());
        const samples=[['dialog','one-dialog','<header class="one-dialog-heading"><h2>保存设置</h2></header><div class="one-dialog-body">弹窗共用细边框、轻阴影与淡入动画。</div><footer class="one-dialog-actions"><button>取消</button><button class="primary">保存</button></footer>',30,40,340],['div','one-popover capture-tool-menu','<button>矩形</button><button>圆角矩形</button><button>椭圆</button>',405,40,240],['div','watermark-menu one-popover','<div class="watermark-menu-header"><strong>水印内容</strong></div><label>文字<input value="One" aria-label="水印文字"></label>',405,205,240]];
        for(const [tag,cls,html,x,y,width] of samples){const n=document.createElement(tag);n.dataset.popupGallery='';n.className=cls;n.innerHTML=html;n.style.cssText=`position:fixed;inset:auto;margin:0;left:${x}px;top:${y}px;width:${width}px`;document.body.append(n);if(tag==='dialog')n.setAttribute('open','');else{n.popover='manual';n.showPopover();}}
        await Promise.all([...document.querySelectorAll('[data-popup-gallery]')].flatMap(n=>n.getAnimations().map(a=>a.finished)));
      },theme);
      await page.screenshot({path:path.join(root,`surfaces-${theme}.png`),clip:{x:0,y:0,width:680,height:380},scale:'css'});
    }
    await fs.writeFile(path.join(root,'surfaces.json'),JSON.stringify({surfaces:surfaces.length,stylesheets:styles.length,checks:reports.length,motion,native,reports},null,2));
    await fs.rm(path.join(root,'failures.json'),{force:true});
    console.log(`Popup surfaces PASS: ${surfaces.length} surfaces, ${reports.length} theme/zoom/motion checks, interrupted reopen`);
  }finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    await fs.rm(asset,{force:true});const actual=await fs.realpath(profile);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
