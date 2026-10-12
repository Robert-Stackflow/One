import { t as tr } from '../../shared/capture/i18n';
import { commitRecording } from '../media-file';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, open, unlink, statfs, type FileHandle } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { RECORD_BYTES, RECORD_CHUNK } from '../../shared/recording/recording';
interface Part {
  offset: number;
  length: number;
  plain: number;
  start: number;
}
export class RecordingFile {
  readonly path: string;
  private key = randomBytes(32);
  private handle?: FileHandle;
  private parts: Part[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private closed = false;
  private disposal?: Promise<void>;
  private position = 0;
  private header = Buffer.alloc(0);
  private get headerLength() {
    return this.container === 'webm' ? 4 : this.container === 'mp4' ? 12 : 44;
  }
  bytes = 0;
  constructor(
    private directory: string,
    private limit = RECORD_BYTES,
    private container = 'mp4',
  ) {
    this.path = join(directory, 'record-' + randomUUID() + '.sealed');
  }
  static async clean(directory: string) {
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true }))
      if (entry.isFile() && /^record-[0-9a-f-]{36}\.sealed$/.test(entry.name))
        await unlink(join(directory, entry.name));
  }
  create() {
    const operation = (async () => {
      if (this.closed) throw new Error(tr('录制已取消'));
      await mkdir(this.directory, { recursive: true });
      const space = await statfs(this.directory);
      if (space.bavail * space.bsize < 128 * 1024 * 1024)
        throw new Error(tr('磁盘空间不足，至少需要 128 MB 可用空间'));
      if (this.closed) throw new Error(tr('录制已取消'));
      this.handle = await open(this.path, 'wx+', 0o600);
      if (this.closed) throw new Error(tr('录制已取消'));
    })();
    this.serial = operation;
    return operation;
  }
  private live() {
    if (this.closed || !this.handle) throw new Error(tr('录制已结束或取消'));
  }
  append(sequence: number, value: unknown) {
    const data = value instanceof Uint8Array ? Buffer.from(value) : undefined;
    if (!data || !data.length || data.length > RECORD_CHUNK)
      throw new Error(tr('录制片段大小无效'));
    const operation = this.serial
      .catch(() => {})
      .then(async () => {
        this.live();
        if (!Number.isInteger(sequence) || sequence !== this.parts.length)
          throw new Error(tr('录制片段顺序无效'));
        if (this.bytes + data.length > this.limit || this.parts.length >= 10000)
          throw new Error(tr('录制已达容量上限'));
        // MediaRecorder can emit only one header byte in its first timeslice.
        if (this.header.length < this.headerLength) {
          const header = Buffer.concat([
            this.header,
            data.subarray(0, this.headerLength - this.header.length),
          ]);
          const matches = (offset: number, signature: Buffer) => {
            const length = Math.min(signature.length, Math.max(0, header.length - offset));
            return header.subarray(offset, offset + length).equals(signature.subarray(0, length));
          };
          const valid =
            this.container === 'webm'
              ? matches(0, Buffer.from('1a45dfa3', 'hex'))
              : this.container === 'mp4'
                ? matches(4, Buffer.from('ftyp'))
                : matches(0, Buffer.from('RIFF')) && matches(8, Buffer.from('WAVE'));
          if (!valid) throw new Error(tr('录制格式无效'));
          this.header = header;
        }
        if (sequence % 10 === 0) {
          const space = await statfs(this.directory);
          this.live();
          if (space.bavail * space.bsize < 64 * 1024 * 1024 + data.length)
            throw new Error(tr('磁盘余量不足，录制已停止'));
        }
        const nonce = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', this.key, nonce);
        cipher.setAAD(Buffer.from(String(sequence)));
        const encrypted = Buffer.concat([
          nonce,
          cipher.update(data),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
        let offset = 0;
        while (offset < encrypted.length) {
          this.live();
          const n = await this.handle!.write(
            encrypted,
            offset,
            encrypted.length - offset,
            this.position + offset,
          );
          if (!n.bytesWritten) throw new Error(tr('无法写入录制文件'));
          offset += n.bytesWritten;
        }
        this.live();
        this.parts.push({
          offset: this.position,
          length: encrypted.length,
          plain: data.length,
          start: this.bytes,
        });
        this.position += encrypted.length;
        this.bytes += data.length;
      });
    this.serial = operation;
    return operation;
  }
  async finish() {
    await this.serial;
    this.live();
    if (!this.bytes) throw new Error(tr('没有可保存的录制内容'));
    if (this.header.length < this.headerLength) throw new Error(tr('录制文件头不完整'));
    await this.handle!.sync();
    this.live();
  }
  async *read(start = 0, end = this.bytes - 1) {
    await this.serial;
    this.live();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end >= this.bytes ||
      end < start
    )
      throw new Error(tr('录制范围无效'));
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.start + p.plain <= start || p.start > end) continue;
      this.live();
      const encrypted = Buffer.alloc(p.length);
      let offset = 0;
      while (offset < p.length) {
        this.live();
        const n = await this.handle!.read(encrypted, offset, p.length - offset, p.offset + offset);
        if (!n.bytesRead) throw new Error(tr('录制片段已损坏'));
        offset += n.bytesRead;
      }
      this.live();
      const decipher = createDecipheriv('aes-256-gcm', this.key, encrypted.subarray(0, 12));
      decipher.setAAD(Buffer.from(String(i)));
      decipher.setAuthTag(encrypted.subarray(-16));
      const plain = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]);
      if (this.container === 'wav') {
        for (const [at, size] of [
          [4, this.bytes - 8],
          [40, this.bytes - 44],
        ]) {
          const from = Math.max(at, p.start),
            to = Math.min(at + 4, p.start + p.plain);
          if (from < to) {
            const patch = Buffer.alloc(4);
            patch.writeUInt32LE(size);
            patch.copy(plain, from - p.start, from - at, to - at);
          }
        }
      }
      yield plain.subarray(Math.max(0, start - p.start), Math.min(p.plain, end - p.start + 1));
    }
  }
  async export(file: string, valid: () => boolean) {
    this.live();
    if (resolve(file) === resolve(this.path)) throw new Error(tr('不能覆盖录制暂存'));
    const stage = join(dirname(file), '.One-recording-export-' + randomUUID() + '.part');
    let output: FileHandle | undefined;
    try {
      output = await open(stage, 'wx', 0o600);
      for await (const data of this.read()) {
        if (!valid()) throw new Error(tr('保存已取消'));
        let offset = 0;
        while (offset < data.length) {
          const result = await output.write(data, offset, data.length - offset);
          if (!result.bytesWritten) throw new Error(tr('无法写入目标文件'));
          offset += result.bytesWritten;
        }
      }
      await output.sync();
      await output.close();
      output = undefined;
      this.live();
      if (!valid()) throw new Error(tr('保存已取消'));
      commitRecording(stage, file);
      return basename(file);
    } finally {
      await output?.close().catch(() => {});
      await unlink(stage).catch(() => {});
    }
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.key.fill(0);
    this.disposal = (async () => {
      await this.serial.catch(() => {});
      await this.handle?.close().catch(() => {});
      this.handle = undefined;
      this.parts = [];
      this.bytes = 0;
      await unlink(this.path).catch(() => {});
    })();
    return this.disposal;
  }
}
