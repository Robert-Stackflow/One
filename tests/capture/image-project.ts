import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ImageHistory, transformImage, type Annotation } from '../../src/shared/capture/image-document';
import { imageProject, IMAGE_PROJECT_METADATA_BYTES } from '../../src/shared/capture/image-project';
import { readImageProject, writeImageProject } from '../../src/main/capture/image-project';
import { IMAGE_PROJECT_FORMAT } from '../../src/shared/media-project';
import type {ImageTranslationDocument} from '../../src/shared/recognition/image-translation';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4WQAAAAASUVORK5CYII=',
  'base64',
);
const mark: Annotation = {
  id: 'editable',
  tool: 'text',
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
  points: [],
  text: '仍可编辑',
  color: '#ff0000',
  width: 1,
  strength: 8,
  number: 1,
};
test('translated image projects preserve original PNG and editable revisions, while v1 cannot claim the new layer',()=>fixture(async directory=>{
  const layer:ImageTranslationDocument={schema:1,id:'layer',sourceId:'ocr',recognitionRevision:1,translationId:'job',width:1,height:1,target:'en',serviceRevision:'service',version:0,blocks:[{id:'block',source:'原文',text:'Text',rect:{x:0,y:0,width:1,height:1},glyphs:[[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]],fontSize:9,status:'ready'}]};
  const base=new ImageHistory(1,1,true).value,original={...base,translation:{visible:true,document:layer}},current={...original,translation:{visible:false,document:{...layer,version:1,blocks:layer.blocks.map(block=>({...block,text:'Edited'}))}}};
  const project=imageProject({format:'one-image',version:2,name:'Translation',document:current,history:{past:[original],future:[]}},base.original),file=join(directory,'translation.oneimage');
  await writeImageProject(file,project,png);const loaded=await readImageProject(file);assert.deepEqual(loaded.png,png);assert.deepEqual(loaded.project,project);
  const history=new ImageHistory(1,1,true);history.restore(loaded.project.document,loaded.project.history);history.undo();assert.equal(history.value.translation!.document.blocks[0].text,'Text');history.redo();assert.equal(history.value.translation!.document.blocks[0].text,'Edited');assert.equal(history.value.translation!.visible,false);
  assert.throws(()=>imageProject({...project,version:1},base.original),/新版图片工程/);
  const conflicting={...original,translation:{visible:true,document:{...layer,blocks:layer.blocks.map(block=>({...block,text:'Same version, different text'}))}}};
  assert.throws(()=>imageProject({...project,history:{past:[original,conflicting],future:[]}},base.original),/版本不一致/);
  assert.throws(()=>imageProject({...project,document:{...current,translation:{...current.translation,document:{...current.translation.document,apiKey:'must-not-be-stored'}}}},base.original),/文字层无效/);
  assert.throws(()=>imageProject({...project,document:{...current,translation:{...current.translation,document:{...layer,blocks:[{...layer.blocks[0],glyphs:[[{x:-1,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]]}]}}}},base.original),/文字位置无效/);
}));
test('One image identity rejects old products and unknown schemas even when renamed', () =>
  fixture(async (directory) => {
    const file = join(directory, 'identity.oneimage');
    const project = imageProject({
      format: 'one-image', version: 1, name: 'One',
      document: new ImageHistory(1, 1, true).value,
    }, {width: 1, height: 1});
    await writeImageProject(file, project, png);
    const original = await readFile(file);
    assert.equal(original.toString('ascii', 0, 8), IMAGE_PROJECT_FORMAT.magic);
    const end = 12 + original.readUInt32LE(8);
    const manifest = JSON.parse(original.toString('utf8', 12, end));
    assert.equal(manifest.project.format, 'one-image');
    for (const identity of ['FRAMEIMG', 'ONERECRD']) {
      const invalid = Buffer.from(original);
      invalid.write(identity, 0, 'ascii');
      await writeFile(file, invalid);
      await assert.rejects(readImageProject(file), /不是 One 图片工程/);
    }
    for (const patch of [{format: undefined}, {format: 'frame-image'}, {version: 0}, {version: 3}]) {
      const metadata = Buffer.from(JSON.stringify({
        ...manifest, project: {...manifest.project, ...patch},
      }));
      const header = Buffer.from(original.subarray(0, 12));
      header.writeUInt32LE(metadata.length, 8);
      await writeFile(file, Buffer.concat([header, metadata, original.subarray(end)]));
      await assert.rejects(readImageProject(file), /信息无效或版本不支持/);
    }
  }));
test('saved image projects restore the complete undo and redo branches beyond 60 edits', () =>
  fixture(async (directory) => {
    const history = new ImageHistory(1, 1, true),
      initial = history.value;
    for (let index = 0; index < 80; index++)
      history.commit({ ...history.value, annotations: [{ ...mark, text: 'Edit ' + index }] });
    history.undo();
    history.undo();
    const saved = history.value,
      snapshot = history.snapshot;
    const file = join(directory, 'history.oneimage');
    await writeImageProject(
      file,
      { format: 'one-image', version: 1, name: 'History', document: saved, history: snapshot },
      png,
    );
    const project = (await readImageProject(file)).project;
    assert.deepEqual(project.history, snapshot);
    const reopened = new ImageHistory(1, 1, true);
    reopened.restore(project.document, project.history);
    reopened.redo();
    reopened.redo();
    assert.equal(reopened.value.annotations[0].text, 'Edit 79');
    for (let index = 0; index < 80; index++) reopened.undo();
    assert.deepEqual(reopened.value, initial);
    assert.equal(reopened.canUndo, false);
    assert.equal(reopened.canRedo, true);
    reopened.commit({ ...initial, annotations: [mark] });
    assert.equal(reopened.canRedo, false);
    assert.throws(
      () =>
        imageProject({ ...project, history: { past: [{}], future: [] } }, { width: 1, height: 1 }),
      /原图/,
    );
  }));
async function fixture(run: (directory: string) => Promise<void>) {
  const root = resolve(process.env.ONE_UNIT_OUTPUT_DIR || 'work/current/capture-migration');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'image-project-unit-'));
  try {
    await run(directory);
  } finally {
    const target = await realpath(directory);
    assert.ok(target.startsWith(root + sep) && target === directory);
    await rm(target, { recursive: true, force: true });
  }
}
test('image projects preserve original bytes, editable geometry/effects and a fresh undo baseline', () =>
  fixture(async (directory) => {
    const history = new ImageHistory(1, 1, true);
    history.commit({ ...history.value, annotations: [mark] });
    history.commit(transformImage(history.value, 'rotate'));
    history.commit(transformImage(history.value, 'flipY'));
    const value = imageProject(
      { format: 'one-image', version: 1, name: '可编辑工程', document: history.value },
      { width: 1, height: 1 },
    );
    const file = join(directory, 'roundtrip.oneimage');
    await writeImageProject(file, value, png);
    const reopened = await readImageProject(file);
    assert.deepEqual(reopened.project, value);
    assert.deepEqual(reopened.png, png);
    const restored = new ImageHistory(1, 1, true);
    restored.restore(reopened.project.document);
    assert.equal(restored.canUndo, false);
    restored.commit({ ...restored.value, annotations: [] });
    restored.undo();
    assert.deepEqual(restored.value, value.document);
    restored.redo();
    assert.equal(restored.value.annotations.length, 0);
    assert.throws(() => imageProject({ ...value, version: 3 }, { width: 1, height: 1 }), /版本/);
    assert.throws(
      () =>
        imageProject(
          { ...value, document: { ...value.document, original: { width: 2, height: 1 } } },
          { width: 1, height: 1 },
        ),
      /原图/,
    );
  }));
