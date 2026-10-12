import { access, open, stat } from 'node:fs/promises';
import { delimiter, extname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { importedVideoMetadata } from '../../shared/recording/recording-import';
import { RECORDING_PROJECT_FORMAT } from '../../shared/media-project';
import {
  RECORD_BYTES,
  RECORD_CHUNK,
  type RecordingContainer,
  type RecordingAudioSource,
} from '../../shared/recording/recording';
import { recordingProject } from '../../shared/recording/recording-project';
import { defaultPlayback } from '../../shared/recording/recording-playback';
import { RecordingFile } from './recording-file';
const run = promisify(execFile);
export async function resolveVideoProbe(bundled: string) {
  for (const path of [
    join(bundled, 'ffprobe.exe'),
    ...(process.env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((p) => join(p, 'ffprobe.exe')),
  ]) {
    try {
      await access(path);
      return resolve(path);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || ''))
        throw Error('无法读取视频分析工具');
    }
  }
  throw Error('未找到 FFprobe，请安装含 FFprobe 的完整 FFmpeg 后重启 One');
}
/** Copy the selected local source into the existing encrypted project store without transcoding. */
export async function importRecordingVideo(
  path: string,
  directory: string,
  executable: string,
  signal: AbortSignal,
  valid: () => boolean,
  progress: (value: number) => void = () => {},
) {
  if (!['.mp4', '.m4v', '.webm'].includes(extname(path).toLowerCase()))
    throw Error('请选择 MP4、M4V 或 WebM 视频');
  const check = () => {
    if (signal.aborted || !valid()) throw Error('视频导入已取消');
  };
  check();
  const input = await open(path, 'r');
  let file: RecordingFile | undefined,
    succeeded = false;
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size < 12 || info.size > RECORD_BYTES)
      throw Error('视频文件无效或超过 1 GiB');
    const header = Buffer.alloc(12);
    await input.read(header, 0, 12, 0);
    const container: RecordingContainer =
      header.subarray(4, 8).toString() === 'ftyp'
        ? 'mp4'
        : header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
          ? 'webm'
          : 'wav';
    if (container === 'wav') throw Error('不是受支持的 MP4 或 WebM 视频');
    let stdout: string;
    try {
      ({ stdout } = await run(
        executable,
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-show_entries',
          'format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration:stream_disposition=attached_pic:stream_side_data=rotation',
          '-of',
          'json',
          resolve(path),
        ],
        { windowsHide: true, signal, timeout: 20000, maxBuffer: 65536 },
      ));
    } catch {
      check();
      throw Error('无法分析视频，请检查文件和 FFprobe 后重试');
    }
    check();
    const metadata = importedVideoMetadata(stdout, container);
    file = new RecordingFile(directory, RECORD_BYTES, container);
    await file.create();
    const buffer = Buffer.alloc(Math.min(info.size, RECORD_CHUNK));
    try {
      let position = 0,
        sequence = 0;
      while (position < info.size) {
        check();
        const { bytesRead } = await input.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - position),
          position,
        );
        if (!bytesRead) throw Error('视频文件在导入期间发生变化');
        await file.append(sequence++, buffer.subarray(0, bytesRead));
        position += bytesRead;
        progress(position / info.size);
      }
    } finally {
      buffer.fill(0);
    }
    const after = await input.stat(),
      current = await stat(path);
    if (
      [after, current].some(
        (s) => s.size !== info.size || s.mtimeMs !== info.mtimeMs || s.ino !== info.ino,
      )
    )
      throw Error('视频文件在导入期间发生变化，请重试');
    await file.finish();
    check();
    const project = recordingProject({
      format: RECORDING_PROJECT_FORMAT.id,
      version: RECORDING_PROJECT_FORMAT.version,
      origin: 'video',
      seconds: metadata.seconds,
      video: metadata.video,
      options: {
        mode: 'video',
        container,
        sourceId: 'screen:0:0',
        fps: metadata.video.fps <= 15 ? 15 : metadata.video.fps <= 30 ? 30 : 60,
        maxWidth: 2560,
        systemAudio: metadata.audio,
        microphone: false,
        microphoneId: '',
        cursor: false,
      },
      playback: defaultPlayback(),
      inputs: [],
      annotations: [],
      layouts: [],
    });
    succeeded = true;
    return {
      project,
      file,
      cameraFile: undefined as RecordingFile | undefined,
      audioFiles: {} as Partial<Record<RecordingAudioSource, RecordingFile>>,
    };
  } finally {
    await input.close();
    if (!succeeded) await file?.dispose();
  }
}
