const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
  const output=path.resolve('work/markdown-preview-smoke');
  await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-'));
  const files=await fs.mkdtemp(path.join(output,'files-'));
  const linkURL=process.env.ONE_LINK_METADATA_URL||'https://example.com/docs';
  const sample=`---\ntitle: Example\ntags: [one, markdown]\n---\n# Markdown 标题\n\n这是 **正文**。参见 [Example](${linkURL})。\n\n$$E = mc^2$$\n\n\`\`\`typescript\nconst answer: number = 42;\n\`\`\`\n\n- 列表中的代码\n\n  \`\`\`python\n  print('ok')\n  \`\`\`\n\n| 名称 | 数值 |\n| --- | --- |\n| Alpha | 42 |\n\n![像素图片](pixel.png)\n\n![第二张图片](pixel2.png)\n`;
  await fs.writeFile(path.join(files,'sample.md'),sample);
  await fs.writeFile(path.join(files,'sample.mdx'),sample+'\n<MyWidget label="安全" />\n\n<script>window.compromised = true</script>\n');
  await fs.writeFile(path.join(files,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=','base64'));
  await fs.copyFile(path.join(files,'pixel.png'),path.join(files,'pixel2.png'));
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.')],env});
  const errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
  const open=async(file)=>{const main=await app.firstWindow();const event=app.waitForEvent('window');await main.evaluate(value=>window.one.preview(value),file);const preview=await event;await expect(preview.locator('#preview-name')).toHaveText(path.basename(file));await expect(preview.frameLocator('iframe').locator('.markdown-content')).toBeVisible();if(await preview.locator('#preview-hold').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-hold').click();return preview;};
  try{
    let preview=await open(path.join(files,'sample.md'));
    const frame=preview.frameLocator('iframe');
    await expect(frame.locator('.frontmatter')).toContainText('Example');
    await expect(frame.locator('.frontmatter-toggle svg')).toHaveCount(1);
    await frame.locator('.frontmatter-toggle').click();await expect(frame.locator('.frontmatter-toggle')).toHaveAttribute('aria-expanded','false');
    await preview.waitForTimeout(300);assert.ok((await frame.locator('.frontmatter').boundingBox()).height<52);
    await frame.locator('.frontmatter-toggle').click();await expect(frame.locator('.frontmatter-toggle')).toHaveAttribute('aria-expanded','true');
    await expect(frame.locator('h1')).toHaveText('Markdown 标题');
    await expect(frame.locator('.katex')).toBeVisible();
    await expect(frame.locator('.code-toolbar').first()).toContainText('typescript');
    await expect(frame.locator('.hljs-keyword')).toContainText('const');
    assert.equal(await frame.locator('li .code-block code').evaluate(code=>getComputedStyle(code).borderTopWidth),'0px');
    await frame.locator('a[data-external-url]').evaluate(link=>link.scrollIntoView({block:'center'}));
    await preview.waitForTimeout(350);await preview.mouse.move(370,120);
    await frame.locator('a[data-external-url]').hover({force:true});
    await preview.waitForTimeout(300);assert.equal(await frame.locator('.link-card').isVisible(),false);
    await expect(frame.locator('.link-card')).toBeVisible();
    await expect(frame.locator('.link-card')).toContainText(new URL(linkURL).hostname);
    const linkMetadata=process.env.ONE_LINK_METADATA_URL?await preview.evaluate(url=>window.one.previewLinkCard(url),process.env.ONE_LINK_METADATA_URL):undefined;
    if(linkMetadata){assert.ok(linkMetadata.title&&linkMetadata.description&&linkMetadata.image,JSON.stringify(linkMetadata));await expect(frame.locator('.link-card-main p')).toContainText(linkMetadata.description.slice(0,35));await expect(frame.locator('.link-card-main img')).toBeVisible();await preview.screenshot({path:path.join(output,'link-card.png')});}
    await expect(frame.locator('.table-scroll table')).toContainText('Alpha');
    await expect.poll(()=>frame.locator('.markdown-image img').first().evaluate(image=>image.naturalWidth)).toBe(1);
    await frame.locator('.markdown-image img').first().evaluate(image=>image.click());
    await expect(frame.locator('.markdown-lightbox')).toBeVisible();
    await expect(frame.locator('.lightbox-count')).toHaveText('1 / 2');
    await frame.locator('[data-gallery-action=next]').click();
    await expect(frame.locator('.lightbox-count')).toHaveText('2 / 2');
    const layout=await frame.locator('.markdown-lightbox').evaluate(root=>{const thumbs=root.querySelector('.lightbox-thumbs'),controls=root.querySelector('.lightbox-controls');return {thumbBottom:thumbs.getBoundingClientRect().bottom,controlTop:controls.getBoundingClientRect().top,thumbOverflow:thumbs.scrollHeight-thumbs.clientHeight};});
    assert.ok(layout.controlTop>=layout.thumbBottom&&layout.thumbOverflow<=1,JSON.stringify(layout));
    await preview.screenshot({path:path.join(output,'lightbox.png')});
    await frame.locator('[data-gallery-action=close]').click();
    await expect(frame.locator('.markdown-lightbox')).toBeHidden();
    await frame.locator('.code-copy').first().click();
    await expect(frame.locator('.code-copy').first()).toHaveText('已复制');
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toMatch(/const answer: number = 42/);
    const math=await frame.locator('.katex').first().evaluate(element=>({font:getComputedStyle(element).fontFamily,html:element.innerHTML.length}));
    assert.match(math.font,/KaTeX/);
    await preview.screenshot({path:path.join(output,'markdown.png')});
    await preview.close();
    preview=await open(path.join(files,'sample.mdx'));
    const mdx=preview.frameLocator('iframe');
    await expect(mdx.locator('.mdx-source').first()).toContainText('<MyWidget label="安全" />');
    assert.equal(await preview.evaluate(()=>window.compromised),undefined);
    assert.equal(await mdx.locator('script').count(),0);
    await preview.locator('#toggle-source').click();await expect(preview.locator('.cm-content')).toContainText('<MyWidget');
    await preview.close();
    const largeFile=process.env.ONE_LARGE_MDX;
    let large;
    if(largeFile){
      const start=Date.now();preview=await open(largeFile);large={size:(await fs.stat(largeFile)).size,readyMs:Date.now()-start,math:await preview.frameLocator('iframe').locator('.katex').count(),headings:await preview.frameLocator('iframe').locator('h1,h2,h3').count()};
      assert.ok(large.math>0&&large.headings>0,JSON.stringify(large));
      const scroll=await preview.frameLocator('iframe').locator('body').evaluate(body=>{const scroller=body.ownerDocument.scrollingElement;scroller.scrollTop=scroller.scrollHeight;return {top:scroller.scrollTop,height:scroller.scrollHeight};});
      assert.ok(scroll.top>0,JSON.stringify(scroll));
      await expect.poll(()=>preview.frameLocator('iframe').locator('img[src*="rlhf-vs.-rlvr.png"]').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
      await preview.frameLocator('iframe').locator('.markdown-content img').last().evaluate(image=>image.click());
      await expect(preview.frameLocator('iframe').locator('.lightbox-count')).toHaveText(/\d+ \/ 27/);
      await preview.frameLocator('iframe').locator('[data-gallery-action=close]').click();
      await preview.screenshot({path:path.join(output,'large-mdx.png')});
      await preview.close();
    }
    const galleryFile=process.env.ONE_GALLERY_MDX;
    if(galleryFile){preview=await open(galleryFile);const picture=preview.frameLocator('iframe');const imageCount=await picture.locator('.markdown-content img').count();assert.ok(imageCount>1);await picture.locator('.markdown-content img').first().evaluate(image=>image.click());await expect(picture.locator('.lightbox-thumb')).toHaveCount(imageCount);const centered=await picture.locator('.lightbox-thumbs').evaluate(row=>{const first=row.firstElementChild.getBoundingClientRect(),last=row.lastElementChild.getBoundingClientRect(),bounds=row.getBoundingClientRect();return Math.abs((first.left+last.right)/2-(bounds.left+bounds.right)/2);});assert.ok(centered<3,`缩略图没有居中：${centered}`);await preview.screenshot({path:path.join(output,'gallery-real.png')});await expect.poll(()=>picture.locator('.lightbox-stage img').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);await picture.locator('[data-gallery-action=zoom-in]').click();const zoom15=await picture.locator('.lightbox-stage img').evaluate(image=>parseFloat(image.style.width));await picture.locator('[data-gallery-action=zoom-in]').click();const zoom20=await picture.locator('.lightbox-stage img').evaluate(image=>parseFloat(image.style.width));assert.ok(Math.abs(zoom20/zoom15-4/3)<.01,`缩放比例异常：${zoom15} → ${zoom20}`);await preview.close();}
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',math,linkMetadata:linkMetadata&&{domain:linkMetadata.domain,title:linkMetadata.title,description:linkMetadata.description,image:!!linkMetadata.image},large,output},null,2));
  }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
