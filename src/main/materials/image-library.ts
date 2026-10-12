import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { imageDimensions } from '../../shared/capture/image-limits';
import type { ImageMaterial, ImageMaterialDetail } from '../../shared/materials';
import type { ImageDocument } from '../../shared/capture/image-document';
import {MATERIAL_INDEX_FORMAT} from '../../shared/materials';
import {IMAGE_PROJECT_FORMAT} from '../../shared/media-project';
import {atomicWrite} from './atomic-file';
const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export class ImageMaterialLibrary {
  private assets: ImageMaterial[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private thumbnail: (png: Buffer) => Buffer,
    private saveProject: (
      asset: ImageMaterial,
      png: Buffer,
      document?: ImageDocument,
      original?: Buffer,
      history?: import('../../shared/capture/image-document').ImageHistoryState,
    ) => Promise<void>,
    private changed:()=>void=()=>{},
  ) {}
  private file(id: string, suffix = '.png') {
    if (!validId(id)) throw Error('素材不存在');
    return join(this.directory, id + suffix);
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.assets=[];
    try {
      if((await stat(join(this.directory,'index.json'))).size>16*1024*1024)throw Error('素材索引过大');
      const data = JSON.parse(await readFile(join(this.directory, 'index.json'), 'utf8'));
      if (data.format!==MATERIAL_INDEX_FORMAT.images||data.version !== 1 || !Array.isArray(data.assets) || data.assets.length > 2000)
        throw Error('素材索引损坏');
      const ids = new Set();
      for (const a of data.assets) {
        if (
          !a ||
          !validId(a.id) ||
          ids.has(a.id) ||
          typeof a.title !== 'string' ||
          a.title.length > 200 ||
          !Number.isSafeInteger(a.created) ||
          a.created < 0 ||
          !Number.isSafeInteger(a.bytes) ||
          a.bytes < 1 ||
          a.bytes > 64 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(a.hash) ||
          !['capture', 'clipboard', 'file', 'edit'].includes(a.source)
        )
          throw Error('素材索引损坏');
        imageDimensions(a.width, a.height);
        ids.add(a.id);
      }
      this.assets = data.assets.map((a: ImageMaterial) => ({id:a.id,title:a.title,hash:a.hash,created:a.created,width:a.width,height:a.height,bytes:a.bytes,source:a.source}));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list() {
    return this.assets.map((a) => ({ ...a }));
  }
  get(id: string) {
    const value = this.assets.find((a) => a.id === id);
    if (!value) throw Error('素材不存在');
    return { ...value };
  }
  async read(id: string, thumbnail = false) {
    const asset = this.get(id),
      file = this.file(id, thumbnail ? '.thumb.png' : '.png'),
      info = await stat(file);
    if (
      !info.isFile() ||
      info.size < 1 ||
      info.size > (thumbnail ? 2 * 1024 * 1024 : 64 * 1024 * 1024)
    )
      throw Error('素材文件无效');
    const bytes = await readFile(file);
    if (!thumbnail && hash(bytes) !== asset.hash) throw Error('素材已损坏，请重新导入');
    return bytes;
  }
  async detail(id: string): Promise<ImageMaterialDetail> {
    const item = this.get(id);
    return {
      id,
      hash: item.hash,
      title: item.title,
      payload: { png: (await this.read(id)).toString('base64') },
    };
  }
  private serial<T>(work: () => Promise<T>) {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private persist() {
    return atomicWrite(join(this.directory,'index.json'),JSON.stringify({format:MATERIAL_INDEX_FORMAT.images,version:1,assets:this.assets}));
  }
  add(
    png: Buffer,
    title: string,
    source: ImageMaterial['source'],
    document?: ImageDocument,
    original?: Buffer,
    history?: import('../../shared/capture/image-document').ImageHistoryState,
  ) {
    return this.serial(async () => {
      if (
        this.assets.length >= 2000 ||
        this.assets.reduce((n, a) => n + a.bytes, 0) + png.length > 8 * 1024 ** 3
      )
        throw Error('素材库已达容量上限，请先清理素材');
      if (png.length > 64 * 1024 * 1024 || png.length < 24) throw Error('图片大小无效');
      if(typeof title!=='string'||!['capture','file','clipboard','edit'].includes(source))throw Error('图片素材信息无效');
      const size = imageSize(png);
      if (size.type !== 'png') throw Error('素材必须是 PNG 图片');
      imageDimensions(size.width, size.height);
      const id = randomUUID(),
        asset: ImageMaterial = {
          id,
          hash: hash(png),
          title: title.trim().slice(0, 200) || '图片',
          created: Date.now(),
          width: size.width,
          height: size.height,
          bytes: png.length,
          source,
        };
      const thumbnail = this.thumbnail(png);
      if(!Buffer.isBuffer(thumbnail)||thumbnail.length<24||thumbnail.length>2*1024*1024||imageSize(thumbnail).type!=='png')throw Error('素材缩略图无效');
      let added = false;
      try {
        await writeFile(this.file(id), png, { flag: 'wx', mode: 0o600 });
        await writeFile(this.file(id, '.thumb.png'), thumbnail, { flag: 'wx', mode: 0o600 });
        await this.saveProject(asset, png, document, original, history);
        this.assets.unshift(asset);
        added = true;
        await this.persist();
      } catch (error) {
        if (added) this.assets = this.assets.filter((a) => a.id !== id);
        await Promise.all([
          unlink(this.file(id)).catch(() => {}),
          unlink(this.file(id, '.thumb.png')).catch(() => {}),
          unlink(this.file(id, IMAGE_PROJECT_FORMAT.extension)).catch(() => {}),
        ]);
        throw error;
      }
      this.changed();
      return { ...asset };
    });
  }
  remove(id: string) {
    return this.serial(async () => {
      this.get(id);
      const previous = this.assets;
      this.assets = this.assets.filter((a) => a.id !== id);
      try {
        await this.persist();
      } catch (error) {
        this.assets = previous;
        throw error;
      }
      await Promise.all([
        unlink(this.file(id)).catch(() => {}),
        unlink(this.file(id, '.thumb.png')).catch(() => {}),
        unlink(this.file(id, IMAGE_PROJECT_FORMAT.extension)).catch(() => {}),
      ]);
      this.changed();
    });
  }
  protect(file: string) {
    const destination = resolve(file).toLowerCase(),
      root = resolve(this.directory).toLowerCase();
    if (
      destination === root ||
      destination.startsWith(root + '\\') ||
      destination.startsWith(root + '/')
    )
      throw Error('请另存到素材目录之外');
  }
}
