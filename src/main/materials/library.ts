import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
} from 'node:fs/promises';
import { join,resolve } from 'node:path';
import type { RecordingMaterial } from '../../shared/materials';
import type { PlaybackSettings } from '../../shared/recording/recording-playback';
import { playbackSettings } from '../../shared/recording/recording-playback';
import { writeImageProject } from '../capture/image-project';
import {recordingProjectInfo} from '../recording/recording-project';
import { identity, type ImageDocument } from '../../shared/capture/image-document';
import { defaultEffects } from '../../shared/capture/image-output';
import { ImageMaterialLibrary } from './image-library';
import type { ImageMaterial } from '../../shared/materials';
import { atomicWrite } from './atomic-file';
import { imageSize } from 'image-size';
import {IMAGE_PROJECT_FORMAT,RECORDING_PROJECT_FORMAT} from '../../shared/media-project';
import {MATERIAL_INDEX_FORMAT,validMaterialId as validId,recordingMaterial} from '../../shared/materials';

/** One owns this root: callers resolve it from the active One profile. */
export class MaterialLibrary {
  readonly images:ImageMaterialLibrary;
  private recordings: RecordingMaterial[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    thumbnail:(png:Buffer)=>Buffer,
    private changed: () => void = () => {},
  ) {this.images=new ImageMaterialLibrary(join(directory,'images'),thumbnail,(...args)=>this.image(...args),changed);}
  async init() {
    this.recordings=[];
    await Promise.all(
      ['images', 'recordings'].map((part) =>
        mkdir(join(this.directory, part), { recursive: true }),
      ),
    );
    await this.images.init();
    const entries = await readdir(join(this.directory, 'recordings'), { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isDirectory() && validId(e.name))) {
      const marker = join(this.directory, 'recordings', entry.name, 'state.json');
      let data;
      try {
        if ((await stat(marker)).size > 16 * 1024 * 1024) throw Error('录制素材信息过大');
        data = JSON.parse(await readFile(marker, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (data.format!==MATERIAL_INDEX_FORMAT.recording||data.version!==1||data.id!==entry.name)
        throw Error('录制素材索引损坏');
      const item=recordingMaterial(data);
      await this.verifyRecording(join(this.folder(item.id),'project'+RECORDING_PROJECT_FORMAT.extension));
      if(data.playback!==undefined)playbackSettings(data.playback);
      this.recordings.push(item);
    }
  }
  private summary(item: RecordingMaterial): RecordingMaterial {
    return {
      id: item.id,
      title: item.title,
      created: item.created,
      seconds: item.seconds,
      bytes: item.bytes,
      mode: item.mode,
    };
  }
  protect(file:string){
    const destination=resolve(file).toLowerCase(),root=resolve(this.directory).toLowerCase();
    if(destination===root||destination.startsWith(root+'\\')||destination.startsWith(root+'/'))throw Error('请另存到素材目录之外');
  }
  private async verifyRecording(file:string){
    await recordingProjectInfo(file);
  }
  list() {
    return this.recordings.map((item) => this.summary(item)).sort((a, b) => b.created - a.created);
  }
  private folder(id: string) {
    if (!validId(id)) throw Error('素材不存在');
    return join(this.directory, 'recordings', id);
  }
  imagePath(id: string) {
    if (!validId(id)) throw Error('素材不存在');
    return join(this.directory, 'images', id + IMAGE_PROJECT_FORMAT.extension);
  }
  recordingPath(id: string) {
    if (!this.recordings.some((item) => item.id === id)) throw Error('素材不存在');
    return join(this.folder(id), 'project'+RECORDING_PROJECT_FORMAT.extension);
  }
  async recordingThumbnail(id: string) {
    this.recordingPath(id);
    const path = join(this.folder(id), 'thumbnail.png');
    try {
      if ((await stat(path)).size > 1024 * 1024) throw Error('素材预览图过大');
      return await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  saveRecordingThumbnail(id: string, bytes: Uint8Array) {
    return this.serial(async () => {
      this.recordingPath(id);
      if (!(bytes instanceof Uint8Array) || bytes.length > 1024 * 1024 || bytes.length < 24)
        throw Error('素材预览图无效');
      const size = imageSize(bytes);
      if (
        size.type !== 'png' ||
        !size.width ||
        !size.height ||
        size.width > 480 ||
        size.height > 480
      )
        throw Error('素材预览图无效');
      await atomicWrite(join(this.folder(id), 'thumbnail.png'), bytes);
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private async state(item: RecordingMaterial, playback?: PlaybackSettings) {
    await atomicWrite(join(this.folder(item.id),'state.json'),JSON.stringify({format:MATERIAL_INDEX_FORMAT.recording,version:1,...recordingMaterial(item),...(playback===undefined?{}:{playback:playbackSettings(playback)})}));
  }
  addRecording(
    item: RecordingMaterial,
    save: (destination: string) => Promise<unknown>,
    playback?: PlaybackSettings,
  ) {
    return this.serial(async () => {
      item=recordingMaterial(item);
      if(playback!==undefined)playback=playbackSettings(playback);
      if(this.recordings.some(value=>value.id===item.id))throw Error('录制素材已存在');
      const folder = this.folder(item.id);
      await mkdir(folder, { recursive: true });
      await save(join(folder, 'project'+RECORDING_PROJECT_FORMAT.extension));
      await this.verifyRecording(join(folder,'project'+RECORDING_PROJECT_FORMAT.extension));
      await unlink(join(folder, 'thumbnail.png')).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await this.state(item, playback);
      this.recordings = [
        this.summary(item),
        ...this.recordings.filter((value) => value.id !== item.id),
      ];
      this.changed();
    });
  }
  updateRecording(id: string, playback: PlaybackSettings) {
    return this.serial(async () => {
      const item = this.recordings.find((value) => value.id === id);
      if (!item) throw Error('素材不存在');
      await this.state(item, playback);
    });
  }
  async removeImage(id: string) {
    await this.images.remove(id);
  }
  async playback(id: string) {
    this.recordingPath(id);
    if((await stat(join(this.folder(id),'state.json'))).size>16*1024*1024)throw Error('录制素材信息过大');
    const value = JSON.parse(await readFile(join(this.folder(id), 'state.json'), 'utf8'));
    return value.playback ? playbackSettings(value.playback) : undefined;
  }
  removeRecording(id: string) {
    return this.serial(async () => {
      this.recordingPath(id);
      // Remove the index marker first; a failed deletion never exposes an incomplete project.
      await unlink(join(this.folder(id), 'state.json'));
      this.recordings = this.recordings.filter((item) => item.id !== id);
      await unlink(join(this.folder(id), 'project'+RECORDING_PROJECT_FORMAT.extension));
      await unlink(join(this.folder(id), 'thumbnail.png')).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      this.changed();
    });
  }
  private async image(
    asset: ImageMaterial,
    png: Buffer,
    document?: ImageDocument,
    original = png,
    history?: import('../../shared/capture/image-document').ImageHistoryState,
  ) {
    const scene = document || {
      width: asset.width,
      height: asset.height,
      original: { width: asset.width, height: asset.height },
      selection: { x: 0, y: 0, width: asset.width, height: asset.height },
      transform: identity(),
      annotations: [],
      effects: defaultEffects(),
    };
    await writeImageProject(
      this.imagePath(asset.id),
      { format:IMAGE_PROJECT_FORMAT.id,version: 1, name: asset.title.slice(0, 180), document: scene, history },
      original,
      () => true,
    );
  }
}