test('image project corruption, bounded reads, cancellation and competing targets never replace valid originals', () =>
  fixture(async (directory) => {
    const file = join(directory, 'original.oneimage'),
      corrupt = join(directory, 'corrupt.oneimage');
    const value = imageProject(
      { format: 'one-image', version: 1, name: 'Original', document: new ImageHistory(1, 1, true).value },
      { width: 1, height: 1 },
    );
    await writeImageProject(file, value, png);
    const original = await readFile(file);
    for (const kind of ['magic', 'metadata', 'hash', 'truncated', 'version']) {
      let data = Buffer.from(original);
      if (kind === 'magic') data[0] = 0;
      if (kind === 'metadata') data.writeUInt32LE(IMAGE_PROJECT_METADATA_BYTES + 1, 8);
      if (kind === 'hash') data[data.length - 1] ^= 255;
      if (kind === 'truncated') data = data.subarray(0, data.length - 1);
      if (kind === 'version') {
        const end = 12 + data.readUInt32LE(8);
        const manifest = JSON.parse(data.toString('utf8', 12, end));
        manifest.project.version = 3;
        const metadata = Buffer.from(JSON.stringify(manifest)),
          header = Buffer.from(data.subarray(0, 12));
        header.writeUInt32LE(metadata.length, 8);
        data = Buffer.concat([header, metadata, data.subarray(end)]);
      }
      await writeFile(corrupt, data);
      await assert.rejects(readImageProject(corrupt), kind);
    }
    let checks = 0;
    await assert.rejects(
      writeImageProject(file, value, png, () => ++checks < 3),
      /取消/,
    );
    assert.deepEqual(await readFile(file), original);
    await writeImageProject(file, { ...value, name: 'Updated' }, png);
    assert.equal((await readImageProject(file)).project.name, 'Updated');
    checks = 0;
    await assert.rejects(
      writeImageProject(file, value, png, () => {
        if (++checks === 2) writeFileSync(file, 'concurrent write');
        return true;
      }),
      /目标文件已改变/,
    );
    assert.equal(await readFile(file, 'utf8'), 'concurrent write');
    const created = join(directory, 'competing.oneimage');
    checks = 0;
    await assert.rejects(
      writeImageProject(created, value, png, () => {
        if (++checks === 2) writeFileSync(created, 'created elsewhere');
        return true;
      }),
      /已存在/,
    );
    assert.equal(await readFile(created, 'utf8'), 'created elsewhere');
    await writeImageProject(corrupt, value, png);
    checks = 0;
    await assert.rejects(
      readImageProject(corrupt, () => ++checks < 2),
      /取消/,
    );
    assert.equal(
      (await readdir(directory)).some((name) => name.endsWith('.part')),
      false,
    );
  }));
