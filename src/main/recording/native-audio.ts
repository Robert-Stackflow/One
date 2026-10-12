import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { audioCapabilities, type AudioProgress } from '../../shared/recording/native-audio';
import type { RecordingOptions } from '../../shared/recording/recording';
import { NativeMedia } from './native-media';
const executable = () =>
  join(__dirname, '../native/One.RecordingAudio.exe').replace('app.asar', 'app.asar.unpacked');
export async function audioDevices() {
  const result = await promisify(execFile)(executable(), ['devices'], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 1024 * 1024,
  });
  return audioCapabilities(JSON.parse(result.stdout));
}
export class NativeAudio extends NativeMedia {
  private constructor(
    directory: string,
    file: string,
    options: RecordingOptions,
    update: (event: AudioProgress) => void,
    launch?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    super(
      directory,
      file,
      {
        executable: executable(),
        args: [
          'capture',
          file,
          options.container === 'wav' ? 'wav' : 'm4a',
          options.systemAudio ? options.systemAudioId || 'default' : 'none',
          options.microphone ? options.microphoneId || 'default' : 'none',
          String(process.pid),
          String(options.audioBitrate || 128000),
        ],
        marker: '.one-audio',
        markerText: 'One native audio',
      },
      update,
      launch,
    );
  }
  static async create(
    root: string,
    options: RecordingOptions,
    update: (event: AudioProgress) => void,
    launch?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    const directory = join(resolve(root), 'audio-' + randomUUID());
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '.one-audio'), 'One native audio', {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await writeFile(
        join(directory, 'draft.json'),
        JSON.stringify({
          version: 1,
          createdAt: Date.now(),
          format: options.container === 'wav' ? 'wav' : 'm4a',
          systemAudio: options.systemAudio,
          microphone: options.microphone,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      return new NativeAudio(
        directory,
        join(directory, options.container === 'wav' ? 'capture.wav' : 'capture.m4a'),
        options,
        update,
        launch,
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
