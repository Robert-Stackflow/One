import { recordingVideo } from './recording-media';
import { RECORD_SECONDS, type RecordingContainer } from './recording';
interface Stream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
}
export function importedVideoMetadata(text: string, container: RecordingContainer) {
  if (!['mp4', 'webm'].includes(container)) throw Error('不支持的视频容器');
  if (text.length > 65536) throw Error('视频信息超出容量限制');
  let data: { streams?: Stream[]; format?: { duration?: string; format_name?: string } };
  try {
    data = JSON.parse(text);
  } catch {
    throw Error('无法读取视频信息');
  }
  if (!Array.isArray(data?.streams) || data.streams.length > 64) throw Error('视频轨道信息无效');
  const stream = data.streams.find(
    (s) => s?.codec_type === 'video' && !s.disposition?.attached_pic,
  );
  if (!stream) throw Error('所选文件没有可播放的视频轨道');
  if (!['h264', 'vp8', 'vp9', 'av1'].includes(stream.codec_name || ''))
    throw Error('视频编码暂不支持，请先转换为 H.264 MP4 或 VP8 / VP9 WebM');
  const formats = data.format?.format_name?.split(',') || [];
  if (container === 'webm' ? !formats.includes('webm') : !formats.includes('mp4'))
    throw Error('视频容器与文件内容不一致');
  const ratio = (value?: string) => {
    const match = /^(\d+)(?:\/(\d+))?$/.exec(value || '');
    return match ? Number(match[1]) / Number(match[2] || 1) : NaN;
  };
  const fps = ratio(stream.avg_frame_rate) || ratio(stream.r_frame_rate);
  const rotation = stream.side_data_list?.find((s) => Number.isFinite(s.rotation))?.rotation || 0;
  if (rotation % 90 !== 0) throw Error('视频旋转角度暂不支持');
  const swapped = Math.abs(rotation % 180) === 90;
  const video = recordingVideo({
    width: swapped ? stream.height : stream.width,
    height: swapped ? stream.width : stream.height,
    fps,
    encoder: '导入视频 · ' + stream.codec_name,
  });
  const streamSeconds = Number(stream.duration);
  const seconds =
    Number.isFinite(streamSeconds) && streamSeconds > 0
      ? streamSeconds
      : Number(data.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > RECORD_SECONDS)
    throw Error('视频时长无效或超过一小时，请先截取需要的片段');
  return { video, seconds, container, audio: data.streams.some((s) => s?.codec_type === 'audio') };
}
