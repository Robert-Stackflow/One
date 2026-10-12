import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../materials/atomic-file';
import {
  workspaceFrom,
  PIN_LIMIT,
  pinId,
  type PinRecord,
  type PinWorkspace,
  type PinContent,
  type PinView,
} from '../../shared/pins';
import { IMAGE_BYTES } from '../../shared/capture/image-limits';

/** Documents own immutable media. OS windows are disposable presentations of these documents. */
export class PinStore {
  private value: PinWorkspace = { format:'one-pin-workspace', version: 1, pins: [], groups: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(join(this.directory, 'images'), { recursive: true });
    try {
      this.value = workspaceFrom(
        JSON.parse(await readFile(join(this.directory, 'workspace.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // Retain content across launches, but never re-open pass-through/off-screen windows unattended.
    for (const pin of this.value.pins) {
      pin.view.visible = false;
      pin.view.passThrough = false;
    }
    await this.change(() => {});
    await this.collect();
  }
  snapshot() {
    return structuredClone(this.value);
  }
  get(id: string): PinRecord {
    if (!pinId(id)) throw Error('贴图编号无效');
    const pin = this.value.pins.find((p) => p.id === id);
    if (!pin) throw Error('贴图不存在');
    return structuredClone(pin);
  }
  async change(mutate: (next: PinWorkspace) => void) {
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const next = this.snapshot();
        mutate(next);
        const validated = workspaceFrom(next);
        await atomicWrite(join(this.directory, 'workspace.json'), JSON.stringify(validated));
        this.value = validated;
      });
    // A rejected mutation is reported to its caller; it must not poison flush or later writes.
    this.queue = operation.catch(() => {});
    await operation;
  }
  async add(title: string, content: PinContent, view: PinView) {
    const id = randomUUID();
    await this.change((next) => {
      if (next.pins.length >= PIN_LIMIT) throw Error('最多保存 200 个贴图，请先删除不需要的内容');
      next.pins.unshift({ id, title, content, view, group: null, created: Date.now() });
    });
    return this.get(id);
  }
  async installImage(png: Buffer) {
    if (!png.length || png.length > IMAGE_BYTES) throw Error('贴图图片过大');
    const hash = createHash('sha256').update(png).digest('hex');
    const files = await readdir(join(this.directory, 'images'));
    let bytes = png.length;
    for (const file of files)
      if (/^[a-f0-9]{64}\.png$/.test(file) && file !== hash + '.png')
        bytes += (await stat(join(this.directory, 'images', file))).size;
    if (bytes > 1024 ** 3) throw Error('贴图原图存储已达 1 GiB，请删除不需要的贴图');
    await atomicWrite(join(this.directory, 'images', hash + '.png'), new Uint8Array(png));
    return hash;
  }
  async read(id: string) {
    const record = this.get(id);
    if (record.content.kind !== 'image') throw Error('这个贴图不是图片');
    const png = await readFile(join(this.directory, 'images', record.content.hash + '.png'));
    if (
      png.length > IMAGE_BYTES ||
      createHash('sha256').update(png).digest('hex') !== record.content.hash
    )
      throw Error('贴图原图已损坏');
    return png;
  }
  async collect() {
    const used = new Set(
      this.value.pins
        .filter((p) => p.content.kind === 'image')
        .map((p) => (p.content as Extract<PinContent, { kind: 'image' }>).hash + '.png'),
    );
    for (const name of await readdir(join(this.directory, 'images')))
      if (
        (/^[a-f0-9]{64}\.png$/.test(name) && !used.has(name)) ||
        /^[a-f0-9]{64}\.png\.[a-f0-9-]{36}\.next$/.test(name)
      )
        await unlink(join(this.directory, 'images', name));
  }
  async flush() {
    await this.queue;
  }
}
